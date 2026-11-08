import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { isIP } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
  addAudit,
  createRecord,
  getRecord,
  getRecordById,
  listRecords,
  saveRecord,
} from "./agonStore";
import { logger } from "./logger";

const allowedActions = new Set([
  "agent.ping",
  "inventory.refresh",
  "diagnostics.network",
  "session.request",
  "agent.upgrade",
]);
const dispatchingDevices = new Set<string>();
const retryRunningJobsAfterMs = 60_000;
const pingIntervalMs = 30_000;

type AgentDeviceInfo = {
  hostname?: string;
  name?: string;
  group?: string;
  os?: string;
  osVersion?: string;
  arch?: string;
  agent?: string;
  cpus?: number;
  cpuModel?: string;
  interfaces?: number;
  ipAddresses?: string[];
  memoryTotalBytes?: number;
  memoryUsedBytes?: number;
  diskTotalBytes?: number;
  diskUsedBytes?: number;
  signingCertSha256?: string;
};

type AgentMessage = {
  type?: string;
  jobId?: string;
  action?: string;
  sessionId?: string;
  device?: AgentDeviceInfo;
  result?: unknown;
  error?: string;
  jpeg?: string;
  width?: number;
  height?: number;
};

type DeviceConnection = {
  ownerId: string;
  socket: WebSocket;
};

const connections = new Map<string, DeviceConnection>();
const companionConnections = new Map<string, DeviceConnection>();
const viewerConnections = new Map<string, { ownerId: string; socket: WebSocket }>();
const activeDesktopSessions = new Map<string, { ownerId: string; deviceId: string }>();
const requestContexts = new WeakMap<
  IncomingMessage,
  { deviceId: string; ownerId: string; channel: "agent" | "companion" }
>();
const viewerContexts = new WeakMap<
  IncomingMessage,
  { sessionId: string; ownerId: string }
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

function byteCount(value: unknown, fallback: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  return typeof fallback === "number" && Number.isSafeInteger(fallback) && fallback >= 0
    ? fallback
    : undefined;
}

function ipAddresses(value: unknown, fallback: unknown): string[] {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  return source
    .filter((entry): entry is string => typeof entry === "string" && isIP(entry) !== 0)
    .slice(0, 12);
}

