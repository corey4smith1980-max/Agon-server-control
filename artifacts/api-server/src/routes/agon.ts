import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import {
  ApproveAgonPendingDeviceBody,
  ApproveAgonPendingDeviceParams,
  ApproveAgonPendingDeviceResponse,
  CreateAgonPairRequestBody,
  CreateAgonPairRequestResponse,
  IgnoreAgonPendingDeviceParams,
  ListPendingAgonDevicesResponse,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { addAudit, createRecord, getRecord, getRecordById, listRecords } from "../lib/agonStore";
import { disconnectAgonDevice, queueAgonCommand } from "../lib/agonWebSocket";

const router = Router();
const allowedActions = new Set([
  "agent.ping",
  "inventory.refresh",
  "diagnostics.network",
  "session.request",
]);

const requireOperator: RequestHandler = (request, response, next) => {
  const userId = getAuth(request).userId;
  if (!userId) {
    response.status(401).json({ error: "Sign in to access your control plane." });
    return;
  }
  response.locals.ownerId = userId;
  next();
};

function ownerId(response: Parameters<RequestHandler>[1]): string {
  return response.locals.ownerId as string;
}

function cleanText(value: unknown, limit: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim().replace(/\0/g, "").slice(0, limit);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizedPairingCode(value: unknown): string {
  return typeof value === "string"
    ? value.toUpperCase().replace(/[^A-Z2-7]/g, "")
    : "";
}

function hashesMatch(expected: unknown, received: string): boolean {
  if (typeof expected !== "string" || expected.length !== 64) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const receivedBytes = Buffer.from(received, "hex");
  return expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes);
}

const pairRequestWindows = new Map<string, { startedAt: number; count: number }>();

function allowPairRequest(key: string): boolean {
  const now = Date.now();
  const current = pairRequestWindows.get(key);
  if (!current || now - current.startedAt >= 10 * 60 * 1000) {
    pairRequestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 12) return false;
  current.count += 1;
  if (pairRequestWindows.size > 5000) {
    for (const [entry, window] of pairRequestWindows) {
      if (now - window.startedAt >= 10 * 60 * 1000) pairRequestWindows.delete(entry);
    }
  }
  return true;
}

function isNativeAgentRequest(request: Parameters<RequestHandler>[0]): boolean {
  return request.get("X-Requested-With") === "XMLHttpRequest";
}

router.get("/health", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({
    ok: true,
    service: "agon-hosted-control-plane",
    version: "1.0.0",
    transport: "WebSocket",
  });
});

