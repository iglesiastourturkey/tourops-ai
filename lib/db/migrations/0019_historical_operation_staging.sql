-- Migration 0019: 2026 historical operation staging + operation idempotency key
--
-- NOT APPLIED. Run manually against the Neon staging branch first. This file
-- creates no customers or operations and moves no legacy record into the live
-- workflow. It only creates a review-gated landing table and a nullable unique
-- provenance key for a later, separately-approved operation import phase.

CREATE TABLE IF NOT EXISTS historical_operation_imports (
  id SERIAL PRIMARY KEY,
  source_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  worksheet_name TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  operation_date DATE NOT NULL,
  customer_name TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  payload JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  staged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT historical_operation_imports_source_kind_check
    CHECK (source_kind IN ('gemi', 'sejour')),
  CONSTRAINT historical_operation_imports_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'imported')),
  CONSTRAINT historical_operation_imports_source_row_check CHECK (source_row > 0),
  CONSTRAINT historical_operation_imports_payload_sha_check
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS historical_operation_imports_source_key_idx
  ON historical_operation_imports (source_key);

CREATE UNIQUE INDEX IF NOT EXISTS historical_operation_imports_provenance_idx
  ON historical_operation_imports (source_file_id, worksheet_name, source_row);

CREATE INDEX IF NOT EXISTS historical_operation_imports_status_idx
  ON historical_operation_imports (status);

-- Future operation approval writes this exact sourceKey. Multiple NULL values
-- remain valid for every non-historical operation; duplicate non-NULL legacy
-- keys fail at the database boundary.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS source_historical_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS operations_source_historical_key_idx
  ON operations (source_historical_key);

-- Staging verification after applying this migration:
--
--   SELECT to_regclass('public.historical_operation_imports');
--   SELECT indexname FROM pg_indexes
--   WHERE indexname IN (
--     'historical_operation_imports_source_key_idx',
--     'historical_operation_imports_provenance_idx',
--     'operations_source_historical_key_idx'
--   ) ORDER BY indexname;
--
-- Do not apply to production until the staging rehearsal and duplicate/no-op
-- rerun checks have been reviewed and separately approved.
