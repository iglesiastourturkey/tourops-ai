-- Phase 2D.1 — Migration 0025 post-apply verification (READ-ONLY)
-- =================================================================
-- Companion to lib/db/migrations/0025_resource_identity_foundation.sql.
--
-- This file is DELIBERATELY NOT inside lib/db/migrations/ — several
-- pre-existing focused test scripts (e.g.
-- scripts/daily-operations-phase1d-focused-tests.mjs) do a `readdirSync`
-- over that directory and reason about exact migration file counts/
-- ordering; a companion .sql file living there could be mistaken for an
-- actual migration by that kind of check or by any future migration
-- tooling. This file contains SELECT statements only. It performs no
-- writes, no DDL, and must never be run by any automated migration
-- runner. It exists purely for a human (or a future automated check) to
-- run BY HAND, one statement at a time, against a staging database AFTER
-- migration 0025 has been applied there — never against production, and
-- not as part of this Phase 2D.1 task (0025 has not been applied
-- anywhere as of this writing).
--
-- Before applying 0025 to any database, capture a baseline for the two
-- "unchanged" checks below:
--
--   SELECT count(*) AS baseline_resource_count FROM resources;
--   SELECT count(*) AS baseline_guide_driver_assignment_count
--     FROM operations
--     WHERE guide_name IS NOT NULL OR driver_name IS NOT NULL
--        OR guide_resource_id IS NOT NULL OR driver_resource_id IS NOT NULL;
--
-- Then, after applying 0025, run everything below and compare.

-- 1. Expected new resources columns exist, with the expected nullability.
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'resources'
  AND column_name IN ('email', 'license_number', 'linked_profile_id', 'normalized_name')
ORDER BY column_name;
-- Expect 4 rows. normalized_name -> is_nullable = 'NO'. The other three -> 'YES'.

-- 2. resource_aliases table exists with the expected columns.
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'resource_aliases'
ORDER BY ordinal_position;
-- Expect: id, resource_id, source, alias, normalized_alias, created_at.

-- 3. FK definitions: resources.linked_profile_id -> profiles(id), ON DELETE SET NULL;
--    resource_aliases.resource_id -> resources(id), ON DELETE CASCADE.
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name  AS references_table,
  ccu.column_name AS references_column,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('resources', 'resource_aliases')
ORDER BY tc.table_name, kcu.column_name;
-- Expect: resources.linked_profile_id -> profiles.id, delete_rule = 'SET NULL'.
--         resource_aliases.resource_id -> resources.id, delete_rule = 'CASCADE'.

-- 4. linked_profile_id has a UNIQUE index (one Resource per Profile).
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'resources' AND indexname = 'resources_linked_profile_id_uidx';
-- Expect 1 row; indexdef contains "UNIQUE".

-- 5. All expected indexes exist and are valid (not left invalid by a
--    partial/failed CONCURRENTLY build).
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('resources', 'resource_aliases')
ORDER BY tablename, indexname;
-- Expect (in addition to primary keys):
--   resources_linked_profile_id_uidx (unique), resources_normalized_name_idx,
--   resource_aliases_resource_source_alias_uidx (unique),
--   resource_aliases_normalized_alias_idx, resource_aliases_resource_id_idx.
SELECT indexrelid::regclass AS index_name, indisvalid
FROM pg_index
WHERE indrelid IN ('resources'::regclass, 'resource_aliases'::regclass)
  AND indisvalid = false;
-- Expect 0 rows (no invalid indexes).

-- 6. GUIDE/DRIVER type constraint on resources is unchanged (not widened).
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'resources'::regclass AND contype = 'c';
-- Expect exactly one CHECK constraint, still IN ('GUIDE', 'DRIVER').

-- 7. Existing resource row count is preserved (no rows dropped/added by
--    the migration itself). Compare against the pre-migration baseline
--    captured above.
SELECT count(*) AS resource_count_after_migration FROM resources;

-- 8. No duplicate linked_profile_id among non-NULL rows (belt-and-suspenders
--    check on top of the unique index from #4).
SELECT linked_profile_id, count(*)
FROM resources
WHERE linked_profile_id IS NOT NULL
GROUP BY linked_profile_id
HAVING count(*) > 1;
-- Expect 0 rows.

-- 9. No NULL normalized_name (the column is NOT NULL, but this double-checks
--    the backfill actually ran to completion before the constraint was added).
SELECT count(*) AS resources_with_null_normalized_name
FROM resources
WHERE normalized_name IS NULL;
-- Expect 0.

-- 10. No unexpected resource_aliases rows. This migration inserts none —
--     any row present after a fresh apply came from something else.
SELECT count(*) AS resource_alias_row_count FROM resource_aliases;
-- Expect 0 immediately after a fresh apply (non-zero only if the API's
-- alias endpoints, which are a separate, later, human-invoked action,
-- have already been used against this database).

-- 11. operations table is unchanged: same column set, and specifically the
--     legacy guide/driver/vehicle assignment columns are untouched.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'operations'
  AND column_name IN (
    'guide_name', 'guide_phone', 'driver_name', 'driver_phone',
    'vehicle_plate', 'assigned_guide_user_id',
    'guide_resource_id', 'driver_resource_id', 'vehicle_id', 'pickup_time'
  )
ORDER BY column_name;
-- Expect all 10 rows present with the same types/nullability they had
-- before 0025 - this migration does not touch operations at all. Compare
-- row-for-row against a pre-migration snapshot of this same query if one
-- was captured; if not, at minimum confirm the count is 10 and no column
-- is unexpectedly nullable that was NOT NULL before.
