import { pgTable, text, serial, timestamp, integer, real, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { quotationsTable } from "./quotations";
import { toursTable } from "./tours";
import { customersTable } from "./customers";

export const operationsTable = pgTable("operations", {
  id: serial("id").primaryKey(),
  quotationId: integer("quotation_id").references(() => quotationsTable.id, { onDelete: "set null" }),
  tourId: integer("tour_id").references(() => toursTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: text("status").notNull().default("active"),
  completionRate: real("completion_rate").notNull().default(0),
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
});

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

export const insertOperationSchema = createInsertSchema(operationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOperationTaskSchema = createInsertSchema(operationTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOperationReceiptSchema = createInsertSchema(operationReceiptsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperation = z.infer<typeof insertOperationSchema>;
export type InsertOperationTask = z.infer<typeof insertOperationTaskSchema>;
export type InsertOperationReceipt = z.infer<typeof insertOperationReceiptSchema>;
export type Operation = typeof operationsTable.$inferSelect;
export type OperationTask = typeof operationTasksTable.$inferSelect;
export type OperationReceipt = typeof operationReceiptsTable.$inferSelect;
