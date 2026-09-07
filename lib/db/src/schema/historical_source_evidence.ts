import { check, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { historicalOperationImportsTable } from "./historical_operation_imports";

export interface HistoricalSourceEvidenceCell {
  address: string;
  column: number;
  header: string | null;
  rawValue: unknown;
  displayValue: string | null;
  isBlank: boolean;
}

/**
 * Immutable, source-faithful evidence for one historical staging row.
 * This table is read by the Phase 3E.1 queue only; it never changes the staged
 * payload, review state, or any downstream operation/reservation record.
 */
export const historicalSourceEvidenceTable = pgTable("historical_source_evidence", {
  id: serial("id").primaryKey(),
  historicalImportId: integer("historical_import_id")
    .notNull()
    .references(() => historicalOperationImportsTable.id, { onDelete: "restrict" }),
  sourceKey: text("source_key").notNull(),
  sourceFileId: text("source_file_id").notNull(),
  workbookPath: text("workbook_path").notNull(),
  workbookSha256: text("workbook_sha256").notNull(),
  worksheetName: text("worksheet_name").notNull(),
  sourceRow: integer("source_row").notNull(),
  headerRow: integer("header_row").notNull(),
  cells: jsonb("cells").$type<HistoricalSourceEvidenceCell[]>().notNull(),
  evidenceSha256: text("evidence_sha256").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  historicalImportUnique: uniqueIndex("historical_source_evidence_import_idx").on(table.historicalImportId),
  sourceKeyUnique: uniqueIndex("historical_source_evidence_source_key_idx").on(table.sourceKey),
  workbookShaCheck: check("historical_source_evidence_workbook_sha_check", sql`${table.workbookSha256} ~ '^[0-9a-f]{64}$'`),
  evidenceShaCheck: check("historical_source_evidence_sha_check", sql`${table.evidenceSha256} ~ '^[0-9a-f]{64}$'`),
  sourceRowCheck: check("historical_source_evidence_source_row_check", sql`${table.sourceRow} > 0`),
  headerRowCheck: check("historical_source_evidence_header_row_check", sql`${table.headerRow} > 0 AND ${table.headerRow} < ${table.sourceRow}`),
}));

export type HistoricalSourceEvidence = typeof historicalSourceEvidenceTable.$inferSelect;
