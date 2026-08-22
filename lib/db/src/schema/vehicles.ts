import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Standalone vehicle identity, independent of whichever driver-supplier row
 * currently holds a plate (`suppliers.vehiclePlate`/`vehicleInfo`, unchanged).
 * Nothing reads from this table yet - it exists so a vehicle can eventually be
 * conflict-checked on its own, the same way guides/drivers already are.
 */
export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  plate: text("plate").notNull().unique(),
  type: text("type"),
  capacity: integer("capacity"),
  company: text("company"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
