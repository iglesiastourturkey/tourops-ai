import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { operationsTable } from "./operations";
import { customersTable } from "./customers";

/**
 * Phase 1A — additive domain foundation for the Reservation != Operation
 * model (see docs/architecture/phase1a-reservation-domain.md for the full
 * rationale). These three tables are new and unused by any existing code
 * path in Phase 1A: nothing here is read or written by sheet-import.ts,
 * historical-migration-promote.ts, reservations.ts (the create-draft route),
 * or any UI screen yet. `operation_reservation_details` (see
 * ./operation_reservation_details) remains completely intact and is the
 * only table any existing write path touches. Phase 1B is the migration
 * that wires these tables into the real import/read paths.
 *
 * Cardinality: operations (1) -> reservations (many) -> booking_parties (1)
 * -> guests (0..many). A TourOperation is one physical tour departure; a
 * Reservation is one independently-sourced booking within it (VIATOR, GYG,
 * direct, etc. can all land under the same operation). See the Guest Model
 * Rule below — this is the one rule most likely to be violated by a naive
 * import implementation in Phase 1B, so it is repeated at every relevant
 * field.
 */

// ── reservations ─────────────────────────────────────────────────────────
//
// One row per independently-sourced booking under a TourOperation. Cascade-
// deletes with its operation: a reservation has no independent existence
// once its operation is gone, the same reasoning already applied to
// operation_tasks/operation_receipts/operation_field_notes/operation_documents/
// operation_locations/operation_status_history. This differs from
// operations.customerId (onDelete: "set null") because that FK preserves an
// operation when a *customer* record is removed — a different lifecycle
// question - not because operations and reservations disagree on convention.
export const reservationsTable = pgTable("reservations", {
  id: serial("id").primaryKey(),

  tourOperationId: integer("tour_operation_id")
    .notNull()
    .references(() => operationsTable.id, { onDelete: "cascade" }),

  // Nullable, onDelete "set null": mirrors operations.customerId exactly.
  // Removing a customer record must never destroy reservation history.
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),

  // NOT NULL: every real intake source (Sheet import, Gmail/Outlook,
  // historical Excel, manual entry) supplies at minimum a lead guest name —
  // this is the one traveler-identifying field the real data is never
  // missing (only the full named-passenger manifest is inconsistent; see
  // booking_parties/guests below). A reservation with no identifying name
  // cannot be shown in a roster or Daily Operations Center card, so this is
  // enforced at the schema level rather than left to application code.
  leadGuestName: text("lead_guest_name").notNull(),

  // Nullable, no CHECK: mirrors operation_reservation_details.tourType and
  // operations.sourceType's raw-preservation convention — unknown/unmapped
  // source values (e.g. a platform-specific booking-type code) are kept
  // verbatim rather than forced into a fixed enum the source data doesn't
  // actually follow.
  reservationType: text("reservation_type"),

  // Lowercase, matching every existing status/type text column in this
  // schema (operations.status default "active", accountingStatus
  // "pending_review", historical_operation_imports.status "pending", etc.).
  // The Phase-1 review's uppercase suggestion (NEW/CONFIRMED/...) is
  // deliberately not followed here — repo convention wins.
  status: text("status").notNull().default("new"),

  // Self-FK, nullable, onDelete "set null" (never cascade): a rebooking
  // link is history, not ownership. If the *newer* reservation this points
  // to is ever deleted, the old reservation must simply lose the pointer,
  // not be deleted itself — deleting reservation rows is not a Phase-1A (or
  // Phase-1B) concern at all.
  rebookedIntoReservationId: integer("rebooked_into_reservation_id")
    .references((): AnyPgColumn => reservationsTable.id, { onDelete: "set null" }),

  // ── Provenance (reservation-level; see docs for the full per-field table
  //    distinguishing "which source created the Operation" from "which
  //    source created this Reservation") ──────────────────────────────────
  //
  // None of these five columns are populated by any existing code path in
  // Phase 1A. They exist so Phase 1B has somewhere to write without a
  // schema change blocking it.
  sourceType: text("source_type"),

  // Soft reference, NOT a Drizzle/DB-enforced FK — deliberately mirrors
  // operations.sourceEmailImportId, which is also a plain integer column
  // with no .references() call in this schema today. Keeping the same
  // (lack of) enforcement avoids introducing a stricter contract on the
  // reservation-level column than already exists on the operation-level
  // sibling it is modeled after.
  sourceEmailImportId: integer("source_email_import_id"),

  // Soft reference, same reasoning as sourceEmailImportId: operations.
  // sourceSheetImportId also has no enforced FK today.
  sourceSheetImportId: integer("source_sheet_import_id"),

  // Nullable, no unique index yet. Deliberately less committed than
  // sourceSheetImportId: relocating *this* uniqueness guarantee is Phase
  // 1B's job once the sheet-import write path actually targets this table
  // (see docs). Adding a unique index now, before any writer exists, would
  // assert a guarantee Phase 1A cannot actually back with real behavior.
  sourceHistoricalKey: text("source_historical_key"),

  // Advisory only — see bookingReferenceIdx below. Never a hard unique key,
  // matching operations.sourceBookingReference's own (non-unique, partial,
  // normalized) index.
  sourceBookingReference: text("source_booking_reference"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  tourOperationIdx: index("reservations_tour_operation_idx").on(table.tourOperationId),
  customerIdx: index("reservations_customer_idx").on(table.customerId),
  statusIdx: index("reservations_status_idx").on(table.status),

  // NEW guarantee, additive and empty-table-safe: this table has zero rows
  // in Phase 1A (nothing writes to it yet), so creating this index now can
  // never fail on an existing duplicate the way relaxing
  // operations_source_sheet_import_idx could. This is intentionally NOT the
  // same guarantee as that index — that one stays untouched, enforcing
  // "one operation per approved sheet-import row," exactly as it does
  // today. This one will enforce "one reservation per approved sheet-import
  // row" once Phase 1B's rewritten sheet-import.ts actually writes here.
  // Until then it is a no-op guarantee on an empty table, not a
  // relaxation of anything.
  sheetImportUnique: uniqueIndex("reservations_source_sheet_import_idx").on(table.sourceSheetImportId),

  historicalKeyIdx: index("reservations_source_historical_key_idx").on(table.sourceHistoricalKey),

  // Same normalized, partial-index pattern as
  // operations.bookingReferenceIdx — advisory duplicate detection only,
  // never a hard constraint. Two different Reservations under different
  // Operations (or the same Operation) may legitimately share a booking
  // reference (e.g. a rebooking, or two guests booked together by an
  // agency under one reference) — see item 11 of the Phase 1A test plan.
  bookingReferenceIdx: index("reservations_source_booking_reference_idx")
    .on(sql`lower(trim(${table.sourceBookingReference}))`)
    .where(sql`${table.sourceBookingReference} IS NOT NULL`),

  statusCheck: check(
    "reservations_status_check",
    sql`${table.status} IN ('new', 'confirmed', 'completed', 'canceled', 'rebooked', 'no_show')`,
  ),
}));

// ── booking_parties ───────────────────────────────────────────────────────
//
// Strict 1:1 with reservations — same cascade-with-parent convention as
// operation_reservation_details' 1:1 with operations. Holds exactly the
// per-booking operational/financial metadata operation_reservation_details
// holds today, just re-parented to a reservation instead of an operation
// (a Phase-1B concern; this table has no writer yet).
export const bookingPartiesTable = pgTable("booking_parties", {
  id: serial("id").primaryKey(),

  reservationId: integer("reservation_id")
    .notNull()
    .unique()
    .references(() => reservationsTable.id, { onDelete: "cascade" }),

  // Nullable, no default(0): missing != zero. A blank cell in the source
  // sheet means "unknown," not "zero adults" — defaulting to 0 would
  // silently fabricate a fact the source never stated. Mirrors
  // operation_reservation_details.adultCount/childCount exactly.
  adultCount: integer("adult_count"),
  childCount: integer("child_count"),

  passengerLanguage: text("passenger_language"),
  mealIncluded: text("meal_included"),
  entranceIncluded: text("entrance_included"),
  specialRequirements: text("special_requirements"),
  externalSource: text("external_source"),
  externalOperator: text("external_operator"),

  // NUMERIC(12,2), not REAL: the architecture review's explicit instruction
  // for any *new* amount column, even though every existing money column in
  // this repo (accounting_transactions, operation_receipts,
  // operation_reservation_details) uses `real`. This is a deliberate,
  // spec-directed deviation from repo convention, not an oversight — see
  // docs/architecture/phase1a-reservation-domain.md. It does not touch any
  // existing `real` column; those are unchanged.
  netAmount: numeric("net_amount", { precision: 12, scale: 2 }),
  advanceAmount: numeric("advance_amount", { precision: 12, scale: 2 }),

  currency: text("currency"),
  collectionStatusRaw: text("collection_status_raw"),
  tourCodeRaw: text("tour_code_raw"),
  itineraryRaw: text("itinerary_raw"),
  shipScheduleRaw: text("ship_schedule_raw"),
  pickupPoint: text("pickup_point"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  // "Missing != zero" only applies to absence; a *present* count must still
  // be a real, non-negative count. IS NULL OR >= 0 is the same shape as
  // historical_operation_imports.sourceRowCheck and communications'
  // processedCount/pendingApprovalCount/errorCount checks.
  adultCountCheck: check("booking_parties_adult_count_check", sql`${table.adultCount} IS NULL OR ${table.adultCount} >= 0`),
  childCountCheck: check("booking_parties_child_count_check", sql`${table.childCount} IS NULL OR ${table.childCount} >= 0`),
}));

// ── guests ────────────────────────────────────────────────────────────────
//
// GUEST MODEL RULE (Phase 1A, enforced at the schema level):
// Guest rows are OPTIONAL enrichment, never fabricated. A booking_parties
// row with adultCount = 3, childCount = 1 and only two named guests on file
// (e.g. "Richard" and "Lyne") is VALID — there is deliberately no
// constraint anywhere in this schema, and no application code in Phase 1A,
// that requires COUNT(guests) to equal adultCount + childCount. The
// authoritative pax number for capacity/roster/Daily-Operations-Center
// purposes is always booking_parties.adultCount + booking_parties.
// childCount, never a count of guest rows — Phase 1B display semantics are
// expected to read as e.g. "4 PAX · 2 named." Enforcing row-count equality
// would force every import pipeline to fabricate placeholder guest rows
// the source data never supplied, which is exactly what this rule forbids.
export const guestsTable = pgTable("guests", {
  id: serial("id").primaryKey(),

  bookingPartyId: integer("booking_party_id")
    .notNull()
    .references(() => bookingPartiesTable.id, { onDelete: "cascade" }),

  // NOT NULL: a guest row is only ever created when a name is actually
  // known — that is the entire point of "optional enrichment, never
  // fabricated." An enrichment row with no name would carry no
  // information, so there is no valid reason to create one.
  name: text("name").notNull(),

  age: integer("age"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Included despite being called "optional" in the brief: every single
  // table in this schema pairs createdAt with updatedAt (+ $onUpdate) with
  // no exceptions found during inspection, so omitting it here would be the
  // actual convention break.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  bookingPartyIdx: index("guests_booking_party_idx").on(table.bookingPartyId),

  // Presence is optional; a *stated* age must still be a real age. Same
  // IS NULL OR >= 0 shape as the booking_parties count checks above.
  ageCheck: check("guests_age_check", sql`${table.age} IS NULL OR ${table.age} >= 0`),
}));

export const insertReservationSchema = createInsertSchema(reservationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBookingPartySchema = createInsertSchema(bookingPartiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGuestSchema = createInsertSchema(guestsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertReservation = z.infer<typeof insertReservationSchema>;
export type InsertBookingParty = z.infer<typeof insertBookingPartySchema>;
export type InsertGuest = z.infer<typeof insertGuestSchema>;

export type Reservation = typeof reservationsTable.$inferSelect;
export type BookingParty = typeof bookingPartiesTable.$inferSelect;
export type Guest = typeof guestsTable.$inferSelect;
