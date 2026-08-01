import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  nationality: text("nationality"),
  language: text("language"),
  phone: text("phone"),
  email: text("email"),
  whatsapp: text("whatsapp"),
  customerType: text("customer_type").notNull().default("individual"),
  travelPreferences: text("travel_preferences"),
  dietaryRestrictions: text("dietary_restrictions"),
  accessibilityRequirements: text("accessibility_requirements"),
  passportStatus: text("passport_status").notNull().default("not_requested"),
  notes: text("notes"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
