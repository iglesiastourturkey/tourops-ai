import { pgTable, text, serial, timestamp, boolean, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * Standalone guide/driver identity, independent of the existing
 * operations.guideName / guidePhone / driverName / driverPhone / vehiclePlate
 * text fields (all unchanged - still the source of truth for now). Additive -
 * nothing reads from this table yet; it exists so a guide/driver can eventually
 * be conflict-checked and reused across operations the same way tour_products/
 * ships/ports/vehicles already are. Not connected to operations in Phase 1.
 */
export const resourcesTable = pgTable(
    "resources",
  {
        id: serial("id").primaryKey(),
        type: text("type").notNull(),
        name: text("name").notNull(),
        phone: text("phone"),
        languages: text("languages"),
        company: text("company"),
        active: boolean("active").notNull().default(true),
        notes: text("notes"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
    (table) => [
          check("resources_type_check", sql`${table.type} IN ('GUIDE', 'DRIVER')`),
        ],
  );

export const insertResourceSchema = createInsertSchema(resourcesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertResource = z.infer<typeof insertResourceSchema>;
export type Resource = typeof resourcesTable.$inferSelect;
