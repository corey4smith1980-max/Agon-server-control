import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import {
  addAudit,
  createRecord,
  getRecord,
  getRecordById,
  listRecords,
  saveRecord,
} from "./agonStore";

const allowedActions = new Set([
  "agent.ping",
  "inventory.refresh",
  "diagnostics.network",
  "session.request",
]);

type AgentDeviceInfo = {
  hostname?: string;
  name?: string;
  group?: string;
  os?: string;
  arch?: string;
  agent?: string;
  cpus?: number;
  interfaces?: number;
};

type AgentMessage = {
  type?: string;
  jobId?: string;
  action?: string;
  device?: AgentDeviceInfo;
  result?: unknown;
  error?: string;
};

type DeviceConnection = {
  ownerId: string;
  socket: WebSocket;
};

const connections = new Map<string, DeviceConnection>();
const requestContexts = new WeakMap<
  IncomingMessage,
  { deviceId: string; ownerId: string }
>();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function matchesHash(candidate: string, expected: unknown): boolean {
  if (typeof expected !== "string") return false;
  const left = Buffer.from(sha256(candidate));
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, 200) : fallback;
}

async function updateHeartbeat(
  ownerId: string,
  deviceId: string,
  info?: AgentDeviceInfo,
): Promise<void> {
  const current = await getRecord(ownerId, "device", deviceId);
  if (!current) return;
  const lastSeen = new Date().toISOString();
  await saveRecord(ownerId, "device", deviceId, {
    ...current.data,
    hostname: text(info?.hostname, text(current.data.hostname)),
    name: text(info?.name, text(current.data.name)),
    group: text(info?.group, text(current.data.group, "Unassigned")),
    os: text(info?.os, text(current.data.os)),
    arch: text(info?.arch, text(current.data.arch)),
    agent: text(info?.agent, text(current.data.agent, "1.0.0")),
    cpus: Number.isFinite(info?.cpus) ? info?.cpus : current.data.cpus,
    interfaces: Number.isFinite(info?.interfaces)
      ? info?.interfaces
      : current.data.interfaces,
    online: true,
    lastSeen,
  });
}

async function completeJob(
  ownerId: string,
  deviceId: string,
  message: AgentMessage,
): Promise<void> {
  if (!message.jobId) return;
  const job = await getRecord(ownerId, "job", message.jobId);
  if (!job || job.data.deviceId !== deviceId) return;
  const completedAt = new Date().toISOString();
  const failed = Boolean(message.error);
  const result = message.result ?? null;
  const jobData = {
    ...job.data,
    status: failed ? "failed" : "completed",
    progress: 100,
    updatedAt: completedAt,
    completedAt,
    result,
    error: message.error || null,
  };
  await saveRecord(ownerId, "job", job.id, jobData);

  if (job.data.action === "session.request") {
    const payload = (job.data.payload ?? {}) as Record<string, unknown>;
    const sessionId = text(payload.sessionId);
    const session = sessionId
      ? await getRecord(ownerId, "session", sessionId)
      : null;
    if (session) {
      const resultObject =
        result && typeof result === "object"
          ? (result as Record<string, unknown>)
          : {};
      const status =
        failed || resultObject.consentRequired === true
          ? "consent_required"
          : resultObject.accepted === true
            ? "accepted"
            : session.data.status;
      await saveRecord(ownerId, "session", session.id, {
        ...session.data,
        status,
        endpointDecision: failed
          ? text(message.error, "Endpoint policy requires local consent")
          : result,
        updatedAt: completedAt,
      });
    }
  }

  await addAudit(
    ownerId,
    failed ? "job.failed" : "job.completed",
    {
      jobId: job.id,
      deviceId,
      action: job.data.action,
      error: message.error || undefined,
    },
    failed ? "warning" : "success",
    "Agon Agent",
  );
}

