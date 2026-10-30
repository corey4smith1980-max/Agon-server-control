import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  boolean,
  integer,
  jsonb,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const agonOrganizationsTable = pgTable("agon_organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isPersonal: boolean("is_personal").notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAgonOrganizationSchema = createInsertSchema(
  agonOrganizationsTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertAgonOrganization = z.infer<typeof insertAgonOrganizationSchema>;
export type AgonOrganization = typeof agonOrganizationsTable.$inferSelect;

export const agonOrganizationMembershipsTable = pgTable(
  "agon_organization_memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => agonOrganizationsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("agon_membership_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    index("agon_membership_user_idx").on(table.userId),
  ],
);

export const insertAgonOrganizationMembershipSchema = createInsertSchema(
  agonOrganizationMembershipsTable,
).omit({ joinedAt: true });
export type InsertAgonOrganizationMembership = z.infer<
  typeof insertAgonOrganizationMembershipSchema
>;
export type AgonOrganizationMembership =
  typeof agonOrganizationMembershipsTable.$inferSelect;

export const agonOrganizationInvitationsTable = pgTable(
  "agon_organization_invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => agonOrganizationsTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    role: text("role").notNull(),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("agon_org_invitation_token_idx").on(table.tokenHash),
    index("agon_org_invitation_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const insertAgonOrganizationInvitationSchema = createInsertSchema(
  agonOrganizationInvitationsTable,
).omit({ createdAt: true, acceptedAt: true, revokedAt: true });
export type InsertAgonOrganizationInvitation = z.infer<
  typeof insertAgonOrganizationInvitationSchema
>;
export type AgonOrganizationInvitation =
  typeof agonOrganizationInvitationsTable.$inferSelect;

export const agonOrganizationPoliciesTable = pgTable(
  "agon_organization_policies",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => agonOrganizationsTable.id, { onDelete: "cascade" }),
    unattendedDesktopEnabled: boolean("unattended_desktop_enabled")
      .notNull()
      .default(false),
    allowedRoles: jsonb("allowed_roles")
      .$type<string[]>()
      .notNull()
      .default(["owner", "admin"]),
    allowedGroups: jsonb("allowed_groups")
      .$type<string[]>()
      .notNull()
      .default([]),
    maxSessionMinutes: integer("max_session_minutes").notNull().default(30),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);
