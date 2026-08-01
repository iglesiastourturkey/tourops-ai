import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { toursTable } from "./tours";

export const tourDaysTable = pgTable("tour_days", {
  id: serial("id").primaryKey(),
  tourId: integer("tour_id").notNull().references(() => toursTable.id, { onDelete: "cascade" }),
  dayNumber: integer("day_number").notNull(),
  title: text("title"),
  summary: text("summary"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  locations: text("locations"),
  activities: text("activities"),
  mealPlan: text("meal_plan"),
  transportPlan: text("transport_plan"),
  estimatedDrivingMinutes: integer("estimated_driving_minutes"),
  estimatedActivityMinutes: integer("estimated_activity_minutes"),
  accessibilityNotes: text("accessibility_notes"),
  operationalNotes: text("operational_notes"),
  sortOrder: real("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTourDaySchema = createInsertSchema(tourDaysTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTourDay = z.infer<typeof insertTourDaySchema>;
export type TourDay = typeof tourDaysTable.$inferSelect;
