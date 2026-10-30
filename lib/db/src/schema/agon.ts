import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const agonRecordsTable = pgTable(
  "agon_records",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agon_records_owner_kind_created_idx").on(
      table.ownerId,
      table.kind,
      table.createdAt,
    ),
    index("agon_records_kind_idx").on(table.kind),
  ],
);

export const agonEnrollmentTokensTable = pgTable(
  "agon_enrollment_tokens",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    deviceName: text("device_name").notNull(),
    deviceGroup: text("device_group").notNull(),
    allowUnattended: boolean("allow_unattended").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agon_enrollment_token_hash_idx").on(table.tokenHash),
    index("agon_enrollment_owner_created_idx").on(
      table.ownerId,
      table.createdAt,
    ),
  ],
);
