-- Phase 2D.1: canonical Personnel/Guide identity foundation (additive
-- only). See docs/architecture/canonical-data-dictionary-v1-final.md
-- (Sections B/C/F) and
-- docs/architecture/phase2d1-personnel-identity-foundation.md for the full
-- rationale. Extends the existing `resources` table (added in 0013) rather
-- than introducing a parallel Personnel table — the FK plumbing into
-- `operations` (guide_resource_id / driver_resource_id) already exists and
-- is read by lib/operation-detail-read.ts and lib/daily-operations-read.ts,
-- and written by routes/sheet-import.ts's exact-match resolution.
--
-- THIS MIGRATION IS PURELY ADDITIVE:
--   - ALTER TABLE resources ADD COLUMN only (no DROP, no rename, no type
--     change, no constraint removal). `resources_type_check` (GUIDE/DRIVER
--     only) is left exactly as it is — widening it to support future
--     office-personnel types is explicitly out of scope for this phase.
--   - One new table only: resource_aliases.
--   - No ALTER on `operations`, `profiles`, `vehicles`, `suppliers`, or
--     `audit_logs`. Nothing about the existing guide_name / guide_phone /
--     driver_name / driver_phone / vehicle_plate / assigned_guide_user_id /
--     guide_resource_id / driver_resource_id / vehicle_id columns on
--     `operations` changes in any way — this migration adds a new,
--     optional identity layer alongside them, per the architecture
--     document's explicit backward-compatibility requirement.
--   - No data is merged, deduplicated, or guessed. The one computed value
--     this migration backfills (normalized_name) is a pure, deterministic
--     function of a column that already exists on every row — not a guess
--     about identity, phone, email, license, or any other fact.
--
-- Every statement uses IF NOT EXISTS / guarded DO blocks, matching this
-- repository's existing migration convention (0018, 0021, 0022), so a
-- re-run is a safe no-op.
--
-- NOT APPLIED. Run against the Neon staging branch first, after
-- typecheck/build/focused tests are confirmed green (see the Phase 2D.1
-- validation report). No production data is touched by writing this file.

-- ── resources: new optional identity columns ───────────────────────────
--
-- linked_profile_id: PERSON != LOGIN ACCOUNT. Optional, explicit pointer
-- from a canonical Resource to a TourPilot login (profiles row). ON DELETE
-- SET NULL: removing a profile must never delete or affect the Resource.
-- The UNIQUE index below allows any number of NULLs (Postgres treats NULLs
-- as distinct in a UNIQUE index — same convention as
-- operations_source_historical_key_idx from migration 0021) while still
-- guaranteeing at most one Resource per non-null profile id.
ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS license_number TEXT,
  ADD COLUMN IF NOT EXISTS linked_profile_id INTEGER
    REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS resources_linked_profile_id_uidx
  ON resources (linked_profile_id);

-- Backfill normalized_name for any pre-existing rows. This is a pure,
-- deterministic transform of the already-known `name` column — Turkish
-- letters folded to their plain-ASCII equivalent (İ/I/ı -> i, Ş/ş -> s,
-- Ç/ç -> c, Ğ/ğ -> g, Ö/ö -> o, Ü/ü -> u), lowercased, then everything that
-- is not [a-z0-9] is stripped. This must stay in exact lock-step with
-- normalizePersonName() in artifacts/api-server/src/lib/personnel-identity.ts
-- — see that file's tests for the authoritative behavior. It is not a
-- guess: "KADIR SAHIN", "KADIRSAHIN", and "Kadir Şahin" are defined to
-- normalize identically by design, which is what makes alias/exact
-- matching possible at all — it does NOT mean two rows with the same
-- normalized_name are the same person (see resources_type_check comment
-- in resources.ts and the identity-matching rules in
-- lib/personnel-identity.ts: identical normalized names never auto-merge).
UPDATE resources
SET normalized_name = regexp_replace(
  lower(translate(name, 'İIışŞçÇğĞöÖüÜ', 'iiissccggoouu')),
  '[^a-z0-9]', '', 'g'
)
WHERE normalized_name IS NULL;

ALTER TABLE resources
  ALTER COLUMN normalized_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS resources_normalized_name_idx ON resources (normalized_name);

-- ── resource_aliases ─────────────────────────────────────────────────────
--
-- Mirrors tour_product_aliases (migration 0012) as closely as the two
-- domains allow. Deliberately NOT unique on normalized_alias alone, or
-- even scoped to one resource: the same alias text is allowed to point at
-- more than one distinct resource_id, because that ambiguity must surface
-- to a human (see lib/personnel-identity.ts's AMBIGUOUS status), never be
-- silently resolved by whichever row happens to exist first.
CREATE TABLE IF NOT EXISTS resource_aliases (
  id SERIAL PRIMARY KEY,
  resource_id INTEGER NOT NULL
    REFERENCES resources(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_aliases_resource_source_alias_uidx
  ON resource_aliases (resource_id, source, alias);

CREATE INDEX IF NOT EXISTS resource_aliases_normalized_alias_idx ON resource_aliases (normalized_alias);
CREATE INDEX IF NOT EXISTS resource_aliases_resource_id_idx ON resource_aliases (resource_id);

-- Verification (read-only, safe to run after applying to staging):
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'resources'
--   AND column_name IN ('email','license_number','linked_profile_id','normalized_name');
-- -- Expect all four rows.
--
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'resource_aliases';
-- -- Expect one row.
--
-- SELECT count(*) FROM resources WHERE normalized_name IS NULL;
-- -- Expect 0.
--
-- SELECT count(*) FROM operations WHERE guide_resource_id IS NOT NULL OR driver_resource_id IS NOT NULL;
-- -- Expect the SAME count as before this migration — nothing here touches operations.
--
-- SELECT count(*) FROM resource_aliases;
-- -- Expect 0 immediately after apply; this migration inserts no rows.
