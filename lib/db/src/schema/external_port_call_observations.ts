import { pgTable, text, serial, integer, date, timestamp, jsonb, check, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { shipsTable } from "./ships";
import { portsTable } from "./ports";
import { portCallsTable } from "./port_calls";
import { profilesTable } from "./profiles";

export const CRUISE_SCHEDULE_MATCH_STATUSES = [
    "MATCHED",
    "NEW_PORT_CALL",
    "TIME_CHANGED",
    "SHIP_UNMATCHED",
    "PORT_UNMATCHED",
    "CONFLICT",
    "SOURCE_MISSING_TIME",
    "MANUAL_REVIEW_REQUIRED",
  ] as const;

/**
 * Staging table for unverified schedule observations pulled from external sources
 * (port authority sites, AIS providers, manual imports, etc). Nothing here is
 * operational truth - a row only becomes real once a human approves it and it is
 * turned into a port_calls insert/update (matchedPortCallId records that link).
 * port_calls remains the system of record; this table is purely a review queue.
 * No provider/fetch code exists yet - this is schema-only, additive, and unused
 * until a future phase wires an actual fetch job to it.
 */
export const externalPortCallObservationsTable = pgTable(
    "external_port_call_observations",
  {
        id: serial("id").primaryKey(),
        provider: text("provider").notNull(),
        externalReference: text("external_reference").notNull(),
        shipNameRaw: text("ship_name_raw").notNull(),
        shipId: integer("ship_id").references(() => shipsTable.id, { onDelete: "set null" }),
        portNameRaw: text("port_name_raw").notNull(),
        portId: integer("port_id").references(() => portsTable.id, { onDelete: "set null" }),
        arrivalDate: date("arrival_date"),
        arrivalTime: text("arrival_time"),
        departureDate: date("departure_date"),
        departureTime: text("departure_time"),
        matchStatus: text("match_status").notNull(),
        matchedPortCallId: integer("matched_port_call_id").references(() => portCallsTable.id, { onDelete: "set null" }),
        detectedChanges: jsonb("detected_changes"),
        fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
        approvedAt: timestamp("approved_at", { withTimezone: true }),
        approvedBy: integer("approved_by").references(() => profilesTable.id, { onDelete: "set null" }),
        rawPayload: jsonb("raw_payload"),
  },
    (table) => [
          uniqueIndex("external_port_call_observations_provider_ref_uidx").on(table.provider, table.externalReference),
          check(
                  "external_port_call_observations_match_status_check",
                  sql`${table.matchStatus} IN ('MATCHED', 'NEW_PORT_CALL', 'TIME_CHANGED', 'SHIP_UNMATCHED', 'PORT_UNMATCHED', 'CONFLICT', 'SOURCE_MISSING_TIME', 'MANUAL_REVIEW_REQUIRED')`,
                ),
        ],
  );

export const insertExternalPortCallObservationSchema = createInsertSchema(externalPortCallObservationsTable).omit({
    id: true,
    fetchedAt: true,
});
export type InsertExternalPortCallObservation = z.infer<typeof insertExternalPortCallObservationSchema>;
export type ExternalPortCallObservation = typeof externalPortCallObservationsTable.$inferSelect;
