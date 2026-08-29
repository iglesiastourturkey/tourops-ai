-- Migration 0020: Phase 3D-A historical promotion approval/audit metadata
--
-- NOT APPLIED. Do not run this migration against any database — including the
-- dedicated Neon historical staging branch — until it has been separately,
-- explicitly reviewed and approved. This file only adds nullable metadata
-- columns to historical_operation_imports; it creates no operations, no
-- customers, and performs no data rewrite. profiles.id and operations.id are
-- both serial/integer primary keys (verified against
-- lib/db/src/schema/profiles.ts and lib/db/src/schema/operations.ts), so the
-- new foreign keys below are INTEGER, matching those columns exactly.

ALTER TABLE historical_operation_imports
  ADD COLUMN IF NOT EXISTS approved_by_operator_id INTEGER REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by_operator_id INTEGER REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS imported_operation_id INTEGER REFERENCES operations(id),
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS approval_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS promoted_content_sha256 TEXT;

-- promoted_content_sha256 is only ever set once a Phase 3D promotion has
-- actually written the operation/reservation-details projection, so it must
-- either be absent or a well-formed SHA-256 hex digest — never a partial or
-- malformed value that a later idempotent-replay comparison could trust.
ALTER TABLE historical_operation_imports
  ADD CONSTRAINT historical_operation_imports_promoted_hash_check
  CHECK (promoted_content_sha256 IS NULL OR promoted_content_sha256 ~ '^[0-9a-f]{64}$');

-- Lets an operator look up which staging row produced a given operation
-- without a full-table scan; not a uniqueness guarantee by itself —
-- operations_source_historical_key_idx (migration 0019) remains the actual
-- DB-level idempotency backstop.
CREATE INDEX IF NOT EXISTS historical_operation_imports_imported_operation_idx
  ON historical_operation_imports (imported_operation_id);

-- Verification after applying this migration (staging branch only):
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'historical_operation_imports'
--   AND column_name IN (
--     'approved_by_operator_id', 'approved_at',
--     'rejected_by_operator_id', 'rejected_at', 'rejection_reason',
--     'imported_operation_id', 'imported_at', 'last_error',
--     'review_notes', 'approval_version', 'promoted_content_sha256'
--   ) ORDER BY column_name;
--
-- Do not apply to production. Do not apply anywhere until the Phase 3D-A
-- promotion code has been reviewed and this migration separately approved.
