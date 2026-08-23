-- Migration 0017: operation_reservation_details + structured mapping columns
-- Faz 5: GEMI Master Operasyon (Google Sheets) import mapping refactor.
-- Additive only - no existing column/table is altered or dropped. See
-- PLAN_Sheet_Import_Mapping_Refactor.md for the full field-by-field mapping
-- matrix this migration implements.
-- Run this by hand in Neon's SQL Editor (per project convention, Claude never
-- runs DDL directly).

-- ── operations: 6 new nullable relational/scheduling columns ────────────────
-- All additive. Legacy guide_name/guide_phone/driver_name/driver_phone/
-- vehicle_plate text columns are untouched and remain the primary source -
-- the new *_id columns below are populated only in addition, when a
-- confident match against the corresponding master-data table is found.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS pickup_time TEXT;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS port_call_id INTEGER REFERENCES port_calls(id) ON DELETE SET NULL;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS tour_product_id INTEGER REFERENCES tour_products(id) ON DELETE SET NULL;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS guide_resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS driver_resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL;

-- ── operation_reservation_details: 1:1 structured booking snapshot ──────────
-- Holds the fields that are genuinely per-booking (passenger counts/ages,
-- service inclusions, external channel, imported financial metadata) rather
-- than relational master data. Cascade-deletes with its operation, same
-- convention as operation_field_notes/operation_locations.
CREATE TABLE IF NOT EXISTS operation_reservation_details (
  id SERIAL PRIMARY KEY,
  operation_id INTEGER NOT NULL UNIQUE REFERENCES operations(id) ON DELETE CASCADE,

-- Passengers
adult_count INTEGER,
  child_count INTEGER,
  passenger_ages JSONB,
  passenger_language TEXT,

-- Tour (raw values preserved when no tour_products/alias match is found)
tour_type TEXT,
  tour_code_raw TEXT,
  itinerary_raw TEXT,

-- Cruise / port (raw schedule text preserved when no port_calls match)
ship_schedule_raw TEXT,

-- Service details
pickup_point TEXT,
  meal_included TEXT, -- 'included' | 'excluded' | 'unspecified'
entrance_included TEXT, -- 'included' | 'excluded' | 'unspecified'
special_requirements TEXT,

-- Reservation source
external_source TEXT, -- e.g. Viator, Kpt, Klook
external_operator TEXT, -- e.g. PARTNER, VIATOR

-- Financial — imported metadata only. Never auto-posted to
-- accounting_transactions; shown as pending/import metadata in the UI.
net_amount REAL,
  advance_amount REAL,
  currency TEXT,
  collection_status_raw TEXT,

created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ── sheet_reservation_imports: proposed-mapping + match-status columns ──────
-- row_data (raw sheet row) stays untouched as the single source of truth.
-- mapped_data is an editable proposed structured mapping the reviewer can
-- correct before /approve - mirrors reservation_extractions.approved_data.
ALTER TABLE sheet_reservation_imports ADD COLUMN IF NOT EXISTS mapped_data JSONB;
ALTER TABLE sheet_reservation_imports ADD COLUMN IF NOT EXISTS tour_product_match_status TEXT; -- matched | alias_matched | unmatched
ALTER TABLE sheet_reservation_imports ADD COLUMN IF NOT EXISTS port_call_match_status TEXT; -- matched | new_port_call | time_changed | unmatched
