import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Reusable tour catalog entry (e.g. "Private Ephesus Tour"), distinct from `tours`,
 * which is instance-level (one specific booking's dates/customer/etc.). Additive —
 * introduced to support Phase 7 Excel-import matching without touching `tours`.
 */
export const tourProductsTable = pgTable("tour_products", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  destination: text("destination"),
  durationMinutes: integer("duration_minutes"),
  defaultPickupPoint: text("default_pickup_point"),
  defaultMealPolicy: text("default_meal_policy"),
  defaultEntrancePolicy: text("default_entrance_policy"),
  defaultItinerary: text("default_itinerary"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTourProductSchema = createInsertSchema(tourProductsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTourProduct = z.infer<typeof insertTourProductSchema>;
export type TourProduct = typeof tourProductsTable.$inferSelect;
