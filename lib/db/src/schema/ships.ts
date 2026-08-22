import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Cruise ship master data. `normalizedName` is a lowercase/trimmed dedup key so
 * manual entry and the Phase 7 Excel import can't silently create near-duplicate
 * ships (real data has exact-name variants for the same physical ship).
 */
export const shipsTable = pgTable("ships", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  cruiseLine: text("cruise_line"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertShipSchema = createInsertSchema(shipsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertShip = z.infer<typeof insertShipSchema>;
export type Ship = typeof shipsTable.$inferSelect;
