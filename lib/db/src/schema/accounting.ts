import { pgTable, text, serial, timestamp, integer, real, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { suppliersTable } from "./suppliers";
import { toursTable } from "./tours";
import { operationsTable, operationReceiptsTable } from "./operations";
import { profilesTable } from "./profiles";

export const accountingTransactionsTable = pgTable("accounting_transactions", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // 'income' | 'expense'
  category: text("category").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("TRY"),
  exchangeRate: real("exchange_rate"),
  amountTry: real("amount_try"),
  taxRate: real("tax_rate"),
  taxAmount: real("tax_amount"),
  netAmount: real("net_amount"),
  paymentMethod: text("payment_method"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  // 'pending' | 'paid' | 'partially_paid' | 'cancelled'
  accountingStatus: text("accounting_status").notNull().default("pending_review"),
  // 'pending_review' | 'approved' | 'rejected' | 'missing_information'
  transactionDate: date("transaction_date").notNull(),
  dueDate: date("due_date"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  description: text("description"),
  documentNumber: text("document_number"),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  tourId: integer("tour_id").references(() => toursTable.id, { onDelete: "set null" }),
  operationId: integer("operation_id").references(() => operationsTable.id, { onDelete: "set null" }),
  receiptId: integer("receipt_id").references(() => operationReceiptsTable.id, { onDelete: "set null" }),
  createdByProfileId: integer("created_by_profile_id").notNull().references(() => profilesTable.id, { onDelete: "restrict" }),
  approvedByProfileId: integer("approved_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const accountingDocumentsTable = pgTable("accounting_documents", {
  id: serial("id").primaryKey(),
  documentType: text("document_type").notNull().default("receipt"),
  // 'receipt' | 'invoice' | 'expense_note' | 'other'
  operationId: integer("operation_id").references(() => operationsTable.id, { onDelete: "set null" }),
  transactionId: integer("transaction_id").references(() => accountingTransactionsTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  objectPath: text("object_path").notNull(),
  originalFileName: text("original_file_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  fileSize: integer("file_size").notNull().default(0),
  ocrStatus: text("ocr_status").notNull().default("not_processed"),
  // 'not_processed' | 'processed' | 'failed'
  reviewStatus: text("review_status").notNull().default("pending"),
  // 'pending' | 'approved' | 'rejected' | 'missing_information'
  notes: text("notes"),
  createdByProfileId: integer("created_by_profile_id").notNull().references(() => profilesTable.id, { onDelete: "restrict" }),
  reviewedByProfileId: integer("reviewed_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // Manual correction audit (JSON: field overrides; original OCR values stay in main columns)
  correctedFields: text("corrected_fields"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAccountingTransactionSchema = createInsertSchema(accountingTransactionsTable)
  .omit({ id: true, createdAt: true, updatedAt: true, approvedAt: true, approvedByProfileId: true, rejectionReason: true })
  .extend({ amount: z.number().positive() });

export const insertAccountingDocumentSchema = createInsertSchema(accountingDocumentsTable)
  .omit({ id: true, createdAt: true, updatedAt: true, reviewedAt: true, reviewedByProfileId: true });

export type AccountingTransaction = typeof accountingTransactionsTable.$inferSelect;
export type AccountingDocument = typeof accountingDocumentsTable.$inferSelect;
export type InsertAccountingTransaction = z.infer<typeof insertAccountingTransactionSchema>;
export type InsertAccountingDocument = z.infer<typeof insertAccountingDocumentSchema>;

// ── Accounting Settings ────────────────────────────────────────────────────────
export const accountingSettingsTable = pgTable("accounting_settings", {
  id: serial("id").primaryKey(),
  defaultCurrency: text("default_currency").notNull().default("TRY"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  defaultVatRate: real("default_vat_rate").notNull().default(20),
  // JSON arrays stored as text
  vatRates: text("vat_rates").notNull().default('["0","1","8","10","20"]'),
  paymentMethods: text("payment_methods").notNull().default('["Nakit","Kredi Kartı","Havale/EFT","Çek","Döviz"]'),
  documentNumberPrefix: text("document_number_prefix").notNull().default("TRP"),
  accountantNotes: text("accountant_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AccountingSettings = typeof accountingSettingsTable.$inferSelect;
