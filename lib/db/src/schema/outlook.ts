import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { profilesTable } from "./profiles";

// Mirrors googleConnectionsTable (./gmail.ts) — same shape, separate table.
// Microsoft revokes/expires credentials independently of Google's, and the two
// providers' token payloads are not interchangeable, so this stays a dedicated
// table rather than a generic "email_connections" table with a provider column
// spanning both. `provider` is kept anyway (default "outlook") for parity with
// the Gmail table and in case a future Microsoft integration (e.g. Teams) needs
// to share this table the way gmail/drive share google_connections.
export const outlookConnectionsTable = pgTable("outlook_connections", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("outlook"),
  outlookAccountEmail: text("outlook_account_email"),
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
  profileProviderUnique: uniqueIndex("outlook_connections_profile_provider_idx").on(table.profileId, table.provider),
}));

export type OutlookConnection = typeof outlookConnectionsTable.$inferSelect;
