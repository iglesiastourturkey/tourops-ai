# Phase 2D.1: Guide / Personnel Identity Foundation

Status: **additive schema (unapplied migration) + new read/write API on the
`resources` table + a pure, deterministic identity-matching utility. No
application write-path was changed, no existing endpoint's request/response
contract changed, no data was migrated or backfilled, and no code path
outside `resources`/`resource_aliases`/`profiles` (read-only, for linkage
validation) was touched.** This document is the controlling reference for
Phase 2D.1. It records the current (pre-2C) assignment reality as verified
against the live repository, the canonical end state this phase lays the
foundation for, and exactly what is deferred to Phase 2C and to the
historical performance import.

This phase implements the `RESOURCE_PERSONNEL_IDENTITY_REVIEW` and
`GUIDE_ASSIGNMENT_PRECEDENCE` findings of
[`canonical-data-dictionary-v1-final.md`](./canonical-data-dictionary-v1-final.md)
(Option A: `resources` becomes the canonical Personnel identity, not a
parallel entity). Nothing in that document's locked invariants changed as a
result of building this phase — repository behavior matched the
architecture document's Option A recommendation.

## Current assignment reality (verified against the live repository)

Two independent facts, both confirmed by reading the actual code rather than
inferring from schema comments (the pre-existing `resources.ts` docstring
was stale and has been corrected as part of this phase):

1. **`sheet-import.ts`** (the Excel import path) already resolves
   `guideResourceId` / `driverResourceId` / `vehicleId` via an
   exact, case-insensitive name/plate match against `resources` /
   `vehicles`, in addition to unconditionally writing the legacy
   `guideName` / `driverName` / `vehiclePlate` text fields. This match is
   Faz-1-scoped exact-match only; the code's own comment says fuzzy
   matching is a later phase — which is exactly what this phase's
   identity-matching service (`personnel-identity.ts`) provides, as a
   standalone utility, not yet wired into `sheet-import.ts`.
2. **`routes/field.ts`'s `PATCH /operations/:id/assignments`** — the only
   live manual-assignment endpoint — reads and writes *only*
   `guideName`, `guidePhone`, `assignedGuideUserId`, `driverName`,
   `driverPhone`, `vehiclePlate`. It never reads or writes
   `guideResourceId` / `driverResourceId` / `vehicleId`. Guide
   double-booking conflicts are checked via `assignedGuideUserId`; vehicle
   conflicts via `vehiclePlate` text.

