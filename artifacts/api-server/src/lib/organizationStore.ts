import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

export const organizationRoles = [
  "owner",
  "admin",
  "technician",
  "auditor",
] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

export const defaultOrganizationPolicy = {
  unattendedDesktopEnabled: false,
  allowedRoles: ["owner", "admin"] as OrganizationRole[],
  allowedGroups: [] as string[],
  maxSessionMinutes: 30,
};

export type OrganizationSummary = {
  id: string;
  name: string;
  role: OrganizationRole;
  isPersonal: boolean;
};

export type OrganizationMember = {
  userId: string;
  role: OrganizationRole;
  joinedAt: string;
};

export type OrganizationInvitation = {
  id: string;
  role: OrganizationRole;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
};

function hashInvitation(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function ensurePersonalOrganization(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO agon_organizations (id, name, is_personal, created_by)
       VALUES ($1, 'My workspace', TRUE, $1)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [userId],
    );
    if (inserted.rowCount === 1) {
      await client.query(
        `INSERT INTO agon_organization_memberships (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'owner')
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [randomUUID(), userId, userId],
      );
      await client.query(
        `INSERT INTO agon_organization_policies
           (organization_id, unattended_desktop_enabled, allowed_roles,
            allowed_groups, max_session_minutes, updated_by)
         VALUES ($1, FALSE, '["owner","admin"]'::jsonb, '[]'::jsonb, 30, $2)
         ON CONFLICT (organization_id) DO NOTHING`,
        [userId, userId],
      );
    } else {
      const existing = await client.query<{ is_personal: boolean }>(
        `SELECT is_personal FROM agon_organizations WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (existing.rows[0]?.is_personal) {
        await client.query(
          `INSERT INTO agon_organization_memberships (id, organization_id, user_id, role)
           VALUES ($1, $2, $3, 'owner')
           ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [randomUUID(), userId, userId],
        );
        await client.query(
          `INSERT INTO agon_organization_policies
             (organization_id, unattended_desktop_enabled, allowed_roles,
              allowed_groups, max_session_minutes, updated_by)
           VALUES ($1, FALSE, '["owner","admin"]'::jsonb, '[]'::jsonb, 30, $2)
           ON CONFLICT (organization_id) DO NOTHING`,
          [userId, userId],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getOrganizationRole(
  organizationId: string,
  userId: string,
): Promise<OrganizationRole | null> {
  const result = await pool.query<{ role: OrganizationRole }>(
    `SELECT role
     FROM agon_organization_memberships
     WHERE organization_id = $1 AND user_id = $2
     LIMIT 1`,
    [organizationId, userId],
  );
  return result.rows[0]?.role ?? null;
}

export async function listUserOrganizations(
  userId: string,
): Promise<OrganizationSummary[]> {
  const result = await pool.query<OrganizationSummary>(
    `SELECT o.id, o.name, m.role, o.is_personal AS "isPersonal"
     FROM agon_organization_memberships m
     JOIN agon_organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1
     ORDER BY o.is_personal DESC, o.name ASC`,
    [userId],
  );
  return result.rows;
}

export async function createOrganization(
  userId: string,
  name: string,
): Promise<OrganizationSummary> {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; name: string; is_personal: boolean }>(
      `INSERT INTO agon_organizations (id, name, is_personal, created_by)
       VALUES ($1, $2, FALSE, $3)
       RETURNING id, name, is_personal`,
      [id, name, userId],
    );
    await client.query(
      `INSERT INTO agon_organization_memberships (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, 'owner')`,
      [randomUUID(), id, userId],
    );
    await client.query(
      `INSERT INTO agon_organization_policies
         (organization_id, unattended_desktop_enabled, allowed_roles,
          allowed_groups, max_session_minutes, updated_by)
       VALUES ($1, FALSE, '["owner","admin"]'::jsonb, '[]'::jsonb, 30, $2)`,
      [id, userId],
    );
    await client.query("COMMIT");
    return {
      id: result.rows[0].id,
      name: result.rows[0].name,
      isPersonal: result.rows[0].is_personal,
      role: "owner",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listOrganizationMembers(
  organizationId: string,
): Promise<OrganizationMember[]> {
  const result = await pool.query<{
    userId: string;
    role: OrganizationRole;
    joinedAt: Date;
  }>(
    `SELECT user_id AS "userId", role, joined_at AS "joinedAt"
     FROM agon_organization_memberships
     WHERE organization_id = $1
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
                        WHEN 'technician' THEN 2 ELSE 3 END, joined_at ASC`,
    [organizationId],
  );
  return result.rows.map((row) => ({
    ...row,
    joinedAt: row.joinedAt.toISOString(),
  }));
}

export async function listOrganizationInvitations(
  organizationId: string,
): Promise<OrganizationInvitation[]> {
  const result = await pool.query<{
    id: string;
    role: OrganizationRole;
    createdAt: Date;
    expiresAt: Date;
    createdBy: string;
  }>(
    `SELECT id, role, created_at AS "createdAt", expires_at AS "expiresAt",
            created_by AS "createdBy"
     FROM agon_organization_invitations
     WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [organizationId],
  );
  return result.rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function createOrganizationInvitation(
  organizationId: string,
  createdBy: string,
  role: Exclude<OrganizationRole, "owner">,
): Promise<{ invitation: OrganizationInvitation; token: string }> {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const result = await pool.query<{
    id: string;
    role: OrganizationRole;
    createdAt: Date;
    expiresAt: Date;
    createdBy: string;
  }>(
    `INSERT INTO agon_organization_invitations
       (id, organization_id, token_hash, role, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, role, created_at AS "createdAt", expires_at AS "expiresAt",
               created_by AS "createdBy"`,
    [id, organizationId, hashInvitation(token), role, createdBy, expiresAt],
  );
  const row = result.rows[0];
  return {
    invitation: {
      ...row,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    },
    token,
  };
}

export async function acceptOrganizationInvitation(
  userId: string,
  token: string,
): Promise<{ organizationId: string; role: OrganizationRole } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      organization_id: string;
      role: OrganizationRole;
    }>(
      `SELECT id, organization_id, role
       FROM agon_organization_invitations
       WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL
         AND expires_at > NOW()
       FOR UPDATE`,
      [hashInvitation(token)],
    );
    const invitation = result.rows[0];
    if (!invitation) {
      await client.query("ROLLBACK");
      return null;
    }
    const existingMembership = await client.query(
      `SELECT 1 FROM agon_organization_memberships
       WHERE organization_id = $1 AND user_id = $2`,
      [invitation.organization_id, userId],
    );
    if (existingMembership.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `INSERT INTO agon_organization_memberships (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [randomUUID(), invitation.organization_id, userId, invitation.role],
    );
    await client.query(
      `UPDATE agon_organization_invitations
       SET accepted_at = NOW() WHERE id = $1`,
      [invitation.id],
    );
    await client.query("COMMIT");
    return { organizationId: invitation.organization_id, role: invitation.role };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
