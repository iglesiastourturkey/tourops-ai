import { pgTable, text, serial, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  address: text("address"),
  city: text("city"),
  category: text("category").notNull().default("other"),
  currency: text("currency").notNull().default("TRY"),
  rating: real("rating"),
  /**
   * Vehicle details, only meaningful for category="driver" rows. Drivers are
   * modeled as suppliers (no dedicated driver entity), so these live here
   * rather than in a parallel table — the operation assignment dialog reads
   * them to auto-fill the vehicle plate.
   */
  vehiclePlate: text("vehicle_plate"),
  vehicleInfo: text("vehicle_info"),
  notes: text("notes"),
  bankDetails: text("bank_details"),
  taxNumber: text("tax_number"),
  isActive: boolean("is_active").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;
