import { pgTable, text, serial, timestamp, integer, date, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shipsTable } from "./ships";
import { portsTable } from "./ports";

/**
 * One ship's scheduled call at one port on one date. Additive - nothing in
 * `operations`/`tours` references this yet; Phase 2 is expected to add a nullable
 * `portCallId` FK from `operations`. `onDelete: "restrict"` on both FKs (not
 * cascade/set-null): a ship/port with recorded calls can't be deleted out from
 * under that history - mirrors the existing `restrict` convention already
 * used for accounting_transactions.createdByProfileId -> profiles.
 */
export const portCallsTable = pgTable(
  "port_calls",
  {
    id: serial("id").primaryKey(),
    shipId: integer("ship_id")
    .notNull()
    .references(() => shipsTable.id, { onDelete: "restrict" }),
    portId: integer("port_id")
    .notNull()
    .references(() => portsTable.id, { onDelete: "restrict" }),
    arrivalDate: date("arrival_date").notNull(),
    arrivalTime: text("arrival_time"),
    departureDate: date("departure_date"),
    departureTime: text("departure_time"),
    status: text("status"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("port_calls_ship_port_arrival_uidx").on(table.shipId, table.portId, table.arrivalDate),
    ],
  );

export const insertPortCallSchema = createInsertSchema(portCallsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortCall = z.infer<typeof insertPortCallSchema>;
export type PortCall = typeof portCallsTable.$inferSelect;
