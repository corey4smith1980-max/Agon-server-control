import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
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
import { buildWindowsMsi } from "../lib/agentMsiBuilder";
import { createAndroidSigningKey, signApkWithKey } from "../lib/androidSigningKey";
import { addAudit, createRecord, getRecord, getRecordById, listRecords, saveRecord } from "../lib/agonStore";
import {
  acceptOrganizationInvitation,
  createOrganization,
  createOrganizationInvitation,
  ensurePersonalOrganization,
  getOrganizationRole,
  listOrganizationInvitations,
  listOrganizationMembers,
  listUserOrganizations,
  organizationRoles,
  type OrganizationRole,
} from "../lib/organizationStore";
import {
  disconnectAgonDevice,
  endAgonDesktopSession,
  hasOtherActiveDesktopSession,
  isAgonCompanionConnected,
  queueAgonCommand,
} from "../lib/agonWebSocket";

const router = Router();
const allowedActions = new Set([
  "agent.ping",
  "inventory.refresh",
  "diagnostics.network",
  "agent.upgrade",
]);

const requireOperator: RequestHandler = (request, response, next) => {
  const userId = getAuth(request).userId;
  if (!userId) {
    response.status(401).json({ error: "Sign in to access your control plane." });
    return;
  }
  response.locals.userId = userId;
  next();
};

function ownerId(response: Parameters<RequestHandler>[1]): string {
  return response.locals.ownerId as string;
}

function userId(response: Parameters<RequestHandler>[1]): string {
  return response.locals.userId as string;
}

function currentRole(response: Parameters<RequestHandler>[1]): OrganizationRole {
  return response.locals.organizationRole as OrganizationRole;
}

const resolveOrganization: RequestHandler = async (request, response, next) => {
  const operatorId = userId(response);
  const requestedId = cleanText(
    request.get("X-Agon-Organization-Id"),
    128,
    operatorId,
  ) || operatorId;
  if (requestedId === operatorId) {
    await ensurePersonalOrganization(operatorId);
  }
  const role = await getOrganizationRole(requestedId, operatorId);
  if (!role || !organizationRoles.includes(role)) {
    response.status(403).json({ error: "You are not a member of this organization." });
    return;
  }
  response.locals.ownerId = requestedId;
  response.locals.organizationRole = role;
  next();
};

function requireRoles(...roles: OrganizationRole[]): RequestHandler {
  return async (request, response, next) => {
    if (!roles.includes(currentRole(response))) {
      await addAudit(ownerId(response), "authorization.denied", {
        method: request.method,
        path: request.path,
        role: currentRole(response),
      }, "warning", userId(response));
      response.status(403).json({ error: "Your organization role does not allow this action." });
      return;
    }
    next();
  };
}

function pathOrganizationMatches(
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): boolean {
  if (cleanText(request.params.organizationId, 128) !== ownerId(response)) {
    response.status(404).json({ error: "Organization not found." });
    return false;
  }
  return true;
}

function cleanText(value: unknown, limit: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim().replace(/\0/g, "").slice(0, limit);
}

function cleanByteCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function cleanIpAddresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((address): address is string => typeof address === "string" && isIP(address) !== 0)
    .slice(0, 12);
}

function withoutViewerCredentials(data: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...data };
  delete safe.viewerTokenHash;
  delete safe.viewerTokenExpiresAt;
  return safe;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const maxUnattendedSessionMinutes = new Set([15, 30, 60, 120]);
const unattendedRoles = new Set<OrganizationRole>(["owner", "admin", "technician"]);

type OrganizationPolicy = {
  unattendedDesktopEnabled: boolean;
  allowedRoles: OrganizationRole[];
  allowedGroups: string[];
  maxSessionMinutes: number;
  updatedAt: string;
  updatedBy: string;
};

async function getOrganizationPolicy(organizationId: string): Promise<OrganizationPolicy> {
  let result = await pool.query<{
    unattended_desktop_enabled: boolean;
    allowed_roles: unknown;
    allowed_groups: unknown;
    max_session_minutes: number;
    updated_at: Date;
    updated_by: string;
  }>(
    `SELECT unattended_desktop_enabled, allowed_roles, allowed_groups,
            max_session_minutes, updated_at, updated_by
     FROM agon_organization_policies WHERE organization_id = $1`,
    [organizationId],
  );
  if (!result.rows[0]) {
    await pool.query(
      `INSERT INTO agon_organization_policies
         (organization_id, unattended_desktop_enabled, allowed_roles,
          allowed_groups, max_session_minutes, updated_by)
       VALUES ($1, FALSE, '["owner","admin"]'::jsonb, '[]'::jsonb, 30, 'system')
       ON CONFLICT (organization_id) DO NOTHING`,
      [organizationId],
    );
    result = await pool.query(
      `SELECT unattended_desktop_enabled, allowed_roles, allowed_groups,
              max_session_minutes, updated_at, updated_by
       FROM agon_organization_policies WHERE organization_id = $1`,
      [organizationId],
    );
  }
  const stored = result.rows[0];
  if (
    !stored ||
    typeof stored.unattended_desktop_enabled !== "boolean" ||
    !Array.isArray(stored.allowed_roles) ||
    !Array.isArray(stored.allowed_groups) ||
    !maxUnattendedSessionMinutes.has(Number(stored.max_session_minutes))
  ) {
    throw new Error("Stored organization access policy is invalid.");
  }
  const allowedRoles = stored.allowed_roles.filter(
    (role): role is OrganizationRole =>
      typeof role === "string" && unattendedRoles.has(role as OrganizationRole),
  );
  const allowedGroups = stored.allowed_groups.filter(
    (group): group is string => typeof group === "string",
  );
  return {
    unattendedDesktopEnabled: stored.unattended_desktop_enabled,
    allowedRoles,
    allowedGroups,
    maxSessionMinutes: Number(stored.max_session_minutes),
    updatedAt: stored.updated_at.toISOString(),
    updatedBy: stored.updated_by,
  };
}

