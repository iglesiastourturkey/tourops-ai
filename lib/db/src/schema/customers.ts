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
  // Phase 3H.4B — canonical identity substrate (additive, all nullable).
  // Raw phone/email stay the human-facing source of truth; these columns
  // carry the deterministic normalized forms produced by
  // artifacts/api-server/src/lib/customer-identity.ts and are the ONLY
  // fields the future customer-projection identity resolution may use.
  // NULL is legitimate: a customer without usable contact identity has
  // no normalized identity and never participates in identity matching.
  normalizedPhone: text("normalized_phone"),
  normalizedEmail: text("normalized_email"),
  // Deterministic identity key, e.g. "email:a@b.c|phone:+123" or the
  // single-evidence variants; NULL when neither evidence validates.
  // Uniqueness among active customers is enforced by migration 0028
  // (partial unique index WHERE archived_at IS NULL AND identity_key
  // IS NOT NULL). Names never participate in this key.
  identityKey: text("identity_key"),
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
