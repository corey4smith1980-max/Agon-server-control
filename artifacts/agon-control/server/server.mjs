import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const storePath = path.join(dataDir, 'control-plane.json');
const port = Number(process.env.PORT || 8787);
const adminToken = process.env.ADMIN_TOKEN || '';
const relayId = process.env.RELAY_ID || 'local-relay';
const configuredOrigins = process.env.ALLOW_ORIGIN || '';
const startedAt = new Date().toISOString();
const allowedActions = new Set(['agent.ping', 'inventory.refresh', 'diagnostics.network', 'session.request']);

if (adminToken.length < 32 || adminToken.includes('replace-with')) {
  throw new Error('ADMIN_TOKEN must be configured with at least 32 characters. See .env.example.');
}

if (!configuredOrigins) {
  throw new Error('ALLOW_ORIGIN must contain the exact HTTPS origin of the operator console.');
}
const allowedOrigins = new Set(configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean));
for (const origin of allowedOrigins) {
  const parsed = new URL(origin);
  if (origin === '*' || parsed.origin !== origin || (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('ALLOW_ORIGIN must contain exact HTTPS origins; HTTP is allowed only for localhost.');
  }
}

let store = { devices: {}, pendingDevices: {}, jobs: {}, sessions: {}, audit: [] };
try {
  store = { ...store, ...JSON.parse(fs.readFileSync(storePath, 'utf8')) };
} catch (error) {
  if (error.code !== 'ENOENT') console.warn('Could not read data store; starting empty:', error.message);
}
store.pendingDevices ||= {};
// A persisted online flag is only a historical value; sockets must reconnect after a restart.
for (const device of Object.values(store.devices)) device.online = false;

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const temporary = `${storePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, storePath);
  }, 150);
}

function audit(action, actor, detail = {}, severity = 'info') {
  const event = { id: crypto.randomUUID(), at: new Date().toISOString(), action, actor, detail, severity, relayId };
  store.audit.unshift(event);
  store.audit = store.audit.slice(0, 5000);
  save();
  broadcastOperators({ type: 'audit', event });
  return event;
}

function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  return true;
}

async function body(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 65536) throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function secretEqual(received, expected) {
  const a = Buffer.from(String(received || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizePairingCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

const pairRequestWindows = new Map();
function allowPairRequest(ip) {
  const now = Date.now();
  const current = pairRequestWindows.get(ip);
  if (!current || now - current.startedAt >= 10 * 60_000) {
    pairRequestWindows.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 12) return false;
  current.count += 1;
  return true;
}

function isAdmin(request) {
  return secretEqual(request.headers.authorization?.replace(/^Bearer\s+/i, ''), adminToken);
}

function requireAdmin(request, response) {
  if (isAdmin(request)) return true;
  json(response, 401, { error: 'Valid administrator bearer token required' });
  return false;
}

function publicDevice(device) {
  return {
    id: device.id, name: device.name, hostname: device.hostname, group: device.group,
    os: device.os, arch: device.arch, agent: device.agent, cpus: device.cpus,
    interfaces: device.interfaces, relayId: device.relayId, online: Boolean(device.online),
    pairedAt: device.pairedAt || device.enrolledAt, lastSeen: device.lastSeen,
  };
}

const agents = new Map();
const operators = new Set();

function broadcastOperators(message) {
  const encoded = JSON.stringify(message);
  for (const socket of operators) if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
}

function queueCommand(deviceId, action, payload, actor = 'operator') {
  const device = store.devices[deviceId];
  if (!device) throw Object.assign(new Error('Device not found'), { status: 404 });
  if (!allowedActions.has(action)) throw Object.assign(new Error('Action is not allowlisted'), { status: 400 });
  const socket = agents.get(deviceId);
  const canDispatch = Boolean(device.online && socket?.readyState === WebSocket.OPEN);
  const job = {
    id: crypto.randomUUID(), deviceId, action, payload: payload || {}, actor,
    status: canDispatch ? 'dispatched' : 'queued', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), result: null, error: null,
  };
  store.jobs[job.id] = job;
  if (canDispatch) {
    socket.send(JSON.stringify({ type: 'command', jobId: job.id, action, payload: job.payload }));
  }
  audit('job.created', actor, { jobId: job.id, deviceId, action });
  save();
  broadcastOperators({ type: 'job', job });
  return job;
}

async function route(request, response) {
  if (!applyCors(request, response)) {
    return json(response, 403, { error: 'Origin is not allowed' });
  }
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    return json(response, 200, {
      ok: true, service: 'agon-control-plane', version: '1.0.0', relayId,
      startedAt, now: new Date().toISOString(), onlineAgents: agents.size,
      transport: 'WebSocket', tlsRequiredInProduction: true,
    });
  }
  if (request.method === 'POST' && url.pathname === '/api/pair-requests') {
    if (request.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return json(response, 403, { error: 'Expected X-Requested-With header' });
    }
    const input = await body(request);
    const deviceId = String(input.deviceId || '');
    const deviceToken = String(input.deviceToken || '');
    const pairingCode = normalizePairingCode(input.pairingCode);
    const device = input.device || {};
    if (!deviceId || deviceToken.length < 32 || pairingCode.length !== 16 || (!device.name && !device.hostname)) {
      return json(response, 400, { error: 'Device pairing data is incomplete' });
    }
    const tokenHash = hash(deviceToken);
    const active = store.devices[deviceId];
    if (active) {
      if (!secretEqual(tokenHash, active.tokenHash)) return json(response, 409, { error: 'Device identity is already in use' });
      return json(response, 200, { status: 'approved' });
    }
    const existing = store.pendingDevices[deviceId];
    if (existing) {
      if (!secretEqual(tokenHash, existing.tokenHash) || !secretEqual(hash(pairingCode), existing.pairingCodeHash)) {
        return json(response, 409, { error: 'Device identity is already in use' });
      }
      return json(response, 202, { status: 'pending' });
    }
    if (!allowPairRequest(request.socket.remoteAddress || 'unknown')) {
      return json(response, 429, { error: 'Too many device pairing requests. Try again later.' });
    }
    if (Object.keys(store.pendingDevices).length >= 1000) {
      return json(response, 429, { error: 'Too many unapproved devices on this relay.' });
    }
    const now = new Date();
    store.pendingDevices[deviceId] = {
      ...device,
      id: deviceId,
      name: String(device.name || device.hostname).slice(0, 100),
      tokenHash,
      pairingCodeHash: hash(pairingCode),
      relayId,
      online: false,
      allowUnattended: input.allowUnattended === true,
      requestedAt: now.toISOString(),
    };
    audit('device.pairing.requested', 'agent', { deviceId, name: store.pendingDevices[deviceId].name });
    save();
    return json(response, 202, { status: 'pending' });
  }
  if (request.method === 'GET' && url.pathname === '/api/pending-devices') {
    if (!requireAdmin(request, response)) return;
    const devices = Object.values(store.pendingDevices)
      .map(({ tokenHash: _tokenHash, pairingCodeHash: _pairingCodeHash, ...device }) => device);
    return json(response, 200, { devices });
  }
  const pairingApprovalMatch = url.pathname.match(/^\/api\/pending-devices\/([a-f0-9-]+)\/approve$/i);
  if (request.method === 'POST' && pairingApprovalMatch) {
    if (!requireAdmin(request, response)) return;
    const input = await body(request);
    const deviceId = pairingApprovalMatch[1];
    const pending = store.pendingDevices[deviceId];
    if (!pending) {
      return json(response, 404, { error: 'Pending device not found' });
    }
    const code = normalizePairingCode(input.pairingCode);
    if (code.length !== 16 || !secretEqual(hash(code), pending.pairingCodeHash)) {
      return json(response, 403, { error: 'Pairing code does not match this endpoint' });
    }
    const { pairingCodeHash: _pairingCodeHash, ...device } = pending;
    store.devices[deviceId] = {
      ...device,
      pairedAt: new Date().toISOString(),
      online: false,
      lastSeen: null,
    };
    delete store.pendingDevices[deviceId];
    audit('device.pairing.approved', 'operator', { deviceId, name: device.name }, 'success');
    save();
    return json(response, 200, { deviceId, status: 'approved' });
  }
  const pairingDismissMatch = url.pathname.match(/^\/api\/pending-devices\/([a-f0-9-]+)$/i);
  if (request.method === 'DELETE' && pairingDismissMatch) {
    if (!requireAdmin(request, response)) return;
    const deviceId = pairingDismissMatch[1];
    const pending = store.pendingDevices[deviceId];
    if (!pending) return json(response, 404, { error: 'Pending device not found' });
    delete store.pendingDevices[deviceId];
    audit('device.pairing.rejected', 'operator', { deviceId, name: pending.name }, 'warning');
    save();
    return json(response, 200, { ignored: true });
  }
  if (request.method === 'GET' && url.pathname === '/api/devices') {
    if (!requireAdmin(request, response)) return;
    return json(response, 200, { devices: Object.values(store.devices).map(publicDevice) });
  }
  if (request.method === 'GET' && url.pathname === '/api/jobs') {
    if (!requireAdmin(request, response)) return;
    return json(response, 200, { jobs: Object.values(store.jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }
  if (request.method === 'GET' && url.pathname === '/api/audit') {
    if (!requireAdmin(request, response)) return;
    const requestedLimit = Number(url.searchParams.get('limit') || 250);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, Math.floor(requestedLimit))) : 250;
    return json(response, 200, { events: store.audit.slice(0, limit) });
  }
  const commandMatch = url.pathname.match(/^\/api\/devices\/([a-f0-9-]+)\/commands$/i);
  if (request.method === 'POST' && commandMatch) {
    if (!requireAdmin(request, response)) return;
    const input = await body(request);
    const job = queueCommand(commandMatch[1], input.action, input.payload);
    return json(response, 202, { job });
  }
  if (request.method === 'POST' && url.pathname === '/api/sessions') {
    if (!requireAdmin(request, response)) return;
    const input = await body(request);
    if (!store.devices[input.deviceId]) return json(response, 404, { error: 'Device not found' });
    if (typeof input.customer !== 'string' || !input.customer.trim() || input.customer.length > 160) {
      return json(response, 400, { error: 'Customer or organization is required and must be under 160 characters' });
    }
    if (typeof input.issue !== 'string' || !input.issue.trim() || input.issue.length > 2000) {
      return json(response, 400, { error: 'Request description is required and must be under 2000 characters' });
    }
    const id = crypto.randomUUID();
    const session = {
      id, deviceId: input.deviceId, code: `AG-${crypto.randomInt(1000, 9999)}-${crypto.randomInt(1000, 9999)}`,
      status: 'requested', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      mode: input.mode === 'unattended' ? 'unattended' : 'interactive', customer: input.customer.trim(),
      issue: input.issue.trim(), relayId,
    };
    store.sessions[id] = session;
    const job = queueCommand(input.deviceId, 'session.request', { sessionId: id, mode: session.mode });
    session.requestJobId = job.id;
    audit('session.requested', 'operator', { sessionId: id, deviceId: input.deviceId, mode: session.mode });
    save();
    return json(response, 201, { session });
  }
  if (request.method === 'GET' && url.pathname === '/api/sessions') {
    if (!requireAdmin(request, response)) return;
    const sessions = Object.values(store.sessions).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(response, 200, { sessions });
  }
  return json(response, 404, { error: 'Not found' });
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    console.error(error);
    json(response, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
  });
});

const webSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
  }
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/agent') {
    const deviceId = url.searchParams.get('deviceId');
    const device = store.devices[deviceId];
    const deviceToken = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const tokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');
    if (!device || !secretEqual(tokenHash, device.tokenHash)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.clientKind = 'agent'; webSocket.deviceId = deviceId;
      webSockets.emit('connection', webSocket, request);
    });
    return;
  }
  if (url.pathname === '/operator') {
    const protocols = String(request.headers['sec-websocket-protocol'] || '').split(',').map((value) => value.trim());
    const tokenProtocol = protocols.find((value) => value.startsWith('bearer.'));
    if (!protocols.includes('agon.operator.v1') || !secretEqual(tokenProtocol?.slice('bearer.'.length), adminToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.clientKind = 'operator'; webSockets.emit('connection', webSocket, request);
    });
    return;
  }
  socket.destroy();
});

webSockets.on('connection', (socket) => {
  if (socket.clientKind === 'operator') {
    operators.add(socket);
    socket.send(JSON.stringify({ type: 'snapshot', relayId, devices: Object.values(store.devices).map(publicDevice) }));
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'command') queueCommand(message.deviceId, message.action, message.payload);
      } catch (error) { socket.send(JSON.stringify({ type: 'error', error: error.message })); }
    });
    socket.on('close', () => operators.delete(socket));
    return;
  }

  const deviceId = socket.deviceId;
  const previous = agents.get(deviceId);
  if (previous) previous.close(4001, 'Replaced by a newer agent connection');
  agents.set(deviceId, socket);
  const device = store.devices[deviceId];
  device.online = true; device.lastSeen = new Date().toISOString(); device.relayId = relayId;
  audit('agent.connected', 'agent', { deviceId, name: device.name });
  save();
  broadcastOperators({ type: 'device', device: publicDevice(device) });

  for (const job of Object.values(store.jobs)) {
    if (job.deviceId === deviceId && job.status === 'queued') {
      job.status = 'dispatched'; job.updatedAt = new Date().toISOString();
      socket.send(JSON.stringify({ type: 'command', jobId: job.id, action: job.action, payload: job.payload }));
    }
  }

  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const current = store.devices[deviceId];
    if (!current) return;
    if ((message.type === 'hello' || message.type === 'heartbeat') && message.device) {
      const allowed = ['hostname', 'name', 'group', 'os', 'arch', 'agent', 'cpus', 'interfaces'];
      for (const key of allowed) if (message.device[key] !== undefined) current[key] = message.device[key];
      current.lastSeen = new Date().toISOString(); current.online = true;
      save(); broadcastOperators({ type: 'device', device: publicDevice(current) });
    }
    if (message.type === 'command_result' && store.jobs[message.jobId]) {
      const job = store.jobs[message.jobId];
      if (job.deviceId !== deviceId) return;
      job.status = message.error ? 'failed' : 'completed'; job.result = message.result || null;
      job.error = message.error || null; job.updatedAt = new Date().toISOString();
      if (job.action === 'session.request') {
        const session = Object.values(store.sessions).find((item) => item.requestJobId === job.id);
        if (session) session.status = message.error ? 'consent_required' : 'accepted';
      }
      audit(message.error ? 'job.failed' : 'job.completed', 'agent', { jobId: job.id, deviceId, action: job.action, error: job.error }, message.error ? 'warning' : 'info');
      save(); broadcastOperators({ type: 'job', job });
    }
  });

  socket.on('close', () => {
    if (agents.get(deviceId) !== socket) return;
    agents.delete(deviceId);
    const current = store.devices[deviceId];
    if (current) { current.online = false; current.lastSeen = new Date().toISOString(); }
    audit('agent.disconnected', 'agent', { deviceId, name: current?.name });
    save(); broadcastOperators({ type: 'device', device: current ? publicDevice(current) : { id: deviceId, online: false } });
  });
});

server.listen(port, () => {
  console.log(`Agon control plane ${relayId} listening on http://0.0.0.0:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearTimeout(saveTimer);
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  server.close(() => process.exit(0));
});