async function updateHeartbeat(
  ownerId: string,
  deviceId: string,
  info?: AgentDeviceInfo,
): Promise<void> {
  const current = await getRecord(ownerId, "device", deviceId);
  if (!current) return;
  const lastSeen = new Date().toISOString();
  const signingCertSha256 = text(info?.signingCertSha256, text(current.data.signingCertSha256)).toLowerCase();
  let signingKeyId = text(current.data.signingKeyId);
  if (signingCertSha256) {
    const keys = await listRecords(ownerId, "signing_key", 500);
    const match = keys.find((key) => text(key.data.certificateSha256).toLowerCase() === signingCertSha256);
    if (match) {
      signingKeyId = match.id;
      if (text(match.data.deviceId) !== deviceId) {
        await saveRecord(ownerId, "signing_key", match.id, { ...match.data, deviceId });
      }
    }
  }
  await saveRecord(ownerId, "device", deviceId, {
    ...current.data,
    hostname: text(info?.hostname, text(current.data.hostname)),
    name: text(info?.name, text(current.data.name)),
    group: text(info?.group, text(current.data.group, "Unassigned")),
    os: text(info?.os, text(current.data.os)),
    osVersion: text(info?.osVersion, text(current.data.osVersion)),
    arch: text(info?.arch, text(current.data.arch)),
    agent: text(info?.agent, text(current.data.agent, "1.0.0")),
    cpus: Number.isFinite(info?.cpus) ? info?.cpus : current.data.cpus,
    cpuModel: text(info?.cpuModel, text(current.data.cpuModel)),
    interfaces: Number.isFinite(info?.interfaces)
      ? info?.interfaces
      : current.data.interfaces,
    ipAddresses: ipAddresses(info?.ipAddresses, current.data.ipAddresses),
    memoryTotalBytes: byteCount(info?.memoryTotalBytes, current.data.memoryTotalBytes),
    memoryUsedBytes: byteCount(info?.memoryUsedBytes, current.data.memoryUsedBytes),
    diskTotalBytes: byteCount(info?.diskTotalBytes, current.data.diskTotalBytes),
    diskUsedBytes: byteCount(info?.diskUsedBytes, current.data.diskUsedBytes),
    signingCertSha256: signingCertSha256 || current.data.signingCertSha256 || "",
    signingKeyId,
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
    const consentRequestId = text(payload.consentRequestId);
    const session = sessionId
      ? await getRecord(ownerId, "session", sessionId)
      : null;
    if (
      session &&
      session.data.status !== "ended" &&
      session.data.status !== "declined" &&
      session.data.consentRequestId === consentRequestId
    ) {
      const resultObject =
        result && typeof result === "object"
          ? (result as Record<string, unknown>)
          : {};
      const status =
        failed || resultObject.consentRequired === true
          ? "consent_required"
          : resultObject.declined === true
            ? "declined"
          : resultObject.accepted === true
            ? companionConnections.get(deviceId)?.ownerId === ownerId &&
              companionConnections.get(deviceId)?.socket.readyState === WebSocket.OPEN
              ? "active"
              : "disconnected"
            : session.data.status;
      await saveRecord(ownerId, "session", session.id, {
        ...session.data,
        status,
        endpointDecision: failed
          ? text(message.error, "Endpoint policy requires local consent")
          : result,
        updatedAt: completedAt,
      });
      if (status === "active" && typeof session.data.deviceId === "string") {
        activeDesktopSessions.set(session.id, {
          ownerId,
          deviceId: session.data.deviceId,
        });
        sendViewerStatus(session.id, "active");
        const companion = companionConnections.get(session.data.deviceId);
        if (companion?.ownerId === ownerId && companion.socket.readyState === WebSocket.OPEN) {
          companion.socket.send(JSON.stringify({ type: "desktop_resume", sessionId: session.id }));
        }
      } else {
        sendViewerStatus(session.id, String(status));
      }
      await addAudit(
        ownerId,
        status === "active"
          ? "session.consent.accepted"
          : status === "declined"
            ? "session.consent.declined"
            : status === "disconnected"
              ? "session.disconnected"
            : "session.consent.required",
        {
          sessionId: session.id,
          deviceId,
          code: session.data.code,
        },
        status === "active" ? "success" : "warning",
        "Agon Endpoint",
      );
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
  channel: "agent" | "companion",
): Promise<void> {
  const dispatchKey = `${deviceId}:${channel}`;
  if (dispatchingDevices.has(dispatchKey)) return;
  dispatchingDevices.add(dispatchKey);
  try {
    const jobs = await listRecords(ownerId, "job", 1000);
    for (const job of jobs) {
      if (job.data.deviceId !== deviceId) continue;
      let jobData = job.data;
      if (jobData.action === "session.request") {
        const payload = (jobData.payload ?? {}) as Record<string, unknown>;
        const sessionId = text(payload.sessionId);
        const consentRequestId = text(payload.consentRequestId);
        const session = sessionId
          ? await getRecord(ownerId, "session", sessionId)
          : null;
        if (
          !session ||
          session.data.status !== "waiting" ||
          session.data.consentRequestId !== consentRequestId
        ) {
          await saveRecord(ownerId, "job", job.id, {
            ...jobData,
            status: "failed",
            progress: 100,
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            error: "Consent request is no longer active.",
          });
          continue;
        }
      }
      if (jobData.status === "running") {
        const lastUpdate = Date.parse(String(jobData.updatedAt ?? ""));
        if (
          Number.isFinite(lastUpdate) &&
          Date.now() - lastUpdate < retryRunningJobsAfterMs
        ) {
          continue;
        }
        jobData = {
          ...jobData,
          status: "queued",
          progress: 0,
          updatedAt: new Date().toISOString(),
          error: null,
        };
        await saveRecord(ownerId, "job", job.id, jobData);
      }
      if (jobData.status !== "queued") continue;
      if (jobData.action === "session.request" && channel !== "companion") continue;
      if (jobData.action !== "session.request" && channel === "companion") continue;
      if (socket.readyState !== WebSocket.OPEN) return;

      const updatedAt = new Date().toISOString();
      const runningJob = { ...jobData, status: "running", updatedAt };
      await saveRecord(ownerId, "job", job.id, runningJob);
      if (socket.readyState !== WebSocket.OPEN) {
        await saveRecord(ownerId, "job", job.id, {
          ...runningJob,
          status: "queued",
          progress: 0,
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      try {
        socket.send(
          JSON.stringify({
            type: "command",
            jobId: job.id,
            action: jobData.action,
            payload: (jobData.payload ?? {}) as Record<string, unknown>,
          }),
          (error) => {
            if (error) {
              void saveRecord(ownerId, "job", job.id, {
                ...runningJob,
                status: "queued",
                progress: 0,
                updatedAt: new Date().toISOString(),
              }).catch(() => undefined);
            }
          },
        );
      } catch {
        await saveRecord(ownerId, "job", job.id, {
          ...runningJob,
          status: "queued",
          progress: 0,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
    }
  } finally {
    dispatchingDevices.delete(dispatchKey);
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

  const channel = action === "session.request" ? "companion" : "agent";
  const connection = channel === "companion"
    ? companionConnections.get(deviceId)
    : connections.get(deviceId);
  const dispatchKey = `${deviceId}:${channel}`;
  if (
    connection?.ownerId === ownerId &&
    connection.socket.readyState === WebSocket.OPEN &&
    !dispatchingDevices.has(dispatchKey)
  ) {
    dispatchingDevices.add(dispatchKey);
    try {
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      await saveRecord(ownerId, "job", id, job);
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(
          JSON.stringify({ type: "command", jobId: id, action, payload }),
          (error) => {
            if (!error) return;
            void saveRecord(ownerId, "job", id, {
              ...job,
              status: "queued",
              progress: 0,
              updatedAt: new Date().toISOString(),
            }).catch(() => undefined);
          },
        );
      } else {
        job.status = "queued";
        job.updatedAt = new Date().toISOString();
        await saveRecord(ownerId, "job", id, job);
      }
    } finally {
      dispatchingDevices.delete(dispatchKey);
    }
  }

  await addAudit(ownerId, "job.created", { jobId: id, deviceId, action });
  return { ...job, id };
}

export function disconnectAgonDevice(deviceId: string): void {
  for (const [map, connection] of [
    [connections, connections.get(deviceId)],
    [companionConnections, companionConnections.get(deviceId)],
  ] as const) {
    if (!connection) continue;
    map.delete(deviceId);
    connection.socket.close(4003, "Device access revoked");
  }
  for (const [sessionId, session] of activeDesktopSessions) {
    if (session.deviceId !== deviceId) continue;
    activeDesktopSessions.delete(sessionId);
    viewerConnections.get(sessionId)?.socket.send(
      JSON.stringify({ type: "session_status", status: "disconnected" }),
    );
  }
}

export function isAgonCompanionConnected(deviceId: string): boolean {
  return companionConnections.get(deviceId)?.socket.readyState === WebSocket.OPEN;
}

export function hasOtherActiveDesktopSession(deviceId: string, sessionId: string): boolean {
  return [...activeDesktopSessions.entries()].some(
    ([activeSessionId, active]) =>
      active.deviceId === deviceId && activeSessionId !== sessionId,
  );
}

export function endAgonDesktopSession(sessionId: string, deviceId: string): void {
  activeDesktopSessions.delete(sessionId);
  const companion = companionConnections.get(deviceId);
  if (companion?.socket.readyState === WebSocket.OPEN) {
    companion.socket.send(JSON.stringify({ type: "session_stop", sessionId }));
  }
  const viewer = viewerConnections.get(sessionId);
  if (viewer) {
    viewerConnections.delete(sessionId);
    viewer.socket.send(JSON.stringify({ type: "session_status", status: "ended" }));
    viewer.socket.close(1000, "Support session ended");
  }
}

function validDesktopInput(message: Record<string, unknown>): boolean {
  if (message.event === "pointer") {
    return ["move", "down", "up"].includes(String(message.kind)) &&
      typeof message.x === "number" && Number.isFinite(message.x) &&
      message.x >= 0 && message.x <= 1 &&
      typeof message.y === "number" && Number.isFinite(message.y) &&
      message.y >= 0 && message.y <= 1 &&
      ["left", "right", "middle", undefined].includes(message.button as string | undefined);
  }
  return message.event === "key" &&
    typeof message.key === "string" && message.key.length <= 24 &&
    typeof message.down === "boolean";
}

function sendViewerStatus(sessionId: string, status: string): void {
  const viewer = viewerConnections.get(sessionId);
  if (viewer?.socket.readyState !== WebSocket.OPEN) return;
  try {
    viewer.socket.send(JSON.stringify({ type: "session_status", status }));
  } catch {
    viewer.socket.terminate();
  }
}

function rejectUpgrade(socket: Duplex, status: number): void {
  const statusText = status === 401 ? "Unauthorized" : "Not Found";
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachAgonWebSockets(server: HttpServer): void {
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1_500_000,
    perMessageDeflate: false,
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    const isAgentPath = url.pathname === "/api/agon/agent" ||
      url.pathname === "/deployment/api/agon/agent";
    const isViewerPath = url.pathname === "/api/agon/viewer" ||
      url.pathname === "/deployment/api/agon/viewer";
    if (!isAgentPath && !isViewerPath) {
      rejectUpgrade(socket, 404);
      return;
    }

    void (async () => {
      if (isViewerPath) {
        const sessionId = url.searchParams.get("sessionId") || "";
        const token = url.searchParams.get("token") || "";
        const session = sessionId ? await getRecordById("session", sessionId) : null;
        const expiresAt = Date.parse(String(session?.data.viewerTokenExpiresAt ?? ""));
        if (
          !session ||
          !token ||
          expiresAt <= Date.now() ||
          !matchesHash(token, session.data.viewerTokenHash)
        ) {
          rejectUpgrade(socket, 401);
          return;
        }
        viewerContexts.set(request, { sessionId, ownerId: session.ownerId });
        webSockets.handleUpgrade(request, socket, head, (webSocket) => {
          webSockets.emit("connection", webSocket, request);
        });
        return;
      }

      const deviceId = url.searchParams.get("deviceId") || "";
      const channel = url.searchParams.get("channel") === "companion"
        ? "companion"
        : "agent";
      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
      const record = deviceId
        ? await getRecordById("device", deviceId)
        : null;
      if (!record || !matchesHash(bearer, record.data.tokenHash)) {
        rejectUpgrade(socket, 401);
        return;
      }

      requestContexts.set(request, { deviceId, ownerId: record.ownerId, channel });
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSockets.emit("connection", webSocket, request);
      });
    })().catch(() => rejectUpgrade(socket, 401));
  });

  webSockets.on("connection", (socket, request) => {
    const context = requestContexts.get(request);
    const viewerContext = viewerContexts.get(request);
    if (!context && !viewerContext) {
      socket.close(1008, "Invalid connection credentials");
      return;
    }
    if (viewerContext) {
      const { sessionId, ownerId } = viewerContext;
      const previousViewer = viewerConnections.get(sessionId);
      if (previousViewer) previousViewer.socket.close(4001, "Viewer reconnected");
      viewerConnections.set(sessionId, { ownerId, socket });
      const active = activeDesktopSessions.get(sessionId);
      if (active?.ownerId === ownerId) {
        const companion = companionConnections.get(active.deviceId);
        if (companion?.ownerId === ownerId && companion.socket.readyState === WebSocket.OPEN) {
          companion.socket.send(JSON.stringify({ type: "desktop_resume", sessionId }));
        }
      }
      void getRecord(ownerId, "session", sessionId).then((session) => {
        if (!session || socket.readyState !== WebSocket.OPEN) return;
        const status = String(session.data.status ?? "waiting");
        const actualStatus = activeDesktopSessions.has(sessionId)
          ? "active"
          : status === "active" ? "disconnected" : status;
        socket.send(JSON.stringify({
          type: "session_status",
          status: actualStatus,
        }));
      }).catch(() => undefined);

      let lastPointerInputAt = 0;
      socket.on("message", (raw, isBinary) => {
        if (isBinary) {
          socket.close(1003, "Text JSON messages required");
          return;
        }
        if (Buffer.byteLength(raw.toString()) > 2048) {
          socket.close(1009, "Desktop input message too large");
          return;
        }
        let message: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(raw.toString());
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          message = parsed as Record<string, unknown>;
        } catch {
          socket.close(1007, "Invalid JSON message");
          return;
        }
        if (
          message.type !== "desktop_input" ||
          message.sessionId !== sessionId ||
          !validDesktopInput(message) ||
          !activeDesktopSessions.has(sessionId)
        ) return;
        if (message.event === "pointer" && message.kind === "move") {
          const now = Date.now();
          if (now - lastPointerInputAt < 20) return;
          lastPointerInputAt = now;
        }
        const active = activeDesktopSessions.get(sessionId);
        const companion = active && companionConnections.get(active.deviceId);
        if (
          active?.ownerId !== ownerId ||
          !companion ||
          companion.ownerId !== ownerId ||
          companion.socket.readyState !== WebSocket.OPEN
        ) return;
        companion.socket.send(JSON.stringify({
          type: "desktop_input",
          sessionId,
          payload: {
            event: message.event,
            kind: message.kind,
            x: message.x,
            y: message.y,
            button: message.button,
            key: message.key,
            down: message.down,
          },
        }));
      });
      socket.on("close", () => {
        if (viewerConnections.get(sessionId)?.socket === socket) {
          viewerConnections.delete(sessionId);
          const active = activeDesktopSessions.get(sessionId);
          const companion = active && companionConnections.get(active.deviceId);
          if (
            active?.ownerId === ownerId &&
            companion?.ownerId === ownerId &&
            companion.socket.readyState === WebSocket.OPEN
          ) {
            companion.socket.send(JSON.stringify({ type: "desktop_pause", sessionId }));
          }
        }
      });
      socket.on("error", () => socket.close());
      return;
    }

    if (!context) {
      socket.close(1008, "Invalid agent credentials");
      return;
    }
    const { deviceId, ownerId, channel } = context;
    const logDeviceId = deviceId.slice(0, 8);
    const connectionMap = channel === "companion" ? companionConnections : connections;
    const previous = connectionMap.get(deviceId);
    if (previous && previous.socket !== socket) previous.socket.close(4001, "Reconnected");
    connectionMap.set(deviceId, { ownerId, socket });
    logger.info({ deviceId: logDeviceId, channel }, "Agon agent WebSocket connected");
    let awaitingPong = false;
    const pingTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (awaitingPong) {
        socket.terminate();
        return;
      }
      awaitingPong = true;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }, pingIntervalMs);
    socket.on("pong", () => {
      awaitingPong = false;
    });

    if (channel === "agent") {
      void updateHeartbeat(ownerId, deviceId).catch((err: unknown) => {
        logger.error({ err, deviceId: logDeviceId }, "Initial Agon heartbeat update failed");
      });
    }
    void sendQueuedJobs(ownerId, deviceId, socket, channel).catch((err: unknown) => {
      logger.error({ err, deviceId: logDeviceId, channel }, "Initial Agon job dispatch failed");
    });

    let messageQueue = Promise.resolve();
    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        logger.warn({ deviceId: logDeviceId }, "Rejected binary Agon agent message");
        socket.close(1003, "Text JSON messages required");
        return;
      }

      let message: AgentMessage;
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Agent message must be a JSON object");
        }
        message = parsed as AgentMessage;
      } catch (err) {
        logger.warn({ err, deviceId: logDeviceId }, "Rejected invalid Agon agent JSON");
        socket.close(1007, "Invalid JSON message");
        return;
      }

      if (
        message.type !== "hello" &&
        message.type !== "heartbeat" &&
        message.type !== "command_result" &&
        message.type !== "desktop_frame"
      ) {
        logger.warn(
          { deviceId: logDeviceId, messageType: message.type ?? "missing" },
          "Rejected unsupported Agon agent message type",
        );
        socket.close(1008, "Unsupported agent message type");
        return;
      }

      messageQueue = messageQueue.then(async () => {
        if (message.type === "desktop_frame") {
          if (
            channel !== "companion" ||
            typeof message.sessionId !== "string" ||
            typeof message.jpeg !== "string" ||
            message.jpeg.length > 1_350_000
          ) return;
          const active = activeDesktopSessions.get(message.sessionId);
          const viewer = viewerConnections.get(message.sessionId);
          if (
            !active ||
            active.ownerId !== ownerId ||
            active.deviceId !== deviceId ||
            !viewer ||
            viewer.ownerId !== ownerId ||
            viewer.socket.readyState !== WebSocket.OPEN
          ) return;
          viewer.socket.send(JSON.stringify({
            type: "desktop_frame",
            sessionId: message.sessionId,
            jpeg: message.jpeg,
            width: message.width,
            height: message.height,
          }));
        } else if (message.type === "hello") {
          await updateHeartbeat(ownerId, deviceId, message.device);
        } else if (message.type === "heartbeat") {
          if (channel === "agent") await updateHeartbeat(ownerId, deviceId, message.device);
          await sendQueuedJobs(ownerId, deviceId, socket, channel);
        } else {
          if (connectionMap.get(deviceId)?.socket !== socket) return;
          await completeJob(ownerId, deviceId, message);
        }
      }).catch((err: unknown) => {
        // Database/runtime failures are not malformed client frames. Keep the
        // socket alive so the next heartbeat can retry transient operations.
        logger.error(
          { err, deviceId: logDeviceId, messageType: message.type },
          "Failed to process Agon agent message",
        );
      });
    });

    socket.on("close", (code, reason) => {
      clearInterval(pingTimer);
      logger.info(
        { deviceId: logDeviceId, closeCode: code, closeReason: reason.toString().slice(0, 120) },
        "Agon agent WebSocket closed",
      );
      if (connectionMap.get(deviceId)?.socket !== socket) return;
      connectionMap.delete(deviceId);
      if (channel === "agent") {
        void (async () => {
          const record = await getRecord(ownerId, "device", deviceId);
          if (record) {
            await saveRecord(ownerId, "device", deviceId, {
              ...record.data,
              online: false,
            });
          }
        })();
      } else {
        for (const [sessionId, active] of activeDesktopSessions) {
        if (active.deviceId !== deviceId || active.ownerId !== ownerId) continue;
        activeDesktopSessions.delete(sessionId);
        sendViewerStatus(sessionId, "disconnected");
        void getRecord(ownerId, "session", sessionId).then(async (session) => {
          if (!session || session.data.status !== "active") return;
          const updatedAt = new Date().toISOString();
          await saveRecord(ownerId, "session", sessionId, {
            ...session.data,
            status: "disconnected",
            updatedAt,
          });
          await addAudit(ownerId, "session.disconnected", { sessionId, deviceId }, "warning", "Agon Agent");
        }).catch((err: unknown) => {
          logger.warn({ err, deviceId: logDeviceId }, "Could not mark interrupted desktop session");
        });
        }
      }
    });

    socket.on("error", (err) => {
      logger.warn({ err, deviceId: logDeviceId }, "Agon agent WebSocket transport error");
      socket.close();
    });
  });
}
