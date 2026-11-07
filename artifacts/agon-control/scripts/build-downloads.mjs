import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(projectRoot, 'dist', 'public');
const agentOutput = path.join(outputRoot, 'agent');
const publicRoot = path.join(projectRoot, 'public');
const publicAgentOutput = path.join(publicRoot, 'agent');
const agentSource = path.join(projectRoot, 'agent');

const builds = [
  { platform: 'windows', goos: 'windows', arch: 'amd64', extension: '.exe' },
  { platform: 'windows', goos: 'windows', arch: 'arm64', extension: '.exe' },
  { platform: 'linux', goos: 'linux', arch: 'amd64', extension: '' },
  { platform: 'linux', goos: 'linux', arch: 'arm64', extension: '' },
  { platform: 'macos', goos: 'darwin', arch: 'amd64', extension: '' },
  { platform: 'macos', goos: 'darwin', arch: 'arm64', extension: '' },
  { platform: 'android', goos: 'android', arch: 'arm64', extension: '' },
];

await Promise.all([
  mkdir(agentOutput, { recursive: true }),
  mkdir(publicAgentOutput, { recursive: true }),
]);
const manifest = { version: '1.0.4', artifacts: [] };

for (const target of builds) {
  const filename = `agon-agent-${target.platform}-${target.arch}${target.extension}`;
  const destination = path.join(agentOutput, filename);
  const result = spawnSync(
    'go',
    ['build', '-trimpath', '-ldflags=-s -w', '-o', destination, '.'],
    {
      cwd: agentSource,
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOOS: target.goos,
        GOARCH: target.goarch ?? target.arch,
        ...(target.goarm ? { GOARM: target.goarm } : {}),
    },
      stdio: 'inherit',
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not build the consent-based agent for ${target.platform}/${target.arch}: ${result.error?.message ?? `go exited with ${result.status}`}`,
    );
  }

  const binary = await readFile(destination);
  await writeFile(path.join(publicAgentOutput, filename), binary);
  manifest.artifacts.push({
    platform: target.platform,
    arch: target.arch,
    file: `/agent/${filename}`,
    bytes: binary.byteLength,
    sha256: createHash('sha256').update(binary).digest('hex'),
    version: manifest.version,
  });
}

const androidApkName = 'agon-agent-android-universal-v1.0.4.apk';
try {
  const apk = await readFile(path.join(publicAgentOutput, androidApkName));
  await writeFile(path.join(agentOutput, androidApkName), apk);
  manifest.artifacts.push({
    platform: 'android',
    arch: 'universal',
    file: `/agent/${androidApkName}`,
    bytes: apk.byteLength,
    sha256: createHash('sha256').update(apk).digest('hex'),
    version: manifest.version,
  });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  if (process.env.BUILD_ANDROID_APK === '1') {
    throw new Error('Android APK build completed without producing the expected APK.');
  }
}

await Promise.all([
  writeFile(
    path.join(agentOutput, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  ),
  writeFile(
    path.join(publicAgentOutput, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  ),
]);
const checksums = `${manifest.artifacts.map((artifact) =>
  `${artifact.sha256}  ${path.basename(artifact.file)}`,
).join('\n')}\n`;
await Promise.all([
  writeFile(path.join(agentOutput, 'SHA256SUMS'), checksums),
  writeFile(path.join(publicAgentOutput, 'SHA256SUMS'), checksums),
]);

const downloads = path.join(outputRoot, 'downloads');
const publicDownloads = path.join(publicRoot, 'downloads');
await Promise.all([
  mkdir(downloads, { recursive: true }),
  mkdir(publicDownloads, { recursive: true }),
]);

async function makeZip(files, destination) {
  const zip = new JSZip();
  for (const [archivePath, sourcePath] of files) {
    zip.file(archivePath, await readFile(sourcePath));
  }
  await writeFile(
    destination,
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    }),
  );
}

const agentFiles = [
  'main.go',
  'main_test.go',
  'go.mod',
  'go.sum',
  'desktop_windows.go',
  'desktop_unsupported.go',
  'inventory_common.go',
  'inventory_unix.go',
  'inventory_windows.go',
  'service_android.go',
  'service_unix.go',
  'service_windows.go',
  'README.md',
].map((filename) => [filename, path.join(agentSource, filename)]);

const androidAgentSourceFiles = [
  'gradlew',
  'gradlew.bat',
  'gradle/wrapper/gradle-wrapper.jar',
  'gradle/wrapper/gradle-wrapper.properties',
  'settings.gradle',
  'build.gradle',
  'gradle.properties',
  'app/build.gradle',
  'app/src/main/AndroidManifest.xml',
  'app/src/main/java/com/agon/agent/MainActivity.java',
  'app/src/main/java/com/agon/agent/AgentService.java',
  'app/src/main/java/com/agon/agent/AndroidAgentConnection.java',
  'app/src/main/res/values/strings.xml',
  'app/src/main/res/values/styles.xml',
  'app/src/main/res/drawable/ic_agon_agent.xml',
  'app/src/main/res/drawable/ic_agent_status.xml',
].map((filename) => [
  `android-agent/${filename}`,
  path.join(projectRoot, 'android-agent', filename),
]);
androidAgentSourceFiles.push([
  'scripts/build-android-apk.mjs',
  path.join(projectRoot, 'scripts', 'build-android-apk.mjs'),
]);
androidAgentSourceFiles.push([
  'scripts/build-android.sh',
  path.join(projectRoot, 'scripts', 'build-android.sh'),
]);
androidAgentSourceFiles.push([
  'scripts/package-android-artifacts.sh',
  path.join(projectRoot, 'scripts', 'package-android-artifacts.sh'),
]);

const agentBuildFiles = [
  ['manifest.json', path.join(agentOutput, 'manifest.json')],
  ['SHA256SUMS', path.join(agentOutput, 'SHA256SUMS')],
  ['BUILDS.md', path.join(agentSource, 'BUILDS.md')],
  ...manifest.artifacts.map((artifact) => {
    const filename = path.basename(artifact.file);
    return [filename, path.join(agentOutput, filename)];
  }),
];

await Promise.all([
  makeZip([...agentFiles, ...androidAgentSourceFiles], path.join(downloads, 'agon-agent-source.zip')),
  makeZip(agentBuildFiles, path.join(downloads, 'agon-agent-builds.zip')),
  makeZip([...agentFiles, ...androidAgentSourceFiles], path.join(publicDownloads, 'agon-agent-source.zip')),
  makeZip(agentBuildFiles, path.join(publicDownloads, 'agon-agent-builds.zip')),
]);
