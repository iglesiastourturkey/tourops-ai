import { check, date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
}, (table) => ({
  sourceKeyIdx: uniqueIndex("historical_operation_imports_source_key_idx").on(table.sourceKey),
  provenanceIdx: uniqueIndex("historical_operation_imports_provenance_idx")
    .on(table.sourceFileId, table.worksheetName, table.sourceRow),
  statusIdx: index("historical_operation_imports_status_idx").on(table.status),
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
}));

export const insertHistoricalOperationImportSchema = createInsertSchema(historicalOperationImportsTable)
  .omit({ id: true, stagedAt: true, updatedAt: true });
export type InsertHistoricalOperationImport = z.infer<typeof insertHistoricalOperationImportSchema>;
export type HistoricalOperationImport = typeof historicalOperationImportsTable.$inferSelect;
