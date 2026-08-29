-- Runtime compatibility fix for the normal TourPilot application database.
--
-- The Drizzle operations schema already selects source_historical_key on every
-- operations list/read. Historical migration 0019 also adds this column, but
-- 0019 is intentionally a dedicated historical-staging migration and must not
-- be applied wholesale to the normal application database just to satisfy the
-- runtime schema.
--
-- This migration is therefore deliberately minimal and additive: it adds only
-- the nullable provenance column and its unique index. Existing non-historical
-- rows remain NULL, and PostgreSQL permits multiple NULL values in a UNIQUE
-- index. It creates no historical staging table and moves no data.

ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS source_historical_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS operations_source_historical_key_idx
  ON operations (source_historical_key);

-- Verification (read-only):
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'operations'
--   AND column_name = 'source_historical_key';
--
-- SELECT indexname
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename = 'operations'
--   AND indexname = 'operations_source_historical_key_idx';
