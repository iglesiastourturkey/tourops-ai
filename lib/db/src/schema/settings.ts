import { pgTable, text, serial, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const exchangeRatesTable = pgTable("exchange_rates", {
  id: serial("id").primaryKey(),
  fromCurrency: text("from_currency").notNull(),
  toCurrency: text("to_currency").notNull(),
  rate: real("rate").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const agencySettingsTable = pgTable("agency_settings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("TourOps Acentesi"),
  logo: text("logo"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  defaultCurrency: text("default_currency").notNull().default("TRY"),
  defaultProfitMargin: real("default_profit_margin").notNull().default(20),
  minProfitWarning: real("min_profit_warning").notNull().default(10),
  defaultQuotationValidity: integer("default_quotation_validity").notNull().default(7),
  cancellationPolicy: text("cancellation_policy"),
  paymentTerms: text("payment_terms"),
  cruiseSafetyBufferMinutes: integer("cruise_safety_buffer_minutes").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const emailTemplatesTable = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // quotation | follow_up | confirmation | cancellation | welcome | custom
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  language: text("language").notNull().default("tr"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExchangeRateSchema = createInsertSchema(exchangeRatesTable).omit({ id: true, updatedAt: true });
export const insertAgencySettingsSchema = createInsertSchema(agencySettingsTable).omit({ id: true, updatedAt: true });
export const insertEmailTemplateSchema = createInsertSchema(emailTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExchangeRate = z.infer<typeof insertExchangeRateSchema>;
export type InsertAgencySettings = z.infer<typeof insertAgencySettingsSchema>;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type ExchangeRate = typeof exchangeRatesTable.$inferSelect;
export type AgencySettings = typeof agencySettingsTable.$inferSelect;
export type EmailTemplate = typeof emailTemplatesTable.$inferSelect;
