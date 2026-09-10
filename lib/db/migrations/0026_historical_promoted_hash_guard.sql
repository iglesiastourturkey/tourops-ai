-- Migration 0026: Phase 3G.3 production-preflight guard for the 0020
-- promoted-content hash check.
--
-- CONTEXT: migration 0020 adds
--   CONSTRAINT historical_operation_imports_promoted_hash_check
-- via a bare ALTER TABLE ... ADD CONSTRAINT (no IF NOT EXISTS). Every other
-- statement in the 0019/0020/0021/0024 historical DDL set is guarded, and this
-- repo has no migration journal/framework guaranteeing exactly-once
-- application (migrations are raw SQL applied manually via psql). A retry or
-- recovery re-run of 0020 therefore aborts with "already exists" mid-window.
--
-- THIS FILE DOES NOT REWRITE HISTORY: 0020 is left byte-identical. This is a
-- new, purely additive, safely re-runnable guard for the same constraint:
--
--   - constraint absent    -> added (same definition as 0020)
--   - constraint present and correct -> no-op, NOTICE only
--   - same name present with a different definition -> FAIL CLOSED
--     (RAISE EXCEPTION, no silent normalization)
--
-- No DROP. No TRUNCATE. No destructive ALTER. No data writes.

DO $$
DECLARE
  existing_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint
  WHERE conname = 'historical_operation_imports_promoted_hash_check'
    AND connamespace = 'public'::regnamespace;

  IF existing_def IS NULL THEN
    ALTER TABLE historical_operation_imports
      ADD CONSTRAINT historical_operation_imports_promoted_hash_check
      CHECK (promoted_content_sha256 IS NULL OR promoted_content_sha256 ~ '^[0-9a-f]{64}$');
    RAISE NOTICE '0026: constraint added';
  ELSIF existing_def LIKE '%promoted_content_sha256%'
        AND existing_def LIKE '%^[0-9a-f]{64}$%' THEN
    RAISE NOTICE '0026: constraint already present with expected definition, no-op';
  ELSE
    RAISE EXCEPTION '0026: constraint % exists with an unexpected definition: %',
      'historical_operation_imports_promoted_hash_check', existing_def;
  END IF;
END
$$;
