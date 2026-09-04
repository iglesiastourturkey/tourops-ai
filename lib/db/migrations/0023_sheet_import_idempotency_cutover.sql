-- Phase 1B.1 sheet-import idempotency cutover. NOT APPLIED by this change.
--
-- DEPLOYMENT PRECONDITIONS (in this exact order):
--   1. Migration 0022 has been applied and
--      reservations_source_sheet_import_idx is present and UNIQUE.
--   2. The Phase 1B.1 application writer is deployed and healthy. It writes
--      reservations.source_sheet_import_id for every newly approved row.
--   3. Confirm no planned rollback to the legacy writer is in progress.
--
-- The guard below refuses to remove the legacy operation-level unique index
-- unless the reservation-level unique index is already active. Therefore
-- there is never a deployed state with neither source-row uniqueness guard.
-- The replacement preserves the index name as a plain provenance/search
-- index; idempotency ownership has moved to reservations.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'reservations_source_sheet_import_idx'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION
      'Phase 1B.1 cutover requires UNIQUE reservations_source_sheet_import_idx before relaxing operations_source_sheet_import_idx';
  END IF;
END
$$;

DROP INDEX IF EXISTS operations_source_sheet_import_idx;

CREATE INDEX IF NOT EXISTS operations_source_sheet_import_idx
ON operations (source_sheet_import_id);

-- ROLLBACK ORDER (do not run automatically):
--   A. Quiesce/redeploy the Phase 1B.1 writer so it cannot create a new
--      operation while the operation-level uniqueness is being restored.
--   B. Verify operations.source_sheet_import_id has no non-NULL duplicates.
--   C. DROP INDEX operations_source_sheet_import_idx;
--      CREATE UNIQUE INDEX operations_source_sheet_import_idx
--        ON operations (source_sheet_import_id);
--   D. Only after the UNIQUE index is restored, redeploy the legacy writer.
-- Do not drop reservations_source_sheet_import_idx during rollback.
