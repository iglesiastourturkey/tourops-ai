import {
  pgTable, text, serial, integer, timestamp, jsonb,
} from "drizzle-orm/pg-core";
import { profilesTable } from "./profiles";

/** Valid system modes */
export const SYSTEM_MODES = ["active", "maintenance", "read_only", "disabled"] as const;
export type SystemMode = typeof SYSTEM_MODES[number];

/**
 * system_settings — single-row table for global system state.
 * The row is created automatically on first boot.
 */
export const systemSettingsTable = pgTable("system_settings", {
  id:                           serial("id").primaryKey(),
  systemMode:                   text("system_mode").notNull().default("active"),
  maintenanceMessage:           text("maintenance_message"),
  maintenanceStartAt:           timestamp("maintenance_start_at",  { withTimezone: true }),
  maintenanceEndAt:             timestamp("maintenance_end_at",    { withTimezone: true }),
  maintenanceAllowedProfileIds: integer("maintenance_allowed_profile_ids").array(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * audit_logs — immutable log of security-relevant events.
 */
export const auditLogsTable = pgTable("audit_logs", {
  id:              serial("id").primaryKey(),
  eventType:       text("event_type").notNull(),
  actorProfileId:  integer("actor_profile_id").references(() => profilesTable.id),
  targetProfileId: integer("target_profile_id").references(() => profilesTable.id),
  oldValue:        jsonb("old_value"),
  newValue:        jsonb("new_value"),
  metadata:        jsonb("metadata"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SystemSettings = typeof systemSettingsTable.$inferSelect;
export type AuditLog       = typeof auditLogsTable.$inferSelect;
