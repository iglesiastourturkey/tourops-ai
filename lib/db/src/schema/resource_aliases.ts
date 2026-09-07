import { pgTable, text, serial, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { resourcesTable } from "./resources";

/**
 * Source aliases for a canonical Resource (Guide/Driver identity) —
 * mirrors tour_product_aliases.ts as closely as the two domains allow (see
 * docs/architecture/canonical-data-dictionary-v1-final.md Section B/F).
 *
 * One Resource can have many aliases, each tagged with where it came from
 * (`source`: e.g. SHEET_IMPORT, PERFORMANCE_2026, MANUAL, LEGACY_OPERATION —
 * see RESOURCE_ALIAS_SOURCES in lib/personnel-write.ts for the validated
 * list; deliberately not a DB CHECK constraint, same as
 * tour_product_aliases.source, so a new source needs no migration).
 *
 * Deliberately NOT unique on (normalizedAlias) alone, or even on
 * (normalizedAlias) scoped to one resource type: the same alias text is
 * allowed to point at more than one distinct resourceId. That ambiguity is
 * a feature, not a bug — it is exactly the AMBIGUOUS case the identity
 * matching service (lib/personnel-identity.ts) must surface for human
 * review rather than silently resolving. The unique index below only
 * prevents the same (resource, source, alias) triple from being recorded
 * twice.
 */
export const resourceAliasesTable = pgTable(
  "resource_aliases",
  {
    id: serial("id").primaryKey(),
    resourceId: integer("resource_id")
      .notNull()
      .references(() => resourcesTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    alias: text("alias").notNull(),
    // Computed by the same normalizePersonName() used for
    // resources.normalizedName — see lib/personnel-identity.ts. Never
    // computed twice with different logic; both columns must always agree
    // with what that one function would produce for the same raw text.
    normalizedAlias: text("normalized_alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("resource_aliases_resource_source_alias_uidx").on(table.resourceId, table.source, table.alias),
    index("resource_aliases_normalized_alias_idx").on(table.normalizedAlias),
    index("resource_aliases_resource_id_idx").on(table.resourceId),
  ],
);

export const insertResourceAliasSchema = createInsertSchema(resourceAliasesTable).omit({ id: true, createdAt: true });
export type InsertResourceAlias = z.infer<typeof insertResourceAliasSchema>;
export type ResourceAlias = typeof resourceAliasesTable.$inferSelect;
