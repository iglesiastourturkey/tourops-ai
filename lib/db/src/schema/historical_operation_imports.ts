import { check, date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";
import { operationsTable } from "./operations";

/**
 * Faz 3C: review-gated landing table for 2026 legacy GEMI/SEJOUR records.
 *
 * Rows here are not operational truth and never create customers, operations,
 * accounting entries, messages, or Drive writes by themselves. sourceKey is
 * the immutable legacy provenance key and payloadSha256 prevents a rerun from
 * silently replacing the content already staged under that key.
 */
export const historicalOperationImportsTable = pgTable("historical_operation_imports", {
  id: serial("id").primaryKey(),
  sourceKey: text("source_key").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  sourceFileId: text("source_file_id").notNull(),
  sourceKind: text("source_kind").notNull(),
  worksheetName: text("worksheet_name").notNull(),
  sourceRow: integer("source_row").notNull(),
  operationDate: date("operation_date").notNull(),
  customerName: text("customer_name").notNull(),
  policyVersion: text("policy_version").notNull(),
  payload: jsonb("payload").notNull(),
  warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("pending"),
  stagedAt: timestamp("staged_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),

  // ── Faz 3D-A: review-gated approval/promotion metadata ───────────────────
  // Added by migration 0020 (NOT yet applied anywhere). Every column here is
  // nullable except approval_version, which is a CAS token guarding
  // concurrent approve/reject calls on the same row - never a business value
  // by itself. Promotion never sets these directly on this row without also
  // writing imported_operation_id/imported_at in the same transaction; see
  // historical-migration-promote.ts.
  approvedByOperatorId: integer("approved_by_operator_id").references(() => profilesTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedByOperatorId: integer("rejected_by_operator_id").references(() => profilesTable.id),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  importedOperationId: integer("imported_operation_id").references(() => operationsTable.id),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  lastError: text("last_error"),
  reviewNotes: text("review_notes"),
  approvalVersion: integer("approval_version").notNull().default(1),
  // SHA-256 of the deterministic operation+reservationDetails projection
  // actually written to the DB on first successful promotion. Reused on every
  // later idempotent-replay attempt to tell "same content, already promoted"
  // (no-op) apart from "different content under the same key" (conflict).
  promotedContentSha256: text("promoted_content_sha256"),
}, (table) => ({
  sourceKeyIdx: uniqueIndex("historical_operation_imports_source_key_idx").on(table.sourceKey),
  provenanceIdx: uniqueIndex("historical_operation_imports_provenance_idx")
    .on(table.sourceFileId, table.worksheetName, table.sourceRow),
  statusIdx: index("historical_operation_imports_status_idx").on(table.status),
  importedOperationIdx: index("historical_operation_imports_imported_operation_idx").on(table.importedOperationId),
  sourceKindCheck: check(
    "historical_operation_imports_source_kind_check",
    sql`${table.sourceKind} IN ('gemi', 'sejour')`,
  ),
  statusCheck: check(
    "historical_operation_imports_status_check",
    sql`${table.status} IN ('pending', 'approved', 'rejected', 'imported')`,
  ),
  sourceRowCheck: check("historical_operation_imports_source_row_check", sql`${table.sourceRow} > 0`),
  payloadShaCheck: check(
    "historical_operation_imports_payload_sha_check",
    sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`,
  ),
  promotedContentShaCheck: check(
    "historical_operation_imports_promoted_hash_check",
    sql`${table.promotedContentSha256} IS NULL OR ${table.promotedContentSha256} ~ '^[0-9a-f]{64}$'`,
  ),
}));

export const insertHistoricalOperationImportSchema = createInsertSchema(historicalOperationImportsTable)
  .omit({ id: true, stagedAt: true, updatedAt: true });
export type InsertHistoricalOperationImport = z.infer<typeof insertHistoricalOperationImportSchema>;
export type HistoricalOperationImport = typeof historicalOperationImportsTable.$inferSelect;
