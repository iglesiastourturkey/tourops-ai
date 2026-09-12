-- Phase 3H.4B: customer identity & reservation-link CAS foundation.
-- Additive, idempotent, backward-compatible, non-destructive.
--
-- THIS MIGRATION IS AUTHORED BUT NOT APPLIED in Phase 3H.4B.
-- No production/staging execution is authorized in this phase.
--
-- Contents:
--   1. customers.normalized_phone / normalized_email / identity_key (all NULL-able).
--   2. Partial unique index on identity_key for ACTIVE customers only.
--   3. reservations.version NOT NULL DEFAULT 1 (CAS token for future linking).
--
-- Uniqueness rationale (see docs/architecture/phase3h4b-customer-identity-foundation.md):
--   - Only identity_key carries a uniqueness guarantee, because it is the
--     sole deterministic resolution unit (dual phone+email mismatch is a
--     CONFLICT, never two independent unique lanes that could disagree).
--   - Partial (WHERE archived_at IS NULL AND identity_key IS NOT NULL):
--     archived customers keep history without blocking reuse of an
--     identity, and customers without usable identity never collide.
--   - Fail-closed: if duplicate active identity_keys already exist,
--     CREATE UNIQUE INDEX raises and the migration stops instead of
--     merging or hiding customers. Resolve duplicates by explicit,
--     separately authorized remediation before retrying.
--   - No data backfill here: existing rows keep NULL normalized identity
--     until the explicit, auditable backfill procedure (documented
--     separately) runs under its own authorization.

-- ── 1. customers identity columns ──────────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS normalized_email text,
  ADD COLUMN IF NOT EXISTS identity_key text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'customers'
      AND column_name IN ('normalized_phone', 'normalized_email', 'identity_key')
      AND data_type <> 'text'
  ) THEN
    RAISE EXCEPTION 'customers identity columns exist with incompatible type';
  END IF;
END $$;

-- ── 2. partial unique identity guarantee (active customers only) ────────────
DO $$
DECLARE
  existing_index_def text;
BEGIN
  SELECT pg_get_indexdef(c.oid) INTO existing_index_def
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname = 'customers_identity_key_active_unique'
    AND c.relkind = 'i';
  IF existing_index_def IS NULL THEN
    -- Fail-closed on pre-existing duplicates: this statement raises
    -- instead of merging customers. See rationale above.
    CREATE UNIQUE INDEX customers_identity_key_active_unique
      ON customers (identity_key)
      WHERE archived_at IS NULL AND identity_key IS NOT NULL;
  ELSIF existing_index_def NOT LIKE '%UNIQUE%'
     OR position('(identity_key)' IN existing_index_def) = 0
     OR position('archived_at IS NULL' IN existing_index_def) = 0
     OR position('identity_key IS NOT NULL' IN existing_index_def) = 0 THEN
    -- Never drop/recreate an existing production index automatically:
    -- an incompatible index with our name means someone defined different
    -- semantics, and silently accepting it would enforce the wrong
    -- guarantee. Stop instead.
    RAISE EXCEPTION 'customers_identity_key_active_unique exists with incompatible definition: %', existing_index_def;
  END IF;
  -- Else: the intended index already exists; no-op (idempotent re-run).
END $$;

-- ── 3. reservations.version CAS token ───────────────────────────────────────
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'reservations'
      AND column_name = 'version'
      AND (data_type <> 'integer' OR is_nullable = 'YES')
  ) THEN
    RAISE EXCEPTION 'reservations.version exists with incompatible definition';
  END IF;
END $$;
