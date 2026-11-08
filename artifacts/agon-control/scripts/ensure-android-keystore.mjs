import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const androidRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'android-agent');
const keystoreDir = path.join(androidRoot, 'keystore');
const propertiesPath = path.join(androidRoot, 'keystore.properties');
const alias = process.env.AGON_ANDROID_KEY_ALIAS || 'agon-agent';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

let storeFile = process.env.AGON_ANDROID_KEYSTORE || path.join(keystoreDir, 'agon-release.p12');
let storePassword = process.env.AGON_ANDROID_STORE_PASSWORD || '';
let keyPassword = process.env.AGON_ANDROID_KEY_PASSWORD || storePassword;

if (!process.env.AGON_ANDROID_KEYSTORE) {
  await mkdir(keystoreDir, { recursive: true });
  const credentialsPath = path.join(keystoreDir, 'credentials.json');
  if (!storePassword) {
    try {
      const saved = JSON.parse(await readFile(credentialsPath, 'utf8'));
      storePassword = saved.storePassword;
      keyPassword = saved.keyPassword;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      storePassword = randomBytes(24).toString('base64url');
      keyPassword = storePassword;
      await writeFile(credentialsPath, `${JSON.stringify({ storePassword, keyPassword, keyAlias: alias }, null, 2)}\n`, { mode: 0o600 });
      await chmod(credentialsPath, 0o600);
    }
  }
  try {
    await readFile(storeFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    run('keytool', [
      '-genkeypair',
      '-alias', alias,
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', '10000',
      '-storetype', 'PKCS12',
      '-keystore', storeFile,
      '-storepass', storePassword,
      '-keypass', keyPassword,
      '-dname', 'CN=Agon Agent, OU=Endpoint Signing, O=Agon, C=US',
    ]);
    await chmod(storeFile, 0o600);
  }
}

if (!storePassword || !keyPassword) {
  throw new Error('AGON_ANDROID_STORE_PASSWORD and AGON_ANDROID_KEY_PASSWORD are required when AGON_ANDROID_KEYSTORE is set.');
}

const listed = run('keytool', ['-list', '-v', '-keystore', storeFile, '-storepass', storePassword, '-alias', alias]);
if (/CN=Android Debug/i.test(listed)) {
  throw new Error('Refusing the Android debug certificate. Use the organization release key.');
}
const sha256 = listed.match(/SHA256:\s*([0-9A-F:]+)/i)?.[1] || '';
if (!sha256) throw new Error('The release certificate did not report a SHA-256 fingerprint.');

const relativeStore = path.relative(androidRoot, storeFile).split(path.sep).join('/');
const properties = [
  `storeFile=${relativeStore}`,
  `storePassword=${storePassword}`,
  `keyAlias=${alias}`,
  `keyPassword=${keyPassword}`,
  '',
].join('\n');
await writeFile(propertiesPath, properties, { mode: 0o600 });
await chmod(propertiesPath, 0o600);
console.log(`Android release key ready. Certificate SHA-256: ${sha256}`);
