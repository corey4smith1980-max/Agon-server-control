import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(artifactRoot, '../..');
const androidRoot = path.join(artifactRoot, 'android-agent');
const sdkRoot = process.env.ANDROID_SDK_ROOT
  || process.env.ANDROID_HOME
  || path.join(workspaceRoot, '.cache', 'android-sdk');
const sdkManagerEnv = {
  ...process.env,
  ANDROID_HOME: sdkRoot,
  ANDROID_SDK_ROOT: sdkRoot,
};
const sdkManager = process.env.SDKMANAGER || 'sdkmanager';
const mode = process.argv[2] || 'package';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: androidRoot,
    env: sdkManagerEnv,
    encoding: 'utf8',
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    input: options.input,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'no status'}`);
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureAndroidSdk() {
  const platformJar = path.join(sdkRoot, 'platforms', 'android-37.0', 'android.jar');
  const buildTools = path.join(sdkRoot, 'build-tools', '37.0.0');
  if (await exists(platformJar) && await exists(path.join(buildTools, 'aapt'))) return;

  const licenseDir = path.join(sdkRoot, 'licenses');
  const acceptedLicense = path.join(licenseDir, 'android-sdk-license');
  if (!(await exists(acceptedLicense))) {
    console.log('Accepting the Android SDK license previously authorized for this build.');
    await mkdir(sdkRoot, { recursive: true });
    run(sdkManager, ['--licenses', '--sdk_root', sdkRoot], { input: 'y\n'.repeat(32) });
  }
  run(sdkManager, [
    '--install',
    '--sdk_root',
    sdkRoot,
    'platforms;android-37.0',
    'build-tools;37.0.0',
  ]);
  if (!(await exists(platformJar)) || !(await exists(path.join(buildTools, 'aapt')))) {
    throw new Error('Android SDK API 37 and Build Tools 37.0.0 were not installed successfully.');
  }
}

await ensureAndroidSdk();
if (mode === 'prepare') {
  console.log(`Android SDK ready at ${sdkRoot}.`);
} else if (mode === 'package') {
  const builtApk = path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const apkInfo = await stat(builtApk);
  if (apkInfo.size < 1024 * 1024) {
    throw new Error(`APK is unexpectedly small (${apkInfo.size} bytes).`);
  }

  const apkName = 'agon-agent-android-universal-v1.0.4.apk';
  const outputs = [
    path.join(artifactRoot, 'public', 'agent', apkName),
    path.join(artifactRoot, 'dist', 'public', 'agent', apkName),
  ];
  for (const output of outputs) {
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(builtApk, output);
  }

  const apksigner = path.join(sdkRoot, 'build-tools', '37.0.0', 'apksigner');
  if (await exists(apksigner)) {
    run(apksigner, ['verify', '--verbose', outputs[0]]);
  }
  const gradle = await readFile(path.join(androidRoot, 'app', 'build.gradle'), 'utf8');
  if (!gradle.includes('minSdk 26') || !gradle.includes('targetSdk 37')) {
    throw new Error('Android APK SDK compatibility settings are missing.');
  }
  console.log(`Packaged ${apkName} (${apkInfo.size} bytes).`);
} else {
  throw new Error('Usage: build-android-apk.mjs [prepare|package]');
}