async function checkUnattendedAccess(
  organizationId: string,
  role: OrganizationRole,
  device: { data: Record<string, unknown> } | null,
): Promise<{ allowed: boolean; reason: string; policy: OrganizationPolicy }> {
  const policy = await getOrganizationPolicy(organizationId);
  if (!device) return { allowed: false, reason: "Choose a managed endpoint first.", policy };
  if (device.data.allowUnattended !== true) {
    return {
      allowed: false,
      reason: "This endpoint was not explicitly opted in when its installer was built.",
      policy,
    };
  }
  if (!policy.unattendedDesktopEnabled) {
    return { allowed: false, reason: "Organization unattended desktop policy is disabled.", policy };
  }
  if (!policy.allowedRoles.includes(role)) {
    return { allowed: false, reason: "Your organization role is not allowed by the unattended access policy.", policy };
  }
  const group = cleanText(device.data.group, 80, "Unassigned") || "Unassigned";
  if (!policy.allowedGroups.includes(group)) {
    return { allowed: false, reason: "This endpoint's device group is not allowed by the unattended access policy.", policy };
  }
  return { allowed: true, reason: "", policy };
}

const openSupportSessionStatuses = new Set([
  "waiting",
  "consent_required",
  "accepted",
  "active",
  "disconnected",
]);

