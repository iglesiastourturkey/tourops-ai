import { pgTable, text, integer } from "drizzle-orm/pg-core";

/**
 * roles — one row per named role in the system.
 * The actual UserRole enum lives in profiles.ts; this table adds display
 * metadata that the permission matrix UI consumes.
 */
export const rolesTable = pgTable("roles", {
  name:        text("name").primaryKey(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  sortOrder:   integer("sort_order").notNull().default(0),
});

export type Role = typeof rolesTable.$inferSelect;
