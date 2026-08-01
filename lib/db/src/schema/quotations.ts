import { pgTable, text, serial, timestamp, integer, real, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { toursTable } from "./tours";

export const quotationsTable = pgTable("quotations", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  tourId: integer("tour_id").references(() => toursTable.id, { onDelete: "set null" }),
  expiresAt: date("expires_at"),
  currency: text("currency").notNull().default("TRY"),
  subtotal: real("subtotal").notNull().default(0),
  discount: real("discount").notNull().default(0),
  finalPrice: real("final_price").notNull().default(0),
  paymentTerms: text("payment_terms"),
  cancellationPolicy: text("cancellation_policy"),
  includedServices: text("included_services"),
  excludedServices: text("excluded_services"),
  notes: text("notes"),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertQuotationSchema = createInsertSchema(quotationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuotation = z.infer<typeof insertQuotationSchema>;
export type Quotation = typeof quotationsTable.$inferSelect;