Precedence, as it actually exists today (not as originally assumed in the
v1 draft, which is why Check 1/Check 2 in the FINAL dictionary overturned
the draft's assumption):

| Field pair | Populated by | Authoritative today |
| --- | --- | --- |
| `guideName` / `driverName` / `vehiclePlate` (text) | Both import and manual assignment | **Yes — most consistently populated, current source of truth** |
| `assignedGuideUserId` | Manual assignment only | Access/login identity + conflict-check key for manual assignment |
| `guideResourceId` / `driverResourceId` / `vehicleId` (FK) | Import only (exact match) | **Not yet authoritative** — never read by the manual assignment endpoint or (per Phase 1C's read model) exposed as the primary display name; a resolved-but-silent FK today |

This is unchanged by Phase 2D.1. Nothing in this phase makes the FK
authoritative — that rewire of the manual assignment endpoint is explicitly
Phase 2C's job (see "What remains for Phase 2C" below).

`operations.pickupTime` remains the sole pickup-time field (Check 1's
conclusion): the historical source data and current schema only ever
carried one pickup time per operation, and `reservation-record-write.ts`
already documents, in its own words, why duplicating it onto
`BookingParty` would create two sources of truth for one physical time.
Phase 2D.1 does not touch pickup time at all; it is out of scope for a
personnel-identity phase and remains a deferred decision pending a real
multi-stop-pickup business requirement.

## Canonical end state (what this phase is the foundation for)

`resources` becomes the single canonical identity for operational personnel
(currently `GUIDE` and `DRIVER`; office personnel are explicitly out of
scope for this phase — the `type` CHECK constraint was deliberately left
unwidened). A Resource:

- **Is not a login.** `linked_profile_id` is optional. A guide can be
  assigned to operations and appear in every list/detail view with zero
  login account. Disabling or deleting a Profile never deletes or disables
  the Resource it was linked to (`ON DELETE SET NULL`); disabling a
  Resource never touches its linked Profile.
- **Is not defined by any login.** Where a link exists, the Profile is a
  pointer *from* the Resource, not the Resource's definition. Business
  identity (name, phone, license, aliases, assignment history) lives on
  `resources` / `resource_aliases`, never on `profiles`.
- **Has a deterministic normalized name** (`normalized_name`), computed by
  `normalizePersonName()` in `personnel-identity.ts`, folding the Turkish
  characters İ/I/ı, Ş/ş, Ç/ç, Ğ/ğ, Ö/ö, Ü/ü and stripping punctuation/spaces
  before lower-casing. This column is **deliberately not unique** — two
  distinct people can share a normalized name (this is exactly the
  AMBIGUOUS case the matching service exists to surface for human review,
  not to silently collapse).
- **Can carry aliases** — alternate spellings/name forms seen in different
  source systems (the 2026 sheet import, the historical
  PERFORMANS RAPORU workbook once that import is built, manual entry,
  legacy operation text) — in `resource_aliases`, each alias scoped to a
  controlled `source` vocabulary, never fuzzy-generated, never
  auto-approved.

## Resource identity model (schema)

`resources` (additive columns only — `id`, `type`, `name`, `phone`,
`languages`, `company`, `active`, `notes`, `created_at`, `updated_at` are
all unchanged):

| Column | Type | Notes |
| --- | --- | --- |
| `normalized_name` | `text not null` | Backfilled once for existing rows by the migration's `UPDATE`, then maintained by the API on every create/rename. Indexed, not unique. |
| `email` | `text`, nullable | Business contact email — distinct from any Profile email. |
| `license_number` | `text`, nullable | Guide license number; free text, no format enforced (not evidenced in the source data). |
| `linked_profile_id` | `integer references profiles(id) on delete set null`, nullable | Zero-or-one login. Unique index enforces one Resource per Profile (a Profile cannot be double-linked). |

`type` remains `CHECK (type IN ('GUIDE', 'DRIVER'))` — unwidened, per
explicit instruction. Adding `OFFICE` or similar is a future, separate
decision once office-personnel requirements exist.

`resource_aliases` (new table, mirrors the existing `tour_product_aliases`
pattern exactly):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `serial primary key` | |
| `resource_id` | `integer not null references resources(id) on delete cascade` | Alias rows die with their Resource. |
| `source` | `text not null` | Controlled vocabulary: `SHEET_IMPORT`, `PERFORMANCE_2026`, `MANUAL`, `LEGACY_OPERATION` (enforced at the API/zod layer, not a DB CHECK, matching the `tour_product_aliases` convention). |
| `alias` | `text not null` | Raw alias text as seen in the source, preserved verbatim. |
| `normalized_alias` | `text not null` | Same normalization function as `resources.normalized_name`. Indexed, not unique — the same alias text may legitimately need to point at more than one Resource, which is exactly the AMBIGUOUS case. |
| `created_at` | `timestamptz not null default now()` | |

Unique on `(resource_id, source, alias)` only — prevents the same exact
alias being recorded twice for the same resource from the same source, but
never prevents two different resources from sharing an alias.

## Identity matching behavior

`personnel-identity.ts` is a pure, DB-free module (no imports beyond
plain TS) — it takes already-fetched candidate resources/aliases and a raw
name string and returns exactly one of:

- **EXACT_MATCH** — the normalized input matches exactly one resource's
  `normalized_name`.
- **ALIAS_MATCH** — no name match, but exactly one resource's alias set
  contains the normalized input.
- **AMBIGUOUS** — more than one resource matches (by name, by alias, or a
  mix of both) — every candidate is returned with `via: "name" | "alias"`
  for a human reviewer to disambiguate. This is the deliberate behavior for
  the "KADIRSAHIN" / "KADIR SAHIN" / "Kadir Şahin" class of case: all three
  raw forms normalize identically, so if two *different* real people
  happened to share that normalized form, the service surfaces AMBIGUOUS
  rather than guessing.
- **UNMATCHED** — no exact or alias match. Optional fuzzy suggestion
  metadata (Levenshtein-based `similarityRatio`, threshold 0.6, max 3
  suggestions) may be attached, but a fuzzy suggestion **never** produces
  MATCHED, ALIAS_MATCH, or an automatic Resource creation — it is metadata
  only, for a future human-review UI to display as "did you mean...".

No code path anywhere in this phase creates a Resource, creates an alias,
or links a Profile automatically as a side effect of matching. The service
is exported from `personnel-read.ts` as `matchResourceIdentityByName()` (an
orchestration wrapper that fetches candidates then calls the pure matcher)
but is **not** mounted as an HTTP route — it exists for a future import
pipeline (sheet import's fuzzy phase, or the historical performance import)
to call directly, once that pipeline's human-review UI exists.

## Profile linkage model

`linked_profile_id` is nullable and independently settable via
`PATCH /resources/:id` (`linkedProfileId: number | null | undefined` —
`undefined` leaves it untouched, `null` explicitly unlinks, a number sets
it after validating the Profile exists and is not already linked to a
different Resource, returning 409 with `conflictingResourceId` on
conflict). A Resource with no linked Profile is a fully valid, assignable
Resource — the API never requires or infers a link.

## Current assignment compatibility

Nothing in `operations`, `sheet-import.ts`, or
`routes/field.ts` was modified by this phase. Every existing
`guideName` / `guidePhone` / `driverName` / `driverPhone` / `vehiclePlate`
/ `assignedGuideUserId` / `guideResourceId` / `driverResourceId` /
`vehicleId` read and write path behaves exactly as it did before this
phase — verified by a static regression-guard assertion (in
`scripts/personnel-identity-phase2d1-focused-tests.mjs`) that the
`routes/field.ts` assignments-endpoint destructure block is byte-for-byte
unchanged and does not reference the FK columns.

## What remains for Phase 2C

- Rewiring `PATCH /operations/:id/assignments` to resolve/write
  `guideResourceId` / `driverResourceId` / `vehicleId` as the
  authoritative assignment, with `guideName`/`driverName`/`vehiclePlate`
  demoted to a denormalized snapshot/provenance copy (per the target
  precedence: canonical FK = authoritative identity/assignment; legacy
  text = provenance/snapshot; login id = access identity only).
  This was explicitly deferred — Phase 2D.1 only builds the identity
  table the rewire will point at.
- Wiring `personnel-identity.ts`'s matching service into `sheet-import.ts`
  to replace or augment its current exact-match-only resolution, with a
  human-review surface for AMBIGUOUS/UNMATCHED rows.
- Any UI for browsing/editing personnel (this phase is API-only, per the
  explicit Phase 2D.1 scope boundary — no frontend changes were made).
- A decision on whether/how to widen `resources.type` for office
  personnel, once a real requirement exists.

## What remains for the historical performance import

- Importing `PERFORMANS RAPORU-2026.xlsx` at all (still not started).
- Using `resource_aliases` with `source = 'PERFORMANCE_2026'` to record the
  name spellings seen in that workbook against existing canonical
  Resources — via human-reviewed AMBIGUOUS/UNMATCHED resolution, never
  automatic.
- Any performance-metric computation, attendance tracking, or operation
  matching (all explicitly out of scope for 2D.1).

## Why fuzzy matching never auto-merges

Two real people can normalize to the same string (shared name), and one
real person's name can appear in enough varied forms across two source
systems (accents, initials, transliteration) that a fuzzy-similarity
threshold cannot distinguish "same person, different spelling" from
"different person, similar name" without a human looking at both. Given the
migration's stated invariant — no automatic guide creation, no automatic
alias approval, no automatic person merge — the matching service is built
so that the *only* way an AMBIGUOUS or UNMATCHED result becomes a
confirmed identity is a human explicitly recording an alias or creating a
Resource through the API, both of which are audit-logged.

## Migration

`lib/db/migrations/0025_resource_identity_foundation.sql` is additive only
(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX/UNIQUE INDEX IF NOT EXISTS`), backfills `normalized_name` for
any pre-existing rows via the same character-folding rule as
`normalizePersonName()` (verified byte-for-byte consistent by test), and is
explicitly documented as **NOT APPLIED**. It contains no `DROP`, no
destructive rename, and does not touch `operations` or `profiles` beyond
the new nullable, `ON DELETE SET NULL` foreign key.
