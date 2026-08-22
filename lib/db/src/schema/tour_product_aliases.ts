import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tourProductsTable } from "./tour_products";

/**
 * OTA-specific alias names for a tour product (e.g. Viator vs. GetYourGuide naming
 * the same product differently). Used by the Phase 7 Excel/email-matching pipeline.
 * True parent-child relationship (cascade on delete), matching the tour_days -> tours
 * convention rather than the nullable/set-null convention used for cross-entity links.
 */
export const tourProductAliasesTable = pgTable(
  "tour_product_aliases",
  {
    id: serial("id").primaryKey(),
    tourProductId: integer("tour_product_id")
    .notNull()
    .references(() => tourProductsTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    alias: text("alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("tour_product_aliases_product_source_alias_uidx").on(table.tourProductId, table.source, table.alias),
    ],
  );

export const insertTourProductAliasSchema = createInsertSchema(tourProductAliasesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTourProductAlias = z.infer<typeof insertTourProductAliasSchema>;
export type TourProductAlias = typeof tourProductAliasesTable.$inferSelect;
