import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Port / pickup-point master data. Additive - the existing free-text
 * `tours.portName` column is untouched; this exists in parallel until a later,
 * separately-decided phase normalizes onto it.
 */
export const portsTable = pgTable("ports", {
  id: serial("id").primaryKey(),
  code: text("code").unique(),
  name: text("name").notNull(),
  city: text("city"),
  country: text("country"),
  timezone: text("timezone"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPortSchema = createInsertSchema(portsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPort = z.infer<typeof insertPortSchema>;
export type Port = typeof portsTable.$inferSelect;