async function sendQueuedJobs(
  ownerId: string,
  deviceId: string,
  socket: WebSocket,
): Promise<void> {
  const jobs = await listRecords(ownerId, "job", 1000);
  for (const job of jobs) {
    if (job.data.deviceId !== deviceId || job.data.status !== "queued") continue;
    if (socket.readyState !== WebSocket.OPEN) return;
    const payload = (job.data.payload ?? {}) as Record<string, unknown>;
    socket.send(
      JSON.stringify({
        type: "command",
        jobId: job.id,
        action: job.data.action,
        payload,
      }),
    );
    const updatedAt = new Date().toISOString();
    await saveRecord(ownerId, "job", job.id, {
      ...job.data,
      status: "running",
      updatedAt,
    });
  }
}

export async function queueAgonCommand(
  ownerId: string,
  deviceId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!allowedActions.has(action)) return null;
  const device = await getRecord(ownerId, "device", deviceId);
  if (!device) return null;

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const job = {
    deviceId,
    action,
    payload,
    actor: "Operator",
    status: "queued",
    progress: 0,
    createdAt,
    updatedAt: createdAt,
    result: null,
    error: null,
  };
  await createRecord(ownerId, "job", job, id);

  const connection = connections.get(deviceId);
  if (connection?.ownerId === ownerId && connection.socket.readyState === WebSocket.OPEN) {
    connection.socket.send(
      JSON.stringify({ type: "command", jobId: id, action, payload }),
    );
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    await saveRecord(ownerId, "job", id, job);
  }

  await addAudit(ownerId, "job.created", { jobId: id, deviceId, action });
  return { ...job, id };
}

export function disconnectAgonDevice(deviceId: string): void {
  const connection = connections.get(deviceId);
  if (!connection) return;
  connections.delete(deviceId);
  connection.socket.close(4003, "Device enrollment revoked");
}

function rejectUpgrade(socket: Duplex, status: number): void {
  const statusText = status === 401 ? "Unauthorized" : "Not Found";
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachAgonWebSockets(server: HttpServer): void {
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/api/agon/agent") {
      rejectUpgrade(socket, 404);
      return;
    }

    void (async () => {
      const deviceId = url.searchParams.get("deviceId") || "";
      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
      const record = deviceId
        ? await getRecordById("device", deviceId)
        : null;
      if (!record || !matchesHash(bearer, record.data.tokenHash)) {
        rejectUpgrade(socket, 401);
        return;
      }

      requestContexts.set(request, { deviceId, ownerId: record.ownerId });
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSockets.emit("connection", webSocket, request);
      });
    })().catch(() => rejectUpgrade(socket, 401));
  });

  webSockets.on("connection", (socket, request) => {
    const context = requestContexts.get(request);
    if (!context) {
      socket.close(1008, "Invalid device credentials");
      return;
    }
    const { deviceId, ownerId } = context;
    const previous = connections.get(deviceId);
    if (previous && previous.socket !== socket) previous.socket.close(4001, "Reconnected");
    connections.set(deviceId, { ownerId, socket });

    void updateHeartbeat(ownerId, deviceId);
    void sendQueuedJobs(ownerId, deviceId, socket);

    socket.on("message", (raw) => {
      void (async () => {
        const message = JSON.parse(raw.toString()) as AgentMessage;
        if (message.type === "hello") {
          await updateHeartbeat(ownerId, deviceId, message.device);
        } else if (message.type === "heartbeat") {
          await updateHeartbeat(ownerId, deviceId, message.device);
          await sendQueuedJobs(ownerId, deviceId, socket);
        } else if (message.type === "command_result") {
          await completeJob(ownerId, deviceId, message);
        }
      })().catch(() => socket.close(1003, "Invalid agent message"));
    });

    socket.on("close", () => {
      if (connections.get(deviceId)?.socket !== socket) return;
      connections.delete(deviceId);
      void (async () => {
        const record = await getRecord(ownerId, "device", deviceId);
        if (record) {
          await saveRecord(ownerId, "device", deviceId, {
            ...record.data,
            online: false,
          });
        }
      })();
    });

    socket.on("error", () => socket.close());
  });
}