// Devices create their own identity. Operators must verify the endpoint's
// pairing code before its credential is activated for the relay.
router.post("/api/pair-requests", async (request, response) => {
  if (!isNativeAgentRequest(request)) {
    response.status(403).json({ error: "Expected X-Requested-With header." });
    return;
  }
  const parsedBody = CreateAgonPairRequestBody.safeParse(request.body);
  if (!parsedBody.success) {
    response.status(400).json({ error: "Device pairing data is invalid." });
    return;
  }
  const input = parsedBody.data;
  const owner = cleanText(input.ownerId, 128);
  const deviceId = cleanText(input.deviceId, 80);
  const deviceToken = cleanText(input.deviceToken, 256);
  const pairingCode = normalizedPairingCode(input.pairingCode);
  const deviceInfo = input.device;
  if (pairingCode.length !== 16) {
    response.status(400).json({ error: "Device pairing code is invalid." });
    return;
  }

  const tokenHash = hashToken(deviceToken);
  const pairingCodeHash = hashToken(pairingCode);
  const active = await getRecordById("device", deviceId);
  if (active) {
    if (active.ownerId !== owner || !hashesMatch(active.data.tokenHash, tokenHash)) {
      response.status(409).json({ error: "This device identity is already in use." });
      return;
    }
    response.status(200).json(CreateAgonPairRequestResponse.parse({ status: "approved" }));
    return;
  }

  const rejected = await getRecordById("rejected_device", deviceId);
  if (rejected) {
    response.status(403).json({ error: "This device pairing request was rejected." });
    return;
  }

  const pending = await getRecordById("pending_device", deviceId);
  if (pending) {
    if (
      pending.ownerId !== owner ||
      !hashesMatch(pending.data.tokenHash, tokenHash) ||
      !hashesMatch(pending.data.pairingCodeHash, pairingCodeHash)
    ) {
      response.status(409).json({ error: "This device identity is already in use." });
      return;
    }
    response.status(202).json(CreateAgonPairRequestResponse.parse({ status: "pending" }));
    return;
  }

  if (!allowPairRequest(`${request.ip || "unknown"}:${owner}`)) {
    response.status(429).json({ error: "Too many new device pairing requests. Try again later." });
    return;
  }

  const pendingCount = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM agon_records
     WHERE owner_id = $1 AND kind = 'pending_device'
       AND created_at > NOW() - INTERVAL '24 hours'`,
    [owner],
  );
  if (Number(pendingCount.rows[0]?.count ?? 0) >= 50) {
    response.status(429).json({ error: "This account has too many unapproved devices." });
    return;
  }

  const hostname = cleanText(deviceInfo.hostname, 200, "Unknown device");
  const deviceName = cleanText(deviceInfo.name, 100, hostname) || hostname;
  await createRecord(owner, "pending_device", {
    name: deviceName,
    hostname,
    group: cleanText(deviceInfo.group, 80, "Unassigned"),
    os: cleanText(deviceInfo.os, 100),
    arch: cleanText(deviceInfo.arch, 40),
    agent: cleanText(deviceInfo.agent, 40, "1.0.0"),
    cpus: Number.isFinite(deviceInfo.cpus) ? deviceInfo.cpus : 0,
    interfaces: Number.isFinite(deviceInfo.interfaces) ? deviceInfo.interfaces : 0,
    tokenHash,
    pairingCodeHash,
    relayId: "agon-hosted",
    online: false,
    allowUnattended: input.allowUnattended === true,
    requestedAt: new Date().toISOString(),
  }, deviceId);
  await addAudit(owner, "device.pairing.requested", {
    deviceId,
    name: deviceName,
  }, "info", "Agon Agent");
  response.status(202).json(CreateAgonPairRequestResponse.parse({ status: "pending" }));
});

router.use(requireOperator);

router.get("/pending-devices", async (_request, response) => {
  const pending = await listRecords(ownerId(response), "pending_device", 100);
  response.setHeader("Cache-Control", "no-store");
  response.json(ListPendingAgonDevicesResponse.parse({
    devices: pending
      .map(({ id, data, createdAt }) => ({
        id,
        name: data.name,
        hostname: data.hostname,
        group: data.group,
        os: data.os,
        arch: data.arch,
        agent: data.agent,
        requestedAt: data.requestedAt ?? createdAt.toISOString(),
      })),
  }));
});

router.post("/pending-devices/:deviceId/approve", async (request, response) => {
  const owner = ownerId(response);
  const parsedParams = ApproveAgonPendingDeviceParams.safeParse(request.params);
  const parsedBody = ApproveAgonPendingDeviceBody.safeParse(request.body);
  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({ error: "Pairing approval data is invalid." });
    return;
  }
  const deviceId = cleanText(parsedParams.data.deviceId, 80);
  const pairingCode = normalizedPairingCode(parsedBody.data.pairingCode);
  if (!deviceId || pairingCode.length !== 16) {
    response.status(400).json({ error: "Enter the pairing code shown by the endpoint installer." });
    return;
  }

  const client = await pool.connect();
  let approvedName = "";
  try {
    await client.query("BEGIN");
    const result = await client.query<{ data: Record<string, unknown> }>(
      `SELECT data
       FROM agon_records
       WHERE id = $1 AND owner_id = $2 AND kind = 'pending_device'
       FOR UPDATE`,
      [deviceId, owner],
    );
    const pending = result.rows[0]?.data;
    if (!pending) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Pending device not found." });
      return;
    }
    if (!hashesMatch(pending.pairingCodeHash, hashToken(pairingCode))) {
      await client.query("ROLLBACK");
      response.status(403).json({ error: "Pairing code does not match this endpoint." });
      return;
    }

    const { pairingCodeHash: _pairingCodeHash, ...deviceData } = pending;
    approvedName = String(deviceData.name ?? "Agon managed device");
    const activeDevice = {
      ...deviceData,
      online: false,
      pairedAt: new Date().toISOString(),
      lastSeen: null,
    };
    await client.query(
      `UPDATE agon_records
       SET kind = 'device', data = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND owner_id = $2 AND kind = 'pending_device'`,
      [deviceId, owner, JSON.stringify(activeDevice)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  disconnectAgonDevice(deviceId);
  await addAudit(owner, "device.pairing.approved", { deviceId, name: approvedName }, "success");
  response.json(ApproveAgonPendingDeviceResponse.parse({ deviceId, status: "approved" }));
});

router.delete("/pending-devices/:deviceId", async (request, response) => {
  const owner = ownerId(response);
  const parsedParams = IgnoreAgonPendingDeviceParams.safeParse(request.params);
  if (!parsedParams.success) {
    response.status(400).json({ error: "Device ID is invalid." });
    return;
  }
  const deviceId = cleanText(parsedParams.data.deviceId, 80);
  const result = await pool.query<{ data: Record<string, unknown> }>(
    `UPDATE agon_records
     SET kind = 'rejected_device',
         data = data - 'pairingCodeHash',
         updated_at = NOW()
     WHERE id = $1 AND owner_id = $2 AND kind = 'pending_device'
     RETURNING data`,
    [deviceId, owner],
  );
  const rejected = result.rows[0];
  if (!rejected) {
    response.status(404).json({ error: "Pending device not found." });
    return;
  }
  await addAudit(owner, "device.pairing.rejected", {
    deviceId,
    name: rejected.data.name,
  }, "warning");
  response.status(204).end();
});

router.get("/devices", async (_request, response) => {
  const devices = await listRecords(ownerId(response), "device", 1000);
  response.setHeader("Cache-Control", "no-store");
  response.json({
    devices: devices.map(({ id, data }) => {
      const { tokenHash: _tokenHash, ...safeDevice } = data;
      return { ...safeDevice, id };
    }),
  });
});

router.delete("/devices/:deviceId", async (request, response) => {
  const owner = ownerId(response);
  const result = await pool.query(
    `DELETE FROM agon_records
     WHERE id = $1 AND owner_id = $2 AND kind = 'device'
     RETURNING id`,
    [request.params.deviceId, owner],
  );
  if (!result.rowCount) {
    response.status(404).json({ error: "Device not found in this account." });
    return;
  }
  disconnectAgonDevice(request.params.deviceId);
  await addAudit(owner, "device.access.revoked", {
    deviceId: request.params.deviceId,
  });
  response.status(204).end();
});

router.get("/jobs", async (_request, response) => {
  const jobs = await listRecords(ownerId(response), "job", 1000);
  response.setHeader("Cache-Control", "no-store");
  response.json({ jobs: jobs.map(({ id, data }) => ({ ...data, id })) });
});

router.get("/sessions", async (_request, response) => {
  const sessions = await listRecords(ownerId(response), "session", 1000);
  response.setHeader("Cache-Control", "no-store");
  response.json({ sessions: sessions.map(({ id, data }) => ({ ...data, id })) });
});

router.get("/audit", async (request, response) => {
  const requestedLimit = Number(request.query.limit || 250);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
    : 250;
  const events = await listRecords(ownerId(response), "audit", limit);
  response.setHeader("Cache-Control", "no-store");
  response.json({ events: events.map(({ id, data }) => ({ ...data, id })) });
});

router.post("/devices/:deviceId/commands", async (request, response) => {
  const action = cleanText(request.body?.action, 80);
  if (!allowedActions.has(action)) {
    response.status(400).json({ error: "Requested action is not allowlisted." });
    return;
  }
  const payload =
    request.body?.payload && typeof request.body.payload === "object"
      ? request.body.payload as Record<string, unknown>
      : {};
  const job = await queueAgonCommand(
    ownerId(response),
    request.params.deviceId,
    action,
    payload,
  );
  if (!job) {
    response.status(404).json({ error: "Device not found in this account." });
    return;
  }
  response.status(202).json({ job });
});

router.post("/sessions", async (request, response) => {
  const owner = ownerId(response);
  const customer = cleanText(request.body?.customer, 120);
  const issue = cleanText(request.body?.issue, 2000);
  const deviceId = cleanText(request.body?.deviceId, 80);
  const mode = request.body?.mode === "unattended" ? "unattended" : "interactive";
  if (!customer || !issue) {
    response.status(400).json({ error: "Customer and issue are required." });
    return;
  }
  const device = deviceId ? await getRecord(owner, "device", deviceId) : null;
  if (deviceId && !device) {
    response.status(404).json({ error: "Device not found in this account." });
    return;
  }

  const id = randomUUID();
  const code = `AG-${randomBytes(3).toString("hex").toUpperCase()}`;
  const session = {
    code,
    customer,
    issue,
    deviceId: device?.id ?? null,
    deviceName: String(device?.data.name ?? "Waiting for device"),
    mode,
    status: "waiting",
    actor: "Operator",
    relayId: "agon-hosted",
    createdAt: new Date().toISOString(),
  };
  await createRecord(owner, "session", session, id);
  if (device) {
    await queueAgonCommand(owner, device.id, "session.request", {
      sessionId: id,
      mode,
      customer,
      issue,
    });
  }
  await addAudit(owner, "session.requested", {
    sessionId: id,
    deviceId: device?.id ?? null,
    deviceName: session.deviceName,
    code,
  });
  response.status(201).json({ session: { ...session, id } });
});

export default router;
