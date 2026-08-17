import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { profilesTable } from "./profiles";

export const microsoftConnectionsTable = pgTable("microsoft_connections", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
  // Kept for parity with google_connections' multi-provider design, even though
  // only "outlook" is used today — avoids a second migration if another
  // Microsoft 365 service (e.g. Teams) is added later.
  provider: text("provider").notNull().default("outlook"),
  microsoftAccountEmail: text("microsoft_account_email"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
  lastSuccessfulAccessAt: timestamp("last_successful_access_at", { withTimezone: true }),
  status: text("status").notNull().default("connected"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  profileProviderUnique: uniqueIndex("microsoft_connections_profile_provider_idx").on(table.profileId, table.provider),
}));

export type MicrosoftConnection = typeof microsoftConnectionsTable.$inferSelect;
