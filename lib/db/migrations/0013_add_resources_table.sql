-- Phase 1 (additive only): resources master-data table (guides/drivers).
-- Completes the Phase 1 master-data set started in 0012_cruise_master_data.sql.
-- 0012 has ALREADY been applied to production - this is a NEW, separate migration
-- file rather than an edit to 0012, per the established convention that a migration
-- file is immutable documentation once it has been run (same rule already followed
-- for 0010/0011/0012). No ALTER or DROP on any existing table. This file is
-- documentation-style, same as every other file in this folder - it is NOT
-- auto-applied by drizzle-kit push; it must be run manually against the target
-- Neon branch and verified afterwards via information_schema.

CREATE TABLE IF NOT EXISTS resources (
    id serial PRIMARY KEY,
    type text NOT NULL CHECK (type IN ('GUIDE', 'DRIVER')),
    name text NOT NULL,
    phone text,
    languages text,
    company text,
    active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
