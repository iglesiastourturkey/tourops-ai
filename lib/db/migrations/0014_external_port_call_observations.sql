-- Phase 1c (additive only): external_port_call_observations staging table.
-- Pure schema addition for a future cruise-schedule verification feature (see
-- the architecture research report from this session). No provider/fetch code
-- exists yet - this table is unused until a later phase wires it up. port_calls
-- remains the system of record; this table only ever holds unverified candidate
-- observations pending human review/approval. No ALTER or DROP on any existing
-- table. Documentation-style, NOT auto-applied by drizzle-kit push - run manually
-- against Neon and verify via information_schema, same process as 0010-0013.

CREATE TABLE IF NOT EXISTS external_port_call_observations (
    id serial PRIMARY KEY,
    provider text NOT NULL,
    external_reference text NOT NULL,
    ship_name_raw text NOT NULL,
    ship_id integer REFERENCES ships(id) ON DELETE SET NULL,
    port_name_raw text NOT NULL,
    port_id integer REFERENCES ports(id) ON DELETE SET NULL,
    arrival_date date,
    arrival_time text,
    departure_date date,
    departure_time text,
    match_status text NOT NULL CHECK (match_status IN ('MATCHED', 'NEW_PORT_CALL', 'TIME_CHANGED', 'SHIP_UNMATCHED', 'PORT_UNMATCHED', 'CONFLICT', 'SOURCE_MISSING_TIME', 'MANUAL_REVIEW_REQUIRED')),
    matched_port_call_id integer REFERENCES port_calls(id) ON DELETE SET NULL,
    detected_changes jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz,
    approved_by integer REFERENCES profiles(id) ON DELETE SET NULL,
    raw_payload jsonb
  );
CREATE UNIQUE INDEX IF NOT EXISTS external_port_call_observations_provider_ref_uidx
  ON external_port_call_observations (provider, external_reference);
