import { pgTable, text, serial, timestamp, boolean, integer, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

/**
 * Canonical Personnel/Guide identity foundation (Phase 2D.1 — see
 * docs/architecture/canonical-data-dictionary-v1-final.md, Sections B/C,
 * and docs/architecture/phase2d1-personnel-identity-foundation.md for the
 * full rationale).
 *
 * History: this table started in migration 0013 as a standalone, additive
 * guide/driver identity ("Additive - nothing reads from this table yet...
 * Not connected to operations in Phase 1"). That is no longer accurate —
 * `operations.guide_resource_id` / `driver_resource_id` are read for
 * display in operation-detail-read.ts / daily-operations-read.ts and
 * written by routes/sheet-import.ts's exact-match resolution. What is
 * still true, confirmed by reading the live write paths (not assumed):
 * the manual assignment endpoint (PATCH /field/operations/:id/assignments)
 * writes only `operations.guide_name` / `driver_name` / `vehicle_plate`
 * and never touches this table's id. Those legacy text fields remain the
 * most consistently populated assignment representation until Phase 2C
 * ships the write-path canonicalization fix named in the architecture
 * document. Do not assume `operations.guide_resource_id` is reliably
 * populated before then.
 *
 * PERSON != LOGIN ACCOUNT: `linkedProfileId` is an optional, explicit
 * pointer from a canonical person to a TourPilot login (profiles row). A
 * Resource is fully valid and assignable with no linked profile — most of
 * the ~84 real personnel found in the 2026 performance workbook almost
 * certainly have no app login at all. A login must never be required to
 * establish or use this identity.
 */
export const resourcesTable = pgTable(
    "resources",
  {
        id: serial("id").primaryKey(),
        type: text("type").notNull(),
        name: text("name").notNull(),
        // Deterministic, ASCII-folded, whitespace/punctuation-stripped form of
        // `name`, computed by normalizePersonName() in lib/personnel-identity.ts
        // and kept in sync on every insert/update by the resources route — see
        // that module for the exact algorithm (Turkish-letter folding is
        // hand-mapped, never left to locale-dependent String.toLowerCase()).
        // Deliberately NOT unique: two distinct real people can normalize to
        // the same string (e.g. two different "Kadir Şahin"s), and identical
        // normalized names must never be assumed to be the same person — see
        // resource_aliases.ts and lib/personnel-identity.ts.
        normalizedName: text("normalized_name").notNull(),
        phone: text("phone"),
        email: text("email"),
        // Not assumed to exist for every driver, and not assumed to be a
        // "guide license" specifically — a bare identifier field, meaning
        // left to whatever license/permit is relevant for this person's type.
        licenseNumber: text("license_number"),
        languages: text("languages"),
        company: text("company"),
        active: boolean("active").notNull().default(true),
        notes: text("notes"),
        // Optional, explicit link to a TourPilot login. Nullable; unique when
        // set (a login belongs to at most one canonical person). ON DELETE
        // SET NULL: removing/disabling a profile must never delete or affect
        // this Resource, and disabling this Resource (active = false) must
        // never touch the linked profile — the two lifecycles are independent
        // by construction.
        linkedProfileId: integer("linked_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
    (table) => [
          check("resources_type_check", sql`${table.type} IN ('GUIDE', 'DRIVER')`),
          index("resources_normalized_name_idx").on(table.normalizedName),
          // Plain UNIQUE index, not a partial one: Postgres already treats
          // multiple NULLs as distinct in a UNIQUE index (same convention as
          // operations_source_historical_key_idx, migration 0021), so this
          // reads as "unique when non-null" with no WHERE clause needed.
          uniqueIndex("resources_linked_profile_id_uidx").on(table.linkedProfileId),
        ],
  );

export const insertResourceSchema = createInsertSchema(resourcesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertResource = z.infer<typeof insertResourceSchema>;
export type Resource = typeof resourcesTable.$inferSelect;
