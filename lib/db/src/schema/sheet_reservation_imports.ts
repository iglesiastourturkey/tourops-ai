import { pgTable, text, serial, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { operationsTable } from "./operations";
import { customersTable } from "./customers";
import { profilesTable } from "./profiles";

// Faz 4: GEMI Master Operasyon (Google Sheets) -> TourPilot review queue.
// One-way, review-gated: an Apps Script trigger pushes every edited row on
// the "Reservations" tab here via a signed webhook. Nothing here ever
// writes to operations/customers on its own - only the manual /approve
// route does, mirroring the external_port_call_observations pattern from
// Faz 1-3. rowData is the full raw sheet row (header -> cell value) and is
// always the source of truth; no column-mapping is guessed at ingest time.
export const sheetReservationImportsTable = pgTable("sheet_reservation_imports", {
  id: serial("id").primaryKey(),

  sheetFileId: text("sheet_file_id").notNull(),
  sheetName: text("sheet_name").notNull(),
  rowNumber: integer("row_number").notNull(),

  // Full raw row as captured by Apps Script: {"Tarih": "...", "Musteri Adi": "...", ...}
  rowData: jsonb("row_data").notNull(),

  editedByEmail: text("edited_by_email").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),

  status: text("status").notNull().default("pending"), // pending | approved | rejected

  matchedOperationId: integer("matched_operation_id").references(() => operationsTable.id, { onDelete: "set null" }),
  matchedCustomerId: integer("matched_customer_id").references(() => customersTable.id, { onDelete: "set null" }),

    // ── Faz 5: proposed structured mapping, editable before approve ───────────
    // rowData above stays the untouched source of truth. mappedData is an
    // editable proposed structured mapping the reviewer can correct via
    // PATCH /:id/review before /approve - mirrors reservation_extractions'
    // approvedData pattern. The *MatchStatus columns surface whether the
    // tour-product/port-call matching found a confident match, so the review
    // UI can warn instead of silently guessing (see
    // PLAN_Sheet_Import_Mapping_Refactor.md).
    mappedData: jsonb("mapped_data"),
    tourProductMatchStatus: text("tour_product_match_status"), // matched | alias_matched | unmatched
    portCallMatchStatus: text("port_call_match_status"), // matched | new_port_call | time_changed | unmatched

  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: integer("approved_by").references(() => profilesTable.id, { onDelete: "set null" }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedBy: integer("rejected_by").references(() => profilesTable.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  rowIdx: uniqueIndex("sheet_reservation_imports_row_idx").on(table.sheetFileId, table.sheetName, table.rowNumber),
  statusIdx: index("sheet_reservation_imports_status_idx").on(table.status),
}));

export const insertSheetReservationImportSchema = createInsertSchema(sheetReservationImportsTable);
export type InsertSheetReservationImport = z.infer<typeof insertSheetReservationImportSchema>;
export type SheetReservationImport = typeof sheetReservationImportsTable.$inferSelect;
