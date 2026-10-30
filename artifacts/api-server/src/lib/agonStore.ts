import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

export type AgonRecord = {
  id: string;
  ownerId: string;
  kind: string;
  data: Record<string, unknown>;
  createdAt: Date;
};

type DatabaseRecord = {
  id: string;
  owner_id: string;
  kind: string;
  data: Record<string, unknown>;
  created_at: Date;
};

function mapRecord(row: DatabaseRecord): AgonRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    data: row.data,
    createdAt: row.created_at,
  };
}

export async function createRecord(
  ownerId: string,
  kind: string,
  data: Record<string, unknown>,
  id: string = randomUUID(),
): Promise<AgonRecord> {
  const result = await pool.query<DatabaseRecord>(
    `INSERT INTO agon_records (id, owner_id, kind, data)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, owner_id, kind, data, created_at`,
    [id, ownerId, kind, JSON.stringify(data)],
  );
  return mapRecord(result.rows[0]);
}

export async function saveRecord(
  ownerId: string,
  kind: string,
  id: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO agon_records (id, owner_id, kind, data)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = NOW()
       WHERE agon_records.owner_id = EXCLUDED.owner_id
         AND agon_records.kind = EXCLUDED.kind`,
    [id, ownerId, kind, JSON.stringify(data)],
  );
  return result.rowCount === 1;
}

export async function getRecord(
  ownerId: string,
  kind: string,
  id: string,
): Promise<AgonRecord | null> {
  const result = await pool.query<DatabaseRecord>(
    `SELECT id, owner_id, kind, data, created_at
     FROM agon_records
     WHERE owner_id = $1 AND kind = $2 AND id = $3
     LIMIT 1`,
    [ownerId, kind, id],
  );
  return result.rows[0] ? mapRecord(result.rows[0]) : null;
}

export async function getRecordById(
  kind: string,
  id: string,
): Promise<AgonRecord | null> {
  const result = await pool.query<DatabaseRecord>(
    `SELECT id, owner_id, kind, data, created_at
     FROM agon_records
     WHERE kind = $1 AND id = $2
     LIMIT 1`,
    [kind, id],
  );
  return result.rows[0] ? mapRecord(result.rows[0]) : null;
}

export async function listRecords(
  ownerId: string,
  kind: string,
  limit = 1000,
): Promise<AgonRecord[]> {
  const result = await pool.query<DatabaseRecord>(
    `SELECT id, owner_id, kind, data, created_at
     FROM agon_records
     WHERE owner_id = $1 AND kind = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [ownerId, kind, Math.max(1, Math.min(5000, Math.floor(limit)))],
  );
  return result.rows.map(mapRecord);
}

export async function addAudit(
  ownerId: string,
  action: string,
  detail: Record<string, unknown>,
  severity: "info" | "success" | "warning" | "critical" = "info",
  actor = "Operator",
): Promise<void> {
  const id = randomUUID();
  const at = new Date().toISOString();
  await createRecord(ownerId, "audit", {
    at,
    action,
    actor,
    detail,
    severity,
    relayId: "agon-hosted",
  }, id);
}