async function closeOrganizationSessions(
  organizationId: string,
  reason: string,
  actor: string,
  options: {
    createdBy?: string;
    includeInteractive?: boolean;
    enforceCurrentPolicy?: boolean;
    endUnattended?: boolean;
  } = {},
): Promise<void> {
  const sessions = await listRecords(organizationId, "session", 1000);
  const policy = options.enforceCurrentPolicy ? await getOrganizationPolicy(organizationId) : null;
  for (const session of sessions) {
    const data = session.data;
    if (!openSupportSessionStatuses.has(String(data.status))) continue;
    if (options.createdBy && data.createdBy !== options.createdBy) continue;
    if (data.mode !== "unattended" && !options.includeInteractive) continue;
    if (policy && data.mode === "unattended" && !options.endUnattended) {
      const creator = typeof data.createdBy === "string" ? data.createdBy : "";
      const creatorRole = creator ? await getOrganizationRole(organizationId, creator) : null;
      const deviceId = typeof data.deviceId === "string" ? data.deviceId : "";
      const device = deviceId ? await getRecord(organizationId, "device", deviceId) : null;
      const group = cleanText(device?.data.group, 80, "Unassigned") || "Unassigned";
      if (
        policy.unattendedDesktopEnabled &&
        creatorRole &&
        policy.allowedRoles.includes(creatorRole) &&
        policy.allowedGroups.includes(group) &&
        device?.data.allowUnattended === true
      ) continue;
    }
    const endedAt = new Date().toISOString();
    const update = await pool.query(
      `UPDATE agon_records
       SET data = data || jsonb_build_object(
             'status', 'ended',
             'consentRequestId', NULL,
             'viewerTokenHash', NULL,
             'viewerTokenExpiresAt', NULL,
             'endedAt', $1,
             'endReason', $2,
             'updatedAt', $1
           ),
           updated_at = NOW()
       WHERE id = $3 AND owner_id = $4 AND kind = 'session'
         AND data->>'status' IN ('waiting', 'consent_required', 'accepted', 'active', 'disconnected')`,
      [endedAt, reason, session.id, organizationId],
    );
    if (!update.rowCount) continue;
    const deviceId = typeof data.deviceId === "string" ? data.deviceId : "";
    if (deviceId) endAgonDesktopSession(session.id, deviceId);
    await addAudit(organizationId, "session.access.revoked", {
      sessionId: session.id,
      deviceId: deviceId || null,
      reason,
    }, "warning", actor);
  }
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
  const organization = await pool.query(
    `SELECT id FROM agon_organizations WHERE id = $1 LIMIT 1`,
    [owner],
  );
  if (!organization.rowCount) {
    response.status(404).json({ error: "The installer organization no longer exists." });
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
    osVersion: cleanText(deviceInfo.osVersion, 120),
    arch: cleanText(deviceInfo.arch, 40),
    agent: cleanText(deviceInfo.agent, 40, "1.0.0"),
    cpus: Number.isFinite(deviceInfo.cpus) ? deviceInfo.cpus : 0,
    cpuModel: cleanText(deviceInfo.cpuModel, 180),
    interfaces: Number.isFinite(deviceInfo.interfaces) ? deviceInfo.interfaces : 0,
    ipAddresses: cleanIpAddresses(deviceInfo.ipAddresses),
    memoryTotalBytes: cleanByteCount(deviceInfo.memoryTotalBytes),
    memoryUsedBytes: cleanByteCount(deviceInfo.memoryUsedBytes),
    diskTotalBytes: cleanByteCount(deviceInfo.diskTotalBytes),
    diskUsedBytes: cleanByteCount(deviceInfo.diskUsedBytes),
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

router.get("/organizations", async (request, response) => {
  const operatorId = userId(response);
  await ensurePersonalOrganization(operatorId);
  const organizations = await listUserOrganizations(operatorId);
  const requestedId = cleanText(request.get("X-Agon-Organization-Id"), 128);
  const active = organizations.find((organization) => organization.id === requestedId)
    ?? organizations.find((organization) => organization.isPersonal)
    ?? organizations[0];
  if (!active) {
    response.status(500).json({ error: "No organization is available for this account." });
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.json({
    organizations,
    activeOrganizationId: active.id,
    currentRole: active.role,
  });
});

router.post("/organizations", async (request, response) => {
  const name = cleanText(request.body?.name, 100);
  if (!name) {
    response.status(400).json({ error: "Enter an organization name." });
    return;
  }
  const organization = await createOrganization(userId(response), name);
  await addAudit(organization.id, "organization.created", {
    organizationId: organization.id,
    name,
  }, "success", userId(response));
  response.status(201).json({ organization });
});

router.post("/organizations/invitations/accept", async (request, response) => {
  const token = cleanText(request.body?.token, 64);
  if (token.length < 40) {
    response.status(400).json({ error: "The invitation token is invalid or expired." });
    return;
  }
  const accepted = await acceptOrganizationInvitation(userId(response), token);
  if (!accepted) {
    response.status(404).json({ error: "The invitation is invalid, expired, revoked, or already used." });
    return;
  }
  await addAudit(accepted.organizationId, "organization.invitation.accepted", {
    organizationId: accepted.organizationId,
    role: accepted.role,
  }, "success", userId(response));
  response.json(accepted);
});

router.use(resolveOrganization);

router.post(
  "/agent-installer/msi",
  requireRoles("owner", "admin", "technician"),
  async (request, response) => {
    const architecture = cleanText(request.body?.architecture, 16);
    const group = cleanText(request.body?.group, 80, "Unassigned") || "Unassigned";
    const allowUnattended = request.body?.allowUnattended === true;
    if (architecture !== "amd64") {
      response.status(400).json({ error: "Windows MSI generation currently supports x64. Use the Windows ARM64 package for ARM devices." });
      return;
    }
    if (allowUnattended && currentRole(response) !== "owner" && currentRole(response) !== "admin") {
      response.status(403).json({ error: "Only organization owners or administrators can opt an installer into unattended access." });
      return;
    }
    const packageFile = await buildWindowsMsi({
      architecture,
      organizationId: ownerId(response),
      group,
      allowUnattended,
      installerName: cleanText(request.body?.name, 80, "Agon Agent") || "Agon Agent",
    });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/x-msi");
    response.setHeader("Content-Length", packageFile.buffer.byteLength);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${packageFile.filename}"`,
    );
    await addAudit(ownerId(response), "installer.generated", {
      filename: packageFile.filename,
      architecture,
      group,
      access: allowUnattended ? "unattended-opt-in" : "interactive",
      agentSha256: packageFile.agentSha256,
    }, "success", userId(response));
    response.status(200).send(packageFile.buffer);
  },
);

function publicSigningKey(record: { id: string; data: Record<string, unknown> }) {
  return {
    id: record.id,
    deviceId: record.data.deviceId || null,
    alias: record.data.alias,
    storePassword: record.data.storePassword,
    keyPassword: record.data.keyPassword,
    certificateSha256: record.data.certificateSha256,
    scheme: record.data.scheme,
    platform: record.data.platform,
    createdAt: record.data.createdAt,
  };
}

router.get("/signing-keys", requireRoles("owner", "admin"), async (_request, response) => {
  const keys = await listRecords(ownerId(response), "signing_key", 500);
  response.setHeader("Cache-Control", "no-store");
  response.json({ keys: keys.map(publicSigningKey) });
});

router.post(
  "/agent-installer/android",
  requireRoles("owner", "admin", "technician"),
  async (request, response) => {
    const deviceId = cleanText(request.body?.deviceId, 80);
    const group = cleanText(request.body?.group, 80, "Unassigned") || "Unassigned";
    if (deviceId) {
      const device = await getRecord(ownerId(response), "device", deviceId);
      if (!device) {
        response.status(404).json({ error: "Device not found in this organization." });
        return;
      }
    }
    const key = await createAndroidSigningKey(deviceId || null);
    const { storeFile: _storeFile, ...stored } = key;
    await createRecord(ownerId(response), "signing_key", stored, key.id);
    if (deviceId) {
      const device = await getRecord(ownerId(response), "device", deviceId);
      if (device) {
        await saveRecord(ownerId(response), "device", deviceId, {
          ...device.data,
          signingKeyId: key.id,
          signingCertSha256: key.certificateSha256,
          group,
        });
      }
    }
    const signed = await signApkWithKey(key);
    await addAudit(ownerId(response), "installer.android.signed", {
      keyId: key.id,
      deviceId: deviceId || null,
      alias: key.alias,
      certificateSha256: key.certificateSha256,
      signed: Boolean(signed),
      group,
    }, "success", userId(response));
    if (!signed) {
      response.status(200).json({
        signed: false,
        signingKey: publicSigningKey({ id: key.id, data: stored }),
        message: "A unique signing key was recorded. The APK will be signed with it on the next Android build that has the SDK and base package available.",
      });
      return;
    }
    const filename = `agon-agent-android-${key.alias}.apk`;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/vnd.android.package-archive");
    response.setHeader("Content-Length", signed.byteLength);
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    response.setHeader("X-Agon-Key-Id", key.id);
    response.setHeader("X-Agon-Key-Alias", key.alias);
    response.setHeader("X-Agon-Cert-Sha256", key.certificateSha256);
    response.setHeader("X-Agon-Store-Password", key.storePassword);
    response.setHeader("X-Agon-Key-Password", key.keyPassword);
    response.status(200).send(signed);
  },
);

function upgradePlatform(device: Record<string, unknown>): "windows" | "macos" | "linux" | "android" {
  const os = String(device.os || device.platform || "").toLowerCase();
  if (os.includes("android")) return "android";
  if (os.includes("mac") || os.includes("darwin")) return "macos";
  if (os.includes("linux")) return "linux";
  return "windows";
}

router.post("/devices/:deviceId/upgrade", requireRoles("owner", "admin"), async (request, response) => {
  const deviceId = cleanText(request.params.deviceId, 80);
  const device = await getRecord(ownerId(response), "device", deviceId);
  if (!device) {
    response.status(404).json({ error: "Device not found in this organization." });
    return;
  }
  const platform = upgradePlatform(device.data);
  const packageUrl = cleanText(request.body?.packageUrl, 500);
  if (packageUrl && !/^https?:\/\//i.test(packageUrl)) {
    response.status(400).json({ error: "Installer URL must be http or https." });
    return;
  }
  const version = cleanText(request.body?.version, 40, "1.1.0-enterprise") || "1.1.0-enterprise";
  const job = await queueAgonCommand(ownerId(response), deviceId, "agent.upgrade", {
    platform,
    version,
    packageUrl: packageUrl || "",
    signingKeyId: device.data.signingKeyId || "",
    silent: true,
  });
  if (!job) {
    response.status(404).json({ error: "Device not found in this account." });
    return;
  }
  await addAudit(ownerId(response), "installer.upgrade.sent", {
    deviceId,
    platform,
    version,
    packageUrl: packageUrl || null,
  }, "warning", userId(response));
  response.status(202).json({ job, platform });
});

router.post("/upgrades", requireRoles("owner", "admin"), async (request, response) => {
  const requested = Array.isArray(request.body?.deviceIds) ? request.body.deviceIds : null;
  const devices = await listRecords(ownerId(response), "device", 1000);
  const targets = devices.filter((device) => !requested || requested.map(String).includes(device.id));
  const jobs = [];
  for (const device of targets) {
    const platform = upgradePlatform(device.data);
    const job = await queueAgonCommand(ownerId(response), device.id, "agent.upgrade", {
      platform,
      version: cleanText(request.body?.version, 40, "1.1.0-enterprise") || "1.1.0-enterprise",
      packageUrl: cleanText(request.body?.packageUrl, 500),
      signingKeyId: device.data.signingKeyId || "",
      silent: true,
    });
    if (job) jobs.push({ deviceId: device.id, platform, jobId: job.id });
  }
  await addAudit(ownerId(response), "installer.upgrade.sent", {
    devices: jobs.length,
  }, "warning", userId(response));
  response.status(202).json({ jobs });
});

router.patch("/organizations/:organizationId", requireRoles("owner", "admin"), async (request, response) => {
  if (!pathOrganizationMatches(request, response)) return;
  const name = cleanText(request.body?.name, 100);
  if (!name) {
    response.status(400).json({ error: "Enter an organization name." });
    return;
  }
  const result = await pool.query<{
    id: string;
    name: string;
    role: OrganizationRole;
    isPersonal: boolean;
  }>(
    `UPDATE agon_organizations SET name = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, name, is_personal AS "isPersonal"`,
    [name, ownerId(response)],
  );
  const organization = result.rows[0];
  if (!organization) {
    response.status(404).json({ error: "Organization not found." });
    return;
  }
  organization.role = currentRole(response);
  await addAudit(ownerId(response), "organization.renamed", {
    organizationId: ownerId(response),
    name,
  }, "info", userId(response));
  response.json({ organization });
});

router.get("/organizations/:organizationId/members", async (request, response) => {
  if (!pathOrganizationMatches(request, response)) return;
  response.setHeader("Cache-Control", "no-store");
  response.json({ members: await listOrganizationMembers(ownerId(response)) });
});

router.patch(
  "/organizations/:organizationId/members/:memberId",
  requireRoles("owner", "admin"),
  async (request, response) => {
    if (!pathOrganizationMatches(request, response)) return;
    const targetUserId = cleanText(request.params.memberId, 128);
    const requestedRole = cleanText(request.body?.role, 24);
    if (!organizationRoles.includes(requestedRole as OrganizationRole) || requestedRole === "owner") {
      response.status(400).json({ error: "Select a valid organization role." });
      return;
    }
    const existing = await pool.query<{ role: OrganizationRole }>(
      `SELECT role FROM agon_organization_memberships
       WHERE organization_id = $1 AND user_id = $2`,
      [ownerId(response), targetUserId],
    );
    const target = existing.rows[0];
    if (!target || target.role === "owner") {
      response.status(404).json({ error: "This member cannot be changed." });
      return;
    }
    if (currentRole(response) === "admin" &&
        (target.role === "admin" || requestedRole === "admin")) {
      response.status(403).json({ error: "Only an owner can change administrator roles." });
      return;
    }
    const result = await pool.query<{ userId: string; role: OrganizationRole; joinedAt: Date }>(
      `UPDATE agon_organization_memberships SET role = $1
       WHERE organization_id = $2 AND user_id = $3
       RETURNING user_id AS "userId", role, joined_at AS "joinedAt"`,
      [requestedRole, ownerId(response), targetUserId],
    );
    const member = result.rows[0];
    if (!member) {
      response.status(404).json({ error: "Organization member not found." });
      return;
    }
    await addAudit(ownerId(response), "organization.member.role_changed", {
      userId: targetUserId,
      previousRole: target.role,
      role: requestedRole,
    }, "info", userId(response));
    await closeOrganizationSessions(
      ownerId(response),
      "member_role_changed",
      userId(response),
      {
        createdBy: targetUserId,
        includeInteractive: requestedRole === "auditor",
        enforceCurrentPolicy: true,
      },
    );
    response.json({ ...member, joinedAt: member.joinedAt.toISOString() });
  },
);

router.delete(
  "/organizations/:organizationId/members/:memberId",
  requireRoles("owner", "admin"),
  async (request, response) => {
    if (!pathOrganizationMatches(request, response)) return;
    const targetUserId = cleanText(request.params.memberId, 128);
    const existing = await pool.query<{ role: OrganizationRole }>(
      `SELECT role FROM agon_organization_memberships
       WHERE organization_id = $1 AND user_id = $2`,
      [ownerId(response), targetUserId],
    );
    const target = existing.rows[0];
    if (!target || target.role === "owner") {
      response.status(404).json({ error: "This member cannot be removed." });
      return;
    }
    if (currentRole(response) === "admin" && target.role === "admin") {
      response.status(403).json({ error: "Only an owner can remove an administrator." });
      return;
    }
    await pool.query(
      `DELETE FROM agon_organization_memberships
       WHERE organization_id = $1 AND user_id = $2`,
      [ownerId(response), targetUserId],
    );
    await addAudit(ownerId(response), "organization.member.removed", {
      userId: targetUserId,
      previousRole: target.role,
    }, "warning", userId(response));
    await closeOrganizationSessions(
      ownerId(response),
      "member_removed",
      userId(response),
      { createdBy: targetUserId, includeInteractive: true },
    );
    response.status(204).end();
  },
);

router.get("/organizations/:organizationId/invitations", async (request, response) => {
  if (!pathOrganizationMatches(request, response)) return;
  response.setHeader("Cache-Control", "no-store");
  response.json({ invitations: await listOrganizationInvitations(ownerId(response)) });
});

router.post(
  "/organizations/:organizationId/invitations",
  requireRoles("owner", "admin"),
  async (request, response) => {
    if (!pathOrganizationMatches(request, response)) return;
    const role = cleanText(request.body?.role, 24);
    if (!["admin", "technician", "auditor"].includes(role)) {
      response.status(400).json({ error: "Select a valid invitation role." });
      return;
    }
    if (currentRole(response) === "admin" && role === "admin") {
      response.status(403).json({ error: "Only an owner can invite administrators." });
      return;
    }
    const created = await createOrganizationInvitation(
      ownerId(response),
      userId(response),
      role as Exclude<OrganizationRole, "owner">,
    );
    await addAudit(ownerId(response), "organization.invitation.created", {
      invitationId: created.invitation.id,
      role,
    }, "info", userId(response));
    response.status(201).json(created);
  },
);

router.delete(
  "/organizations/:organizationId/invitations/:invitationId",
  requireRoles("owner", "admin"),
  async (request, response) => {
    if (!pathOrganizationMatches(request, response)) return;
    const invitationId = cleanText(request.params.invitationId, 80);
    const result = await pool.query(
      `UPDATE agon_organization_invitations SET revoked_at = NOW()
       WHERE id = $1 AND organization_id = $2
         AND accepted_at IS NULL AND revoked_at IS NULL`,
      [invitationId, ownerId(response)],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Active invitation not found." });
      return;
    }
    await addAudit(ownerId(response), "organization.invitation.revoked", {
      invitationId,
    }, "warning", userId(response));
    response.status(204).end();
  },
);

router.get("/organizations/:organizationId/policy", async (request, response) => {
  if (!pathOrganizationMatches(request, response)) return;
  response.setHeader("Cache-Control", "no-store");
  response.json(await getOrganizationPolicy(ownerId(response)));
});

router.put(
  "/organizations/:organizationId/policy",
  requireRoles("owner", "admin"),
  async (request, response) => {
    if (!pathOrganizationMatches(request, response)) return;
    const input = request.body ?? {};
    const allowedRoles = input.allowedRoles;
    const allowedGroups = input.allowedGroups;
    const minutes = Number(input.maxSessionMinutes);
    if (
      typeof input.unattendedDesktopEnabled !== "boolean" ||
      !Array.isArray(allowedRoles) ||
      allowedRoles.length > 3 ||
      allowedRoles.some((role: unknown) => typeof role !== "string" || !unattendedRoles.has(role as OrganizationRole)) ||
      new Set(allowedRoles).size !== allowedRoles.length ||
      !Array.isArray(allowedGroups) ||
      allowedGroups.length > 100 ||
      allowedGroups.some((group: unknown) => typeof group !== "string" || !group.trim() || group.length > 80) ||
      new Set(allowedGroups).size !== allowedGroups.length ||
      !maxUnattendedSessionMinutes.has(minutes)
    ) {
      response.status(400).json({ error: "The organization access policy is invalid." });
      return;
    }
    const devices = await listRecords(ownerId(response), "device", 1000);
    const knownGroups = new Set(devices.map(({ data }) => cleanText(data.group, 80, "Unassigned") || "Unassigned"));
    const groups = allowedGroups.map((group: string) => group.trim());
    if (groups.some((group: string) => !knownGroups.has(group))) {
      response.status(400).json({ error: "Policy groups must match a device group in this organization." });
      return;
    }
    if (input.unattendedDesktopEnabled && (!groups.length || !allowedRoles.length)) {
      response.status(400).json({ error: "Choose at least one allowed role and device group before enabling unattended access." });
      return;
    }
    const updatedAt = new Date().toISOString();
    await pool.query(
      `UPDATE agon_organization_policies
       SET unattended_desktop_enabled = $1,
           allowed_roles = $2::jsonb,
           allowed_groups = $3::jsonb,
           max_session_minutes = $4,
           updated_by = $5,
           updated_at = $6
       WHERE organization_id = $7`,
      [
        input.unattendedDesktopEnabled,
        JSON.stringify(allowedRoles),
        JSON.stringify(groups),
        minutes,
        userId(response),
        updatedAt,
        ownerId(response),
      ],
    );
    await addAudit(ownerId(response), "organization.unattended_policy.updated", {
      unattendedDesktopEnabled: input.unattendedDesktopEnabled,
      allowedRoles,
      allowedGroups: groups,
      maxSessionMinutes: minutes,
    }, "warning", userId(response));
    await closeOrganizationSessions(
      ownerId(response),
      "organization_policy_changed",
      userId(response),
      { enforceCurrentPolicy: true, endUnattended: true },
    );
    response.json(await getOrganizationPolicy(ownerId(response)));
  },
);

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
        allowUnattended: data.allowUnattended === true,
        requestedAt: data.requestedAt ?? createdAt.toISOString(),
      })),
  }));
});

