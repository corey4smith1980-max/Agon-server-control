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
const manifest = { version: '1.0.3', artifacts: [] };

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
        GOARCH: target.arch,
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
  makeZip(agentFiles, path.join(downloads, 'agon-agent-source.zip')),
  makeZip(agentBuildFiles, path.join(downloads, 'agon-agent-builds.zip')),
  makeZip(agentFiles, path.join(publicDownloads, 'agon-agent-source.zip')),
  makeZip(agentBuildFiles, path.join(publicDownloads, 'agon-agent-builds.zip')),
]);
