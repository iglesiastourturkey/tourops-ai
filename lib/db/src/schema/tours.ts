import { pgTable, text, serial, timestamp, integer, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const toursTable = pgTable("tours", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  nights: integer("nights"),
  adultCount: integer("adult_count").notNull().default(1),
  childCount: integer("child_count").notNull().default(0),
  mainDestination: text("main_destination"),
  destinations: text("destinations"), // JSON array
  tourType: text("tour_type").notNull().default("cultural"),
  status: text("status").notNull().default("draft"),
  guideLanguage: text("guide_language"),
  transferRequired: boolean("transfer_required").notNull().default(false),
  hotelCategory: text("hotel_category"),
  budget: text("budget"),
  isCruiseExcursion: boolean("is_cruise_excursion").notNull().default(false),
  shipName: text("ship_name"),
  portName: text("port_name"),
  shipArrivalTime: text("ship_arrival_time"),
  shipDepartureTime: text("ship_departure_time"),
  cruiseSafetyBufferMinutes: integer("cruise_safety_buffer_minutes").notNull().default(30),
  profitMargin: integer("profit_margin"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTourSchema = createInsertSchema(toursTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTour = z.infer<typeof insertTourSchema>;
export type Tour = typeof toursTable.$inferSelect;