router.post("/pending-devices/:deviceId/approve", requireRoles("owner", "admin"), async (request, response) => {
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
  await addAudit(owner, "device.pairing.approved", { deviceId, name: approvedName }, "success", userId(response));
  response.json(ApproveAgonPendingDeviceResponse.parse({ deviceId, status: "approved" }));
});

router.delete("/pending-devices/:deviceId", requireRoles("owner", "admin"), async (request, response) => {
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
  }, "warning", userId(response));
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

router.get("/devices/:deviceId/access-policy", async (request, response) => {
  const deviceId = cleanText(request.params.deviceId, 80);
  const device = await getRecord(ownerId(response), "device", deviceId);
  if (!device) {
    response.status(404).json({ error: "Device not found in this organization." });
    return;
  }
  const access = await checkUnattendedAccess(ownerId(response), currentRole(response), device);
  const interactiveAllowed = currentRole(response) !== "auditor";
  await addAudit(ownerId(response), "access.policy.checked", {
    deviceId,
    interactiveAllowed,
    unattendedAllowed: access.allowed,
    role: currentRole(response),
    group: cleanText(device.data.group, 80, "Unassigned") || "Unassigned",
  }, "info", userId(response));
  response.setHeader("Cache-Control", "no-store");
  response.json({
    deviceId,
    interactiveAllowed,
    unattendedAllowed: access.allowed,
    unattendedReason: access.reason,
    endpointOptIn: device.data.allowUnattended === true,
  });
});

