-- Phase 1 (additive only): cruise/tour master-data foundations.
-- No ALTER or DROP on any existing table. Mirrors the CREATE TABLE IF NOT EXISTS
-- style of 0010_communication_integration_events.sql. This file is documentation-
-- style, same as every other file in this folder - it is NOT auto-applied by
-- drizzle-kit push; it must be run manually against the target Neon branch and
-- verified afterwards via information_schema, per the process already used for
-- 0010 and 0011.

CREATE TABLE IF NOT EXISTS tour_products (
    id serial PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    destination text,
    duration_minutes integer,
    default_pickup_point text,
    default_meal_policy text,
    default_entrance_policy text,
    default_itinerary text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS tour_product_aliases (
    id serial PRIMARY KEY,
    tour_product_id integer NOT NULL REFERENCES tour_products(id) ON DELETE CASCADE,
    source text NOT NULL,
    alias text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
CREATE UNIQUE INDEX IF NOT EXISTS tour_product_aliases_product_source_alias_uidx
  ON tour_product_aliases (tour_product_id, source, alias);

CREATE TABLE IF NOT EXISTS ships (
    id serial PRIMARY KEY,
    name text NOT NULL,
    normalized_name text NOT NULL UNIQUE,
    cruise_line text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS ports (
    id serial PRIMARY KEY,
    code text UNIQUE,
    name text NOT NULL,
    city text,
    country text,
    timezone text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS port_calls (
    id serial PRIMARY KEY,
    ship_id integer NOT NULL REFERENCES ships(id) ON DELETE RESTRICT,
    port_id integer NOT NULL REFERENCES ports(id) ON DELETE RESTRICT,
    arrival_date date NOT NULL,
    arrival_time text,
    departure_date date,
    departure_time text,
    status text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
CREATE UNIQUE INDEX IF NOT EXISTS port_calls_ship_port_arrival_uidx
  ON port_calls (ship_id, port_id, arrival_date);

CREATE TABLE IF NOT EXISTS vehicles (
    id serial PRIMARY KEY,
    plate text NOT NULL UNIQUE,
    type text,
    capacity integer,
    company text,
    active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
