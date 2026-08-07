import { pgTable, text, serial, timestamp, integer, real, date, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { quotationsTable } from "./quotations";
import { toursTable } from "./tours";
import { customersTable } from "./customers";
import { profilesTable } from "./profiles";

export const operationsTable = pgTable("operations", {
  id: serial("id").primaryKey(),
  quotationId: integer("quotation_id").references(() => quotationsTable.id, { onDelete: "set null" }),
  sourceType: text("source_type").notNull().default("manual"),
  sourceQuoteId: integer("source_quote_id").references(() => quotationsTable.id, { onDelete: "set null" }),
  sourceEmailImportId: integer("source_email_import_id"),
  sourceBookingReference: text("source_booking_reference"),
  tourId: integer("tour_id").references(() => toursTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: text("status").notNull().default("active"),
  completionRate: real("completion_rate").notNull().default(0),
  // Monotonic, precision-safe compare-and-swap token for field mutations.
  version: integer("version").notNull().default(1),
  assignedTo: text("assigned_to"),
  notes: text("notes"),
  // Guide & driver assignment
  guideName: text("guide_name"),
  guidePhone: text("guide_phone"),
  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  vehiclePlate: text("vehicle_plate"),
  // Emergency contacts
  emergencyContact1Name: text("emergency_contact1_name"),
  emergencyContact1Phone: text("emergency_contact1_phone"),
  emergencyContact2Name: text("emergency_contact2_name"),
  emergencyContact2Phone: text("emergency_contact2_phone"),
  // Assigned guide user (Clerk userId, soft FK to profiles)
  assignedGuideUserId: text("assigned_guide_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  gmailImportUnique: uniqueIndex("operations_source_email_import_idx").on(table.sourceEmailImportId),
}));

export const operationTasksTable = pgTable("operation_tasks", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").notNull().references(() => operationsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("not_started"),
  priority: text("priority").notNull().default("medium"),
  dueDate: date("due_date"),
  assignedTo: text("assigned_to"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  sortOrder: real("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const operationReceiptsTable = pgTable("operation_receipts", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").notNull().references(() => operationsTable.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("TRY"),
  supplierName: text("supplier_name"),
  receiptDate: text("receipt_date"),
  guideNote: text("guide_note"),
  photoObjectPath: text("photo_object_path"),
  createdByUserId: text("created_by_user_id"), // Clerk userId of the creator; used for guide receipt scoping
  // Accounting review tracking
  reviewStatus: text("review_status").notNull().default("pending_review"),
  // 'pending_review' | 'approved' | 'rejected' | 'missing_information'
  reviewNotes: text("review_notes"),
  reviewedByProfileId: integer("reviewed_by_profile_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // OCR + manual correction audit
  ocrStatus: text("ocr_status").notNull().default("not_started"),
  // 'not_started' | 'processed' | 'failed'
  correctedFields: text("corrected_fields"),
  // JSON: manually corrected overrides (preserves original OCR values in main columns)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ── New Sprint-6 tables ───────────────────────────────────────────────────────

export const operationStatusHistoryTable = pgTable("operation_status_history", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").notNull().references(() => operationsTable.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorProfileId: integer("actor_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fieldIncidentsTable = pgTable("field_incidents", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").references(() => operationsTable.id, { onDelete: "set null" }),
  type: text("type").notNull().default("other"),
  severity: text("severity").notNull().default("medium"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  reportedByProfileId: integer("reported_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  assignedToProfileId: integer("assigned_to_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  photoObjectPath: text("photo_object_path"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const operationFieldNotesTable = pgTable("operation_field_notes", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").notNull().references(() => operationsTable.id, { onDelete: "cascade" }),
  noteText: text("note_text").notNull(),
  category: text("category").notNull().default("general"),
  authorProfileId: integer("author_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  photoObjectPath: text("photo_object_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ── Operation Documents ───────────────────────────────────────────────────────

export const operationDocumentsTable = pgTable("operation_documents", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").notNull().references(() => operationsTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull().default("other"),
  // 'voucher' | 'passenger_list' | 'hotel_confirmation' | 'flight_ticket' | 'pdf' | 'other'
  title: text("title").notNull(),
  objectPath: text("object_path").notNull(),
  fileMimeType: text("file_mime_type"),
  fileSize: integer("file_size"),
  uploadedByProfileId: integer("uploaded_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ── Sprint 6.1: location sharing ─────────────────────────────────────────────

export const operationLocationsTable = pgTable("operation_locations", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").notNull().references(() => operationsTable.id, { onDelete: "cascade" }),
  profileId: integer("profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  accuracy: real("accuracy"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OperationLocation = typeof operationLocationsTable.$inferSelect;

export const insertOperationSchema = createInsertSchema(operationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOperationTaskSchema = createInsertSchema(operationTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOperationReceiptSchema = createInsertSchema(operationReceiptsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOperationDocumentSchema = createInsertSchema(operationDocumentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperation = z.infer<typeof insertOperationSchema>;
export type InsertOperationTask = z.infer<typeof insertOperationTaskSchema>;
export type InsertOperationReceipt = z.infer<typeof insertOperationReceiptSchema>;
export type InsertOperationDocument = z.infer<typeof insertOperationDocumentSchema>;
export type Operation = typeof operationsTable.$inferSelect;
export type OperationTask = typeof operationTasksTable.$inferSelect;
export type OperationReceipt = typeof operationReceiptsTable.$inferSelect;
export type OperationDocument = typeof operationDocumentsTable.$inferSelect;
export type OperationStatusHistory = typeof operationStatusHistoryTable.$inferSelect;
export type FieldIncident = typeof fieldIncidentsTable.$inferSelect;
export type OperationFieldNote = typeof operationFieldNotesTable.$inferSelect;