router.delete("/devices/:deviceId", requireRoles("owner", "admin"), async (request, response) => {
  const owner = ownerId(response);
  const result = await pool.query(
    `DELETE FROM agon_records
     WHERE id = $1 AND owner_id = $2 AND kind = 'device'
     RETURNING id`,
    [cleanText(request.params.deviceId, 80), owner],
  );
  if (!result.rowCount) {
    response.status(404).json({ error: "Device not found in this account." });
    return;
  }
  disconnectAgonDevice(cleanText(request.params.deviceId, 80));
  await addAudit(owner, "device.access.revoked", {
    deviceId: cleanText(request.params.deviceId, 80),
  }, "warning", userId(response));
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
  response.json({ sessions: sessions.map(({ id, data }) => ({ ...withoutViewerCredentials(data), id })) });
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

router.post("/devices/:deviceId/commands", requireRoles("owner", "admin", "technician"), async (request, response) => {
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
    cleanText(request.params.deviceId, 80),
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
  const role = currentRole(response);
  if (role === "auditor") {
    if (mode === "unattended") {
      await addAudit(owner, "session.unattended.denied", {
        deviceId: deviceId || null,
        reason: "auditor_role",
      }, "warning", userId(response));
    }
    response.status(403).json({ error: "Auditor access is read-only and cannot start support sessions." });
    return;
  }
  if (!customer || !issue) {
    response.status(400).json({ error: "Customer and issue are required." });
    return;
  }
  const device = deviceId ? await getRecord(owner, "device", deviceId) : null;
  if (deviceId && !device) {
    response.status(404).json({ error: "Device not found in this account." });
    return;
  }
  if (mode === "unattended") {
    const access = await checkUnattendedAccess(owner, role, device);
    if (!access.allowed) {
      await addAudit(owner, "session.unattended.denied", {
        deviceId: device?.id ?? null,
        reason: access.reason,
      }, "warning", userId(response));
      response.status(403).json({ error: access.reason });
      return;
    }
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
    actor: userId(response),
    createdBy: userId(response),
    relayId: "agon-hosted",
    createdAt: new Date().toISOString(),
  };
  await createRecord(owner, "session", session, id);
  await addAudit(owner, "session.requested", {
    sessionId: id,
    deviceId: device?.id ?? null,
    deviceName: session.deviceName,
    code,
    mode,
  }, mode === "unattended" ? "warning" : "info", userId(response));
  response.status(201).json({ session: { ...session, id } });
});

router.post("/sessions/:sessionId/connect", async (request, response): Promise<void> => {
  const owner = ownerId(response);
  const role = currentRole(response);
  const sessionId = cleanText(request.params.sessionId, 80);
  const session = await getRecord(owner, "session", sessionId);
  if (!session) {
    response.status(404).json({ error: "Support session not found." });
    return;
  }
  if (session.data.status === "ended" || session.data.status === "declined") {
    response.status(409).json({ error: "This support session is already closed." });
    return;
  }
  if (role === "auditor") {
    if (session.data.mode === "unattended") {
      await addAudit(owner, "session.unattended.denied", {
        sessionId: session.id,
        reason: "auditor_role",
      }, "warning", userId(response));
    }
    response.status(403).json({ error: "Auditor access is read-only and cannot connect to support sessions." });
    return;
  }
  if (
    role === "technician" &&
    typeof session.data.createdBy === "string" &&
    session.data.createdBy !== userId(response)
  ) {
    response.status(403).json({ error: "Technicians can connect only to sessions they requested." });
    return;
  }
  const deviceId = typeof session.data.deviceId === "string" ? session.data.deviceId : "";
  if (!deviceId) {
    response.status(409).json({ error: "Choose a managed endpoint before connecting." });
    return;
  }
  const device = await getRecord(owner, "device", deviceId);
  if (!device) {
    response.status(404).json({ error: "The endpoint is no longer managed by this organization." });
    return;
  }
  if (!isAgonCompanionConnected(deviceId)) {
    response.status(409).json({
      error: "The visible Windows desktop companion is not connected. Install the current agent package and keep its companion window open.",
    });
    return;
  }
  if (hasOtherActiveDesktopSession(deviceId, session.id)) {
    response.status(409).json({
      error: "Another live desktop session is already controlling this endpoint. End it before starting a second session.",
    });
    return;
  }
  let unattendedPolicy: OrganizationPolicy | null = null;
  if (session.data.mode === "unattended") {
    const access = await checkUnattendedAccess(owner, role, device);
    if (!access.allowed) {
      await addAudit(owner, "session.unattended.denied", {
        sessionId: session.id,
        deviceId,
        reason: access.reason,
      }, "warning", userId(response));
      response.status(403).json({ error: access.reason });
      return;
    }
    unattendedPolicy = access.policy;
  }
  endAgonDesktopSession(session.id, deviceId);

  const token = randomBytes(32).toString("base64url");
  const consentRequestId = randomUUID();
  const maxSessionMinutes = unattendedPolicy?.maxSessionMinutes ?? 30;
  const expiresAt = new Date(Date.now() + maxSessionMinutes * 60 * 1000).toISOString();
  const updatedSession = {
    ...session.data,
    status: "waiting",
    consentRequestId,
    viewerTokenHash: hashToken(token),
    viewerTokenExpiresAt: expiresAt,
    expiresAt,
    maxSessionMinutes,
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await pool.query(
    `UPDATE agon_records SET data = $1::jsonb, updated_at = NOW()
     WHERE id = $2 AND owner_id = $3 AND kind = 'session'`,
    [JSON.stringify(updatedSession), session.id, owner],
  );

  const job = await queueAgonCommand(owner, deviceId, "session.request", {
    sessionId: session.id,
    consentRequestId,
    code: String(session.data.code ?? ""),
    customer: String(session.data.customer ?? ""),
    issue: String(session.data.issue ?? ""),
    technician: userId(response),
    mode: session.data.mode === "unattended" ? "unattended" : "interactive",
    expiresAt,
  });
  if (!job) {
    response.status(502).json({ error: "Could not send the consent request to the desktop companion." });
    return;
  }
  await addAudit(owner, "session.connect_requested", {
    sessionId: session.id,
    deviceId,
    code: session.data.code,
    mode: session.data.mode === "unattended" ? "unattended" : "interactive",
    expiresAt,
  }, session.data.mode === "unattended" ? "warning" : "info", userId(response));
  if (session.data.mode === "unattended") {
    await addAudit(owner, "session.unattended.authorized", {
      sessionId: session.id,
      deviceId,
      role,
      group: cleanText(device?.data.group, 80, "Unassigned") || "Unassigned",
      maxSessionMinutes,
    }, "warning", userId(response));
  }
  response.setHeader("Cache-Control", "no-store");
  response.json({
    sessionId: session.id,
    viewerToken: token,
    viewerTokenExpiresAt: expiresAt,
  });
});

router.post("/sessions/:sessionId/end", async (request, response): Promise<void> => {
  const owner = ownerId(response);
  const sessionId = cleanText(request.params.sessionId, 80);
  const session = await getRecord(owner, "session", sessionId);
  if (!session) {
    response.status(404).json({ error: "Support session not found." });
    return;
  }
  if (
    !["owner", "admin"].includes(currentRole(response)) &&
    session.data.createdBy !== userId(response)
  ) {
    response.status(403).json({ error: "Only the session requester or an organization administrator can end this session." });
    return;
  }
  const deviceId = typeof session.data.deviceId === "string" ? session.data.deviceId : "";
  const endedAt = new Date().toISOString();
  await pool.query(
    `UPDATE agon_records SET data = $1::jsonb, updated_at = NOW()
     WHERE id = $2 AND owner_id = $3 AND kind = 'session'`,
    [JSON.stringify({
      ...session.data,
      status: "ended",
      consentRequestId: null,
      viewerTokenHash: null,
      viewerTokenExpiresAt: null,
      endedAt,
      updatedAt: endedAt,
    }), session.id, owner],
  );
  if (deviceId) endAgonDesktopSession(session.id, deviceId);
  await addAudit(owner, "session.ended", {
    sessionId: session.id,
    deviceId: deviceId || null,
    code: session.data.code,
  }, "info", userId(response));
  response.json({ session: { ...withoutViewerCredentials(session.data), status: "ended", endedAt } });
});

async function expireOverdueUnattendedSessions(): Promise<void> {
  const overdue = await pool.query<{ id: string; owner_id: string }>(
    `SELECT id, owner_id
     FROM agon_records
     WHERE kind = 'session'
       AND data->>'mode' = 'unattended'
       AND data->>'status' IN ('waiting', 'consent_required', 'accepted', 'active', 'disconnected')
       AND NULLIF(data->>'expiresAt', '') IS NOT NULL
       AND (data->>'expiresAt')::timestamptz <= NOW()
     ORDER BY updated_at ASC
     LIMIT 100`,
  );
  for (const candidate of overdue.rows) {
    const now = new Date().toISOString();
    const expired = await pool.query<{ data: Record<string, unknown> }>(
      `UPDATE agon_records
       SET data = data || jsonb_build_object(
             'status', 'expired',
             'consentRequestId', NULL,
             'viewerTokenHash', NULL,
             'viewerTokenExpiresAt', NULL,
             'endedAt', $1,
             'updatedAt', $1
           ),
           updated_at = NOW()
       WHERE id = $2 AND owner_id = $3 AND kind = 'session'
         AND data->>'mode' = 'unattended'
         AND data->>'status' IN ('waiting', 'consent_required', 'accepted', 'active', 'disconnected')
         AND NULLIF(data->>'expiresAt', '') IS NOT NULL
         AND (data->>'expiresAt')::timestamptz <= NOW()
       RETURNING data`,
      [now, candidate.id, candidate.owner_id],
    );
    const data = expired.rows[0]?.data;
    if (!data) continue;
    const deviceId = typeof data.deviceId === "string" ? data.deviceId : "";
    if (deviceId) endAgonDesktopSession(candidate.id, deviceId);
    await addAudit(candidate.owner_id, "session.unattended.expired", {
      sessionId: candidate.id,
      deviceId: deviceId || null,
      maxSessionMinutes: data.maxSessionMinutes ?? null,
    }, "warning", "organization-policy");
  }
}

const unattendedExpirySweep = setInterval(() => {
  void expireOverdueUnattendedSessions().catch((error) => {
    console.error("Agon unattended-session expiry sweep failed:", error);
  });
}, 15_000);
unattendedExpirySweep.unref?.();

export default router;
