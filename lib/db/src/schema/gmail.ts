import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { profilesTable } from "./profiles";
import { operationsTable } from "./operations";

export const googleConnectionsTable = pgTable("google_connections", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("gmail"),
  googleAccountEmail: text("google_account_email"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  status: text("status").notNull().default("connected"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  profileProviderUnique: uniqueIndex("google_connections_profile_provider_idx").on(table.profileId, table.provider),
}));

export const reservationEmailImportsTable = pgTable("reservation_email_imports", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull().references(() => googleConnectionsTable.id, { onDelete: "cascade" }),
  gmailMessageId: text("gmail_message_id").notNull(),
  gmailThreadId: text("gmail_thread_id"),
  sender: text("sender"),
  recipients: text("recipients"),
  subject: text("subject"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  plainTextBody: text("plain_text_body"),
  sanitizedHtmlBody: text("sanitized_html_body"),
  attachments: jsonb("attachments").$type<Array<{ name: string; mimeType: string; size: number }>>().notNull().default([]),
  status: text("status").notNull().default("new"),
  processingError: text("processing_error"),
  operationId: integer("operation_id").references(() => operationsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  connectionMessageUnique: uniqueIndex("reservation_import_connection_message_idx").on(table.connectionId, table.gmailMessageId),
}));

export const reservationExtractionsTable = pgTable("reservation_extractions", {
  id: serial("id").primaryKey(),
  importId: integer("import_id").notNull().unique().references(() => reservationEmailImportsTable.id, { onDelete: "cascade" }),
  originalAiOutput: jsonb("original_ai_output"),
  extractedData: jsonb("extracted_data"),
  approvedData: jsonb("approved_data"),
  confidenceScore: integer("confidence_score"),
  missingFields: jsonb("missing_fields").$type<string[]>().notNull().default([]),
  uncertainFields: jsonb("uncertain_fields").$type<string[]>().notNull().default([]),
  summaryTr: text("summary_tr"),
  evidence: jsonb("evidence"),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type GoogleConnection = typeof googleConnectionsTable.$inferSelect;
export type ReservationEmailImport = typeof reservationEmailImportsTable.$inferSelect;
export type ReservationExtraction = typeof reservationExtractionsTable.$inferSelect;