-- Phase 1A: additive domain foundation for the Reservation != Operation
-- model (see docs/architecture/phase1a-reservation-domain.md for the full
-- rationale, and lib/db/src/schema/reservations.ts for the Drizzle schema
-- this migration mirrors field-for-field).
--
-- Cardinality introduced: operations (1) -> reservations (many) ->
-- booking_parties (1) -> guests (0..many). A TourOperation can now
-- structurally hold more than one independently-sourced booking (VIATOR,
-- GYG, direct, etc.), matching the real Excel-discovered operating model.
--
-- THIS MIGRATION IS PURELY ADDITIVE:
--   - Three new tables only: reservations, booking_parties, guests.
--   - No ALTER on any existing table.
--   - No DROP, DELETE, TRUNCATE, or data-touching UPDATE anywhere.
--   - `operations` and `operation_reservation_details` are not modified in
--     any way, including their indexes and constraints. In particular,
--     operations_source_sheet_import_idx (added by migration 0018) is left
--     completely untouched — this migration does not relax, drop, or
--     otherwise change the guarantee it enforces. See Finding 8 /
--     Section 8 of the Phase 1A/1B architecture review for why that
--     specific index must not move until Phase 1B actually rewires the
--     sheet-import write path.
--   - Nothing in this migration is read or written by any existing route
--     (sheet-import.ts, historical-migration-promote.ts, reservations.ts's
--     create-draft handler) or any UI screen. These tables have zero
--     writers until a separately-approved Phase 1B.
--
-- Every statement uses IF NOT EXISTS, matching this repository's existing
-- migration convention (e.g. 0018, 0021) so a re-run is a safe no-op.
--
-- NOT APPLIED. Run against the Neon staging branch first; there is nothing
-- to reconcile before applying since all three tables are new and start
-- empty, but confirm typecheck/build/existing test suite are green first
-- (see the Phase 1A validation report for that run's results).

-- ── reservations ────────────────────────────────────────────────────────
--
-- One row per independently-sourced booking under a TourOperation.
-- tour_operation_id cascades with its operation (a reservation has no
-- independent existence without one), matching the existing convention
-- for operation_tasks/operation_receipts/operation_field_notes/
-- operation_documents/operation_locations/operation_status_history.
-- rebooked_into_reservation_id is a self-referencing FK that intentionally
-- does NOT cascade (ON DELETE SET NULL) — a rebooking link is history, not
-- ownership.
CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  tour_operation_id INTEGER NOT NULL
    REFERENCES operations(id) ON DELETE CASCADE,
  customer_id INTEGER
    REFERENCES customers(id) ON DELETE SET NULL,
  lead_guest_name TEXT NOT NULL,
  reservation_type TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  rebooked_into_reservation_id INTEGER
    REFERENCES reservations(id) ON DELETE SET NULL,
  -- Reservation-level provenance, unpopulated until Phase 1B. sourceType /
  -- source_email_import_id / source_sheet_import_id are deliberately soft
  -- (no enforced FK), mirroring the same columns on `operations`, which
  -- also have no .references() today.
  source_type TEXT,
  source_email_import_id INTEGER,
  source_sheet_import_id INTEGER,
  source_historical_key TEXT,
  source_booking_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reservations_status_check
    CHECK (status IN ('new', 'confirmed', 'completed', 'canceled', 'rebooked', 'no_show'))
);

CREATE INDEX IF NOT EXISTS reservations_tour_operation_idx ON reservations (tour_operation_id);
CREATE INDEX IF NOT EXISTS reservations_customer_idx ON reservations (customer_id);
CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations (status);

-- NEW guarantee on a brand-new, empty table — cannot conflict with any
-- existing row, and is not a relaxation of operations_source_sheet_import_idx
-- (which stays exactly as it is). This index enforces "one reservation per
-- approved sheet-import row" for whenever Phase 1B's rewritten
-- sheet-import.ts actually starts writing here; until then it is inert.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_source_sheet_import_idx ON reservations (source_sheet_import_id);

CREATE INDEX IF NOT EXISTS reservations_source_historical_key_idx ON reservations (source_historical_key);

-- Same normalized, partial, NON-unique pattern as
-- operations_source_booking_reference_idx (migration 0009) — advisory
-- duplicate detection only, never a hard constraint. Two different
-- Reservations may legitimately share a booking reference.
CREATE INDEX IF NOT EXISTS reservations_source_booking_reference_idx
  ON reservations (lower(trim(source_booking_reference)))
  WHERE source_booking_reference IS NOT NULL;

-- ── booking_parties ─────────────────────────────────────────────────────
--
-- Strict 1:1 with reservations (reservation_id is UNIQUE), same
-- cascade-with-parent convention as operation_reservation_details' 1:1
-- with operations. net_amount/advance_amount are NUMERIC(12,2), not REAL —
-- a deliberate deviation from every existing money column in this database
-- (accounting_transactions, operation_receipts,
-- operation_reservation_details all use REAL), per the explicit Phase 1A
-- instruction to prefer NUMERIC/DECIMAL for any *new* amount column. No
-- existing REAL column is touched by this migration.
CREATE TABLE IF NOT EXISTS booking_parties (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER NOT NULL UNIQUE
    REFERENCES reservations(id) ON DELETE CASCADE,
  -- adult_count/child_count: no DEFAULT. Missing != zero — a blank source
  -- cell means "unknown," not "zero," matching
  -- operation_reservation_details.adult_count/child_count exactly.
  adult_count INTEGER,
  child_count INTEGER,
  passenger_language TEXT,
  meal_included TEXT,
  entrance_included TEXT,
  special_requirements TEXT,
  external_source TEXT,
  external_operator TEXT,
  net_amount NUMERIC(12, 2),
  advance_amount NUMERIC(12, 2),
  currency TEXT,
  collection_status_raw TEXT,
  tour_code_raw TEXT,
  itinerary_raw TEXT,
  ship_schedule_raw TEXT,
  pickup_point TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- "Missing != zero" only applies to absence; a *present* count must
  -- still be non-negative. Same IS NULL OR >= 0 shape as
  -- historical_operation_imports_source_row_check and the communications
  -- table's count checks.
  CONSTRAINT booking_parties_adult_count_check CHECK (adult_count IS NULL OR adult_count >= 0),
  CONSTRAINT booking_parties_child_count_check CHECK (child_count IS NULL OR child_count >= 0)
);

-- ── guests ──────────────────────────────────────────────────────────────
--
-- GUEST MODEL RULE, enforced at the database level: guest rows are OPTIONAL
-- enrichment, never fabricated. There is deliberately no constraint here
-- (and none is possible to express as a single-table CHECK, nor is one
-- added via trigger) requiring COUNT(guests) to equal
-- booking_parties.adult_count + booking_parties.child_count. A
-- booking_parties row with adult_count = 3, child_count = 1 and only two
-- named guests on file ("Richard", "Lyne") is valid. The authoritative pax
-- number for capacity/roster/Daily-Operations-Center purposes is always
-- booking_parties.adult_count + booking_parties.child_count, never a count
-- of guest rows.
CREATE TABLE IF NOT EXISTS guests (
  id SERIAL PRIMARY KEY,
  booking_party_id INTEGER NOT NULL
    REFERENCES booking_parties(id) ON DELETE CASCADE,
  -- NOT NULL: a guest row is only ever created when a name is actually
  -- known — that is the entire point of "optional enrichment, never
  -- fabricated."
  name TEXT NOT NULL,
  age INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT guests_age_check CHECK (age IS NULL OR age >= 0)
);

CREATE INDEX IF NOT EXISTS guests_booking_party_idx ON guests (booking_party_id);

-- Verification (read-only, safe to run after applying to staging):
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('reservations', 'booking_parties', 'guests');
-- -- Expect all three rows.
--
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'operations'::regclass
--   AND conname = 'operations_source_sheet_import_idx';
-- -- This is an index, not a table constraint, so this query intentionally
-- -- returns nothing; use the next query instead to confirm it survived
-- -- untouched:
--
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'operations'
--   AND indexname = 'operations_source_sheet_import_idx';
-- -- Expect exactly one row, unchanged from before this migration.
--
-- SELECT count(*) FROM operation_reservation_details;
-- -- Expect this to be unaffected by this migration (same row count as
-- -- before applying).
--
-- SELECT count(*) FROM reservations;  -- Expect 0 immediately after apply.
-- SELECT count(*) FROM booking_parties;  -- Expect 0 immediately after apply.
-- SELECT count(*) FROM guests;  -- Expect 0 immediately after apply.
