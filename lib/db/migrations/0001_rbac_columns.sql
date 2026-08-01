-- Migration: RBAC columns (task #13)
-- Adds role-based access control columns required by the 4-role RBAC implementation.
-- This migration is idempotent: IF NOT EXISTS guards prevent errors on re-run.

-- 1. Add is_active to profiles (deactivated users receive 403 on all endpoints)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Change existing 'staff' role values to 'guide' (new default role)
UPDATE profiles SET role = 'guide' WHERE role = 'staff';

-- 3. Add assigned_guide_user_id to operations (soft FK to profiles.clerk_user_id)
--    Used to filter the operations a guide can see and access.
ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS assigned_guide_user_id text;

-- 4. Add created_by_user_id to operation_receipts
--    Used to scope guide receipt deletion to their own records.
ALTER TABLE operation_receipts
  ADD COLUMN IF NOT EXISTS created_by_user_id text;
