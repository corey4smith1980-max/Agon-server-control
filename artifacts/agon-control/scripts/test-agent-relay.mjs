import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentRoot = path.join(projectRoot, 'agent');
const relayRoot = path.join(projectRoot, 'server');
const relayEntrypoint = path.join(relayRoot, 'server.mjs');
const deploymentSource = path.join(projectRoot, 'src', 'pages', 'Deployment.tsx');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agon-agent-relay-test-'));
const adminToken = randomBytes(48).toString('base64url');
const dataDir = path.join(tempRoot, 'relay-data');
const configPath = path.join(tempRoot, 'agent.json');
const linuxAgent = path.join(tempRoot, 'agon-agent-linux-amd64');
const windowsAgent = path.join(tempRoot, 'agon-agent-windows-amd64.exe');
const childLogs = [];
let relayProcess;
let agentProcess;

function assertChildExited(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} exited with ${result.status ?? 'no status'}: ${result.stderr || result.stdout}`);
  }
}

function buildAgent(outputPath, goos, goarch) {
  const result = spawnSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', outputPath, '.'], {
    cwd: agentRoot,
    env: { ...process.env, CGO_ENABLED: '0', GOOS: goos, GOARCH: goarch },
    encoding: 'utf8',
  });
  assertChildExited(result, `Go build ${goos}/${goarch}`);
}

function captureProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function startRelay(port) {
  const child = spawn(process.execPath, [relayEntrypoint], {
    cwd: relayRoot,
    env: {
      ...process.env,
      ADMIN_TOKEN: adminToken,
      ALLOW_ORIGIN: 'https://console.example.test',
      DATA_DIR: dataDir,
      PORT: String(port),
      RELAY_ID: 'integration-test-relay',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', (chunk) => childLogs.push(chunk));
  }
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function findFreePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(description, predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${url} returned non-JSON HTTP ${response.status}`);
    }
  }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${body.error || text}`);
  return body;
}

function startAgent() {
  const child = spawn(linuxAgent, ['-config', configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', (chunk) => childLogs.push(chunk));
  }
  return child;
}

function sanitizedLogs(pairingCode, deviceToken) {
  let value = childLogs.join('');
  for (const secret of [adminToken, pairingCode, pairingCode.replaceAll('-', ''), deviceToken]) {
    if (secret) value = value.split(secret).join('[redacted]');
  }
  return value.slice(-5000);
}

try {
  console.log('Building actual Linux agent and Windows x64 executable...');
  buildAgent(linuxAgent, 'linux', 'amd64');
  buildAgent(windowsAgent, 'windows', 'amd64');
  const windowsHeader = await readFile(windowsAgent);
  assert.equal(windowsHeader.subarray(0, 2).toString('ascii'), 'MZ', 'Windows output must be a PE executable');

  const installerSource = await readFile(deploymentSource, 'utf8');
  for (const required of [
    '#Requires -RunAsAdministrator',
    '$agentExitCode = $LASTEXITCODE',
    'if ($agentExitCode -ne 0)',
    'Get-Service -Name "AgonAgent"',
    'Start-Service -Name "AgonAgent"',
  ]) {
    assert(installerSource.includes(required), `Windows installer is missing required check: ${required}`);
  }
  console.log('PASS: Windows x64 executable cross-build and installer safety checks.');

  const wsEntry = path.join(relayRoot, 'node_modules', 'ws', 'package.json');
  try {
    await readFile(wsEntry, 'utf8');
  } catch {
    const install = spawnSync('npm', ['ci', '--omit=dev'], { cwd: relayRoot, encoding: 'utf8' });
    assertChildExited(install, 'Install isolated relay dependencies');
  }

  const port = await findFreePort();
  const relayUrl = `http://127.0.0.1:${port}`;
  relayProcess = startRelay(port);
  await waitFor('relay health endpoint', async () => {
    const response = await fetch(`${relayUrl}/health`);
    return response.ok;
  });

  await writeFile(configPath, `${JSON.stringify({
    serverUrl: relayUrl,
    ownerId: 'integration-test-owner',
    deviceName: 'Agon integration test endpoint',
    group: 'Test',
    allowUnattended: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log('Requesting pairing with the real built Linux agent...');
  const pair = await captureProcess(linuxAgent, ['-config', configPath, '-pair']);
  assert.equal(pair.code, 0, `Agent pair command failed with exit code ${pair.code ?? pair.signal}.`);
  const codeMatch = pair.stdout.match(/Pairing code:\s*([A-Z2-7]{4}(?:-[A-Z2-7]{4}){3})/);
  assert(codeMatch, 'Agent did not print the expected pairing code.');
  const pairingCode = codeMatch[1];
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert(config.deviceId && config.deviceToken && config.pairingRequested, 'Agent did not persist its generated identity.');

  await jsonRequest(`${relayUrl}/api/pending-devices/${config.deviceId}/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pairingCode }),
  });
  console.log('PASS: pair request accepted and operator approval activated the device.');

  agentProcess = startAgent();
  const readDevices = async () => jsonRequest(`${relayUrl}/api/devices`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  await waitFor('agent to connect to the relay', async () => {
    const { devices } = await readDevices();
    const device = devices.find((item) => item.id === config.deviceId);
    return device?.online ? device : null;
  });
  console.log('PASS: the built agent established an authenticated WebSocket session.');

  await new Promise((resolve) => setTimeout(resolve, 350));
  await stopProcess(relayProcess);
  relayProcess = startRelay(port);
  await waitFor('relay restart health endpoint', async () => {
    const response = await fetch(`${relayUrl}/health`);
    return response.ok;
  });
  await waitFor('agent to reconnect after relay restart', async () => {
    const { devices } = await readDevices();
    const device = devices.find((item) => item.id === config.deviceId);
    return device?.online ? device : null;
  }, 20000);
  const { devices } = await readDevices();
  const visibleDevice = devices.find((item) => item.id === config.deviceId);
  assert(visibleDevice && !('tokenHash' in visibleDevice), 'Operator device list exposed an agent credential hash.');
  console.log('PASS: the agent reconnected after the relay process restarted; no credential hash was exposed.');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  const logs = sanitizedLogs('', '');
  if (logs) console.error(`Recent agent/relay output (secrets redacted):\n${logs}`);
  process.exitCode = 1;
} finally {
  await stopProcess(agentProcess);
  await stopProcess(relayProcess);
  await rm(tempRoot, { recursive: true, force: true });
}

if (process.exitCode !== 1) {
  console.log('PASS: agent relay smoke test completed.');
}
