import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { toursTable } from "./tours";
import { suppliersTable } from "./suppliers";

export const tourCostsTable = pgTable("tour_costs", {
  id: serial("id").primaryKey(),
  tourId: integer("tour_id").notNull().references(() => toursTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  category: text("category").notNull().default("other"),
  quantity: real("quantity").notNull().default(1),
  unitCost: real("unit_cost").notNull().default(0),
  currency: text("currency").notNull().default("TRY"),
  taxRate: real("tax_rate").notNull().default(0),
  total: real("total").notNull().default(0),
  isPerPerson: boolean("is_per_person").notNull().default(false),
  isConfirmed: boolean("is_confirmed").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTourCostSchema = createInsertSchema(tourCostsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTourCost = z.infer<typeof insertTourCostSchema>;
export type TourCost = typeof tourCostsTable.$inferSelect;
