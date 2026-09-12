# Phase 3H.4B — Customer Identity & Projection Safety Foundation

Status: foundation implementation (uncommitted branch `codex/phase3h4b-customer-identity-foundation`).
No production execution, no customer writes, no migration applied in this phase.

## 1. Problem

Phase 3H.4A (`PHASE_3H4A_PLAN_PASS` / `FOUNDATION_REQUIRED`) proved that
production cannot safely create or link historical customers yet:

- `customers` has no normalized phone/email, no identity key, no version/CAS,
  no unique constraints, no source provenance.
- `reservations` has no version column, a non-unique `source_historical_key`,
  and no contact fields (only `leadGuestName`).
- Identity evidence in production is names-only; workbook phone/email is
  offline evidence that production cannot independently bind to a reservation.
- The only link path (`historical-customer-link.ts`) is staging-only and
  targets `operations.customer_id`, not `reservations.customer_id`.

## 2. Identity semantics (single source of truth)

`artifacts/api-server/src/lib/customer-identity.ts` owns normalization:

- email: trim + lowercase, strict shape check.
- phone: digits only, 7–15 digits, leading `+` preserved.
- `identityKey`: `email:<e>|phone:<p>` (both), `email:<e>` / `phone:<p>`
  (single), `NULL` (neither). **Names never participate. No fuzzy matching.**
- `identityEvidenceHash`: sha256 over canonical JSON binding source
  provenance + normalized identity + target reservation + action.

`lib/historical-customer-projection.ts` now delegates to this module;
all existing exports and behavior are unchanged (existing consumers and
tests keep passing).

## 3. Schema changes (authored, NOT applied)

Migration `lib/db/migrations/0028_customer_identity_foundation.sql`:

- `customers.normalized_phone / normalized_email / identity_key` — all
  NULL-able (existing customers legitimately lack identity).
- Partial unique index `customers_identity_key_active_unique` on
  `(identity_key) WHERE archived_at IS NULL AND identity_key IS NOT NULL`.
- `reservations.version integer NOT NULL DEFAULT 1` — CAS token mirroring
  the `operations.version` convention.

### Uniqueness rationale

Only `identity_key` is unique (not phone/email independently), because it is
the sole deterministic resolution unit — dual phone+email mismatch is a
CONFLICT, never two lanes that could disagree. Partial scope: archived
customers keep history without blocking identity reuse; NULL-identity
customers never collide. **Fail-closed**: `CREATE UNIQUE INDEX` raises on
pre-existing duplicates instead of merging; duplicates need explicit,
separately authorized remediation. No backfill runs here; existing rows keep
NULL normalized identity until the documented, idempotent backfill procedure
runs under its own authorization (see §9).

## 4. Provenance chain

workbook/file → worksheet → source row → `legacy:` sourceKey →
`historical_operation_imports` → canonical `operations` (unique key) →
`reservations` (`tourOperationId` + same key, `customerId NULL` by design).

The projection package (`lib/historical-customer-projection-package.ts`,
zod-validated, `databaseWrites: false`) carries per record: sourceKey,
historicalImportId, reservationId, operationId, sourceFileId, worksheetName,
sourceRow, normalized phone/email, identityKey, evidence hash, action
(REUSE/CREATE), expected reservation customer/version/name. Duplicate
sourceKeys/reservationIds are rejected; the identityKey and evidence hash
are re-derived and must match.

## 5. Transaction model (future 3H.4C, implemented but unexecuted)

`historical-customer-projection-production.ts` (production-only guard,
`MAX_APPLY_LIMIT = 25`, PLAN default / explicit APPLY):

- REUSE: advisory lock on reservation → revalidate → CAS link
  (`customer_id IS NULL AND version = expected`, bump version) → audits.
- CREATE: `pg_advisory_xact_lock(hashtext(identity_key))` → revalidate →
  lookup by identityKey (reuse on concurrent hit) → insert with normalized
  identity → CAS link → audits.

Review hardening (3H.4B review fix): PLAN and the transactional APPLY
re-check independently query ALL THREE lanes (`identity_key`,
`normalized_email`, `normalized_phone`) against active customers only, with
per-value multiplicity preserved (`pickLaneCandidate`: 0 none, 1 candidate,
>1 conflict — never a first-row pick). Archived customers never resolve.
The replay-safe decision table proves an existing link before accepting it:
ALREADY_LINKED requires the exact expected customer, version exactly
expected+1, agreeing lanes, no multiplicity, intact evidence/name — so a
faithful replay returns `existing` with zero writes while wrong-customer,
version-beyond-+1, lane/identity drift, and source mismatch all fail closed.

Guarantees: same projection twice → second is `existing`/reuse, one customer
total; concurrent runs → at most one customer per identityKey; one identity
across N reservations → one customer, N links.

## 6. RBAC

Dedicated admin-only permissions (seeded idempotently, never broad promote):

- `historical_migration.customer_projection_plan` (PLAN is read-only; the
  runner requires no permission for PLAN, consistent with sibling runners)
- `historical_migration.customer_link_projection` (every APPLY)
- `historical_migration.customer_create` (APPLY batches containing CREATE)

## 7. Audit

`historical_customer_created`, `historical_customer_reused`,
`historical_customer_linked` via `createAuditLog` in the same transaction.
Metadata carries sourceKey, import/reservation/operation/customer ids,
**identityKeyHash** (never raw phone/email), action, evidence hash, and
version transitions.

## 8. Idempotency

Pure decision table (`assessCustomerProjection`) shared by PLAN and the
transactional re-check: ALREADY_LINKED, SAFE_REUSE/CREATE, CONFLICT_*,
INVALID_*, NAME_ONLY, MISSING_IDENTITY, STALE_EVIDENCE (version/name/hash
drift), SOURCE_MISMATCH, MANUAL_REVIEW. Nothing uncertain becomes SAFE_*.
Covered by self-tests (no DB required); DB-backed concurrency proof is a
3H.4C staging prerequisite, not claimed here.

## 9. Backfill procedure (documented, NOT executed)

```sql
-- Idempotent, re-runnable; run only under explicit owner GO.
-- Values use the canonical TypeScript normalization (verify a sample first).
UPDATE customers
SET normalized_phone = <canonical>, normalized_email = <canonical>,
    identity_key = <canonical>, updated_at = now()
WHERE id = <id> AND (normalized_phone IS NULL OR normalized_email IS NULL);
-- Then confirm: zero duplicate active identity_keys before relying on the
-- partial unique index (it fails closed if any exist).
SELECT identity_key, count(*) FROM customers
WHERE archived_at IS NULL AND identity_key IS NOT NULL
GROUP BY 1 HAVING count(*) > 1;
```

## 10. Failure modes

Stale evidence/version, source mismatch, dual-customer conflict, archived
target, multi-name identity group, malformed provenance, permission denial,
advisory-lock contention (waits, never duplicates), unique-index violation
on unexpected duplicates — all fail closed with `conflict`/`blocked`, zero
partial writes (single transaction per record).

## 11. Rollout plan

- 3H.4C: single identity-group canary (REUSE-first preferred), replay proof.
- 3H.4D: small controlled batch (≤25–100).
- 3H.4E: larger rollout only after 3H.4D gates pass.
- Each needs its own owner GO; APPLY must never run without one.
