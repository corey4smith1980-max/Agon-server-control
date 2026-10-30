import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "@workspace/db";
import { addAudit, createRecord, getRecord, listRecords } from "../lib/agonStore";
import { queueAgonCommand } from "../lib/agonWebSocket";

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

function getConsoleOrigin(originHeader: string | undefined): string | null {
  if (!originHeader) return null;
  try {
    const url = new URL(originHeader);
    if (
      url.origin !== originHeader ||
      (url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
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

// Each configured installer receives one short-lived enrollment token. The
// plaintext is returned once to the signed-in operator and only its hash is stored.
router.post("/enrollment-tokens", requireOperator, async (request, response) => {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const deviceName = cleanText(request.body?.deviceName, 100, "Agon managed device");
  const deviceGroup = cleanText(request.body?.group, 80, "Unassigned");
  const allowUnattended = request.body?.allowUnattended === true;
  const origin = getConsoleOrigin(request.get("origin"));
  if (!origin) {
    response.status(400).json({ error: "Could not determine the secure console origin." });
    return;
  }

  const owner = ownerId(response);
  const recent = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM agon_enrollment_tokens
     WHERE owner_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [owner],
  );
  if (Number(recent.rows[0]?.count ?? 0) >= 20) {
    response.status(429).json({ error: "Installer limit reached. Try again later." });
    return;
  }

  await pool.query(
    `INSERT INTO agon_enrollment_tokens
       (id, owner_id, token_hash, device_name, device_group, allow_unattended, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '24 hours')`,
    [id, owner, hashToken(token), deviceName, deviceGroup, allowUnattended],
  );
  await addAudit(owner, "installer.credential.created", {
    group: deviceGroup,
    expiresInHours: 24,
    useLimit: 1,
  });

  response.status(201).json({
    serverUrl: `${origin}/api/agon`,
    enrollmentToken: token,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    useLimit: 1,
  });
});

// Agent enrollment is unauthenticated by design; each installer carries a
// one-use token bound to the signed-in operator who generated it.
router.post("/api/enroll", async (request, response) => {
  const token = cleanText(request.body?.enrollmentToken, 256);
  const deviceInfo = request.body?.device;
  if (!token || !deviceInfo || typeof deviceInfo !== "object") {
    response.status(400).json({ error: "Installer enrollment data is incomplete." });
    return;
  }

  const client = await pool.connect();
  let created:
    | { deviceId: string; ownerId: string; deviceToken: string; deviceName: string }
    | undefined;
  try {
    await client.query("BEGIN");
    const tokenResult = await client.query<{
      id: string;
      owner_id: string;
      device_name: string;
      device_group: string;
      allow_unattended: boolean;
    }>(
      `SELECT id, owner_id, device_name, device_group, allow_unattended
       FROM agon_enrollment_tokens
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       FOR UPDATE`,
      [hashToken(token)],
    );
    const enrollment = tokenResult.rows[0];
    if (!enrollment) {
      await client.query("ROLLBACK");
      response.status(403).json({ error: "This installer token is invalid, expired, or already used." });
      return;
    }

    const id = randomUUID();
    const deviceToken = randomBytes(32).toString("base64url");
    const hostname = cleanText(deviceInfo.hostname, 200, "Unknown device");
    const deviceName = cleanText(deviceInfo.name, 100, enrollment.device_name) || hostname;
    const data = {
      name: deviceName,
      hostname,
      group: cleanText(deviceInfo.group, 80, enrollment.device_group) || enrollment.device_group,
      os: cleanText(deviceInfo.os, 100),
      arch: cleanText(deviceInfo.arch, 40),
      agent: cleanText(deviceInfo.agent, 40, "1.0.0"),
      cpus: Number.isFinite(deviceInfo.cpus) ? deviceInfo.cpus : 0,
      interfaces: Number.isFinite(deviceInfo.interfaces) ? deviceInfo.interfaces : 0,
      tokenHash: hashToken(deviceToken),
      relayId: "agon-hosted",
      online: false,
      enrolledAt: new Date().toISOString(),
      lastSeen: null,
      allowUnattended: enrollment.allow_unattended,
    };

    await client.query(
      `UPDATE agon_enrollment_tokens SET used_at = NOW() WHERE id = $1`,
      [enrollment.id],
    );
    await client.query(
      `INSERT INTO agon_records (id, owner_id, kind, data)
       VALUES ($1, $2, 'device', $3::jsonb)`,
      [id, enrollment.owner_id, JSON.stringify(data)],
    );
    const auditId = randomUUID();
    await client.query(
      `INSERT INTO agon_records (id, owner_id, kind, data)
       VALUES ($1, $2, 'audit', $3::jsonb)`,
      [
        auditId,
        enrollment.owner_id,
        JSON.stringify({
          at: new Date().toISOString(),
          action: "device.enrolled",
          actor: "Agon Agent",
          detail: { deviceId: id, name: deviceName },
          severity: "success",
          relayId: "agon-hosted",
        }),
      ],
    );
    await client.query("COMMIT");
    created = {
      deviceId: id,
      ownerId: enrollment.owner_id,
      deviceToken,
      deviceName,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  response.status(200).json({
    deviceId: created!.deviceId,
    deviceToken: created!.deviceToken,
    relayId: "agon-hosted",
  });
});

router.use(requireOperator);

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
