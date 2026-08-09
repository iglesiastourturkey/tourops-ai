-- Migration: manual-override flag on role_permissions
--
-- seed-permissions.ts runs on every server start and used to overwrite the
-- whole role_permissions matrix unconditionally (ON CONFLICT DO UPDATE), so any
-- permission a super_admin changed from the /roles screen was silently reverted
-- to the hardcoded default on the next restart or deploy.
--
-- This column marks the rows that a super_admin deliberately set to a value
-- other than the seed default. The seed's DO UPDATE now carries
-- "WHERE manually_set = false", so flagged rows are left alone while new
-- (role, permission) pairs still INSERT normally — new permissions introduced
-- by a later release continue to roll out to existing installations.
--
-- Additive and idempotent: no table rewrite (constant DEFAULT on PG 11+),
-- existing rows default to false, i.e. "still seed-managed", which matches
-- current behaviour.
ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS manually_set boolean NOT NULL DEFAULT false;
