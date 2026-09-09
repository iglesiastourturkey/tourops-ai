# Phase 2D.4B.1 — Personnel Staging: Real DB Adapter + CLI

## Status

CODE + TESTS ONLY. No connection to any database was made or is required to
build or test this phase. This phase does not execute any staging write —
that is Phase 2D.4B proper, gated on the human operator running this CLI
from their own native Mac terminal against Neon STAGING.

## Why this phase exists

Phase 2D.4A built and fully unit-tested the orchestration logic for
executing an approved staging action
(`executeApprovedStagingAction` in `personnel-staging-execution-planner.ts`)
against a `StagingExecutionAdapter` interface, but only ever exercised it
against an in-memory fake adapter. When the operator explicitly approved
the Phase 2D.4B staging write (merged PR #56, main SHA
`64f28502844fdc9eb5da6d0e18ef0468612cf0df`), the first real attempt to run
it (Gate 1 of that request) failed for two independent reasons:

1. This session's sandbox cannot reach the Neon staging host at all
   (confirmed via DNS failure, a 403 from the egress proxy on Neon's HTTP
   endpoint, and a raw TCP connect failure to port 5432 — a deliberate
   org-level egress policy, not transient).
2. No real, `@workspace/db`-backed implementation of
   `StagingExecutionAdapter` existed anywhere in the codebase — confirmed
   via `grep -rl "implements StagingExecutionAdapter\|StagingExecutionAdapter ="`.

This phase builds only the missing piece: the real adapter and a CLI to
drive it, so that a human operator with a working connection to staging can
run the actual apply. `executeApprovedStagingAction` itself — the
duplicate-check, fingerprint-verification, and transaction-boundary logic —
is **unchanged**.

## Files

- `artifacts/api-server/src/lib/personnel-staging-db-adapter.ts` — the real
  `@workspace/db`-backed `StagingExecutionAdapter` implementation.
- `artifacts/api-server/src/lib/personnel-staging-cli-safety.ts` — pure,
  DB-free safety logic used by the CLI (mode parsing, target-safety
  verification, plan-integrity verification, plan-classification
  verification). Zero `@workspace/db` import, unit-testable with no
  database or network.
- `artifacts/api-server/src/personnel-staging-apply.ts` — the CLI entry
  point (`--preflight` / `--apply --confirm-staging-write`).
- `artifacts/api-server/src/personnel-staging-cli-safety-self-test.ts` —
  pure unit tests for the safety module (19 suites).
- `artifacts/api-server/src/personnel-staging-execution-planner-self-test.ts`
  — 3 new suites added (21–23), bringing the total to 23: transaction
  rollback on a failing resource insert, refusal of a tampered
  post-approval action, and independence of the NAZMICAN / NAZMI TARAKCI /
  NAZIM BAHADIR identities.
- `scripts/personnel-staging-db-adapter-phase2d4b1-focused-tests.mjs` — new
  static-safety assertions for this phase (31 assertions).
- `scripts/personnel-master-staging-execution-phase2d4-focused-tests.mjs` —
  updated to expect 23 (not 20) suites from the planner self-test.
- `artifacts/api-server/package.json` — adds `personnel:staging-preflight`
  and `personnel:staging-apply` scripts.

## Idempotency strategy

Per the operator's explicit instruction, idempotency is based on the
deterministic action fingerprint plus canonical identity evidence — never
on `normalized_name` alone, and never via a global unique constraint on
`normalized_name`.

- **Primary**: `hasExecutedActionFingerprint()` queries `audit_logs` for a
  prior row with `eventType = "personnel_staging_resource_created"` whose
  `metadata->>'actionFingerprint'` matches exactly. A hit is a genuine
  no-op — this exact approved action already ran to completion
  (`SKIPPED_ALREADY_EXECUTED`), and the CLI reports it as
  `WOULD_SKIP_ALREADY_EXECUTED` / `SKIPPED_ALREADY_EXECUTED` rather than an
  error.
- **Secondary (collision guard, never silently reused)**:
  `findResourceIdByNormalizedName()` / `findResourceIdByNormalizedAlias()`
  are plain lookups against `resources.normalized_name` /
  `resource_aliases.normalized_alias`. A hit here *without* a matching
  audit fingerprint is a different, unverified resource — two distinct real
  people can share one normalized form — so this is never treated as proof
  of "already applied." It surfaces as
  `SKIPPED_DUPLICATE_NORMALIZED_NAME` / `SKIPPED_DUPLICATE_ALIAS`
  (`WOULD_SKIP_COLLISION_*` in preflight), which the CLI treats as a hard
  stop requiring human review (non-zero exit code), never a silent
  success. Fuzzy/substring similarity evidence
  (`sameWorkbookSimilarityNotes`) is never part of either check.

The audit ledger (`audit_logs.metadata`) is reused as the idempotency
ledger — no new table or migration was needed.

## Transaction strategy

Action-level transactions (per the operator's stated preference — one
transaction per approved action, not one giant transaction for the whole
apply run). Each transaction:

1. Takes `pg_advisory_xact_lock(2026, 9)` — the next unused key after the
   `(2026, 3)`..`(2026, 8)` keys already claimed elsewhere in this codebase
   (`historical-migration-stage.ts`, `historical-migration-promote.ts`,
   `historical-pickup-time-correction.ts`,
   `historical-source-evidence-loader.ts`, `lib/historical-customer-link.ts`,
   `routes/field.ts`). This serializes concurrent staging-apply runs so two
   processes can never race past the duplicate-check into two inserts for
   the same identity.
2. Re-checks fingerprint / normalized-name / alias state from inside the
   transaction (existing Phase 2D.4A logic, unchanged).
3. Inserts the resource, then the audit row, in that order.
4. Any thrown error (including a failing audit write) rolls the whole
   transaction back — a resource can never exist without its audit event.
   Verified in self-tests 19 (audit-failure rollback, pre-existing) and 21
   (resource-insert-failure rollback, new this phase).

Row-level `FOR UPDATE` locking is deliberately not layered on top: the row
being protected against does not exist yet, so there is nothing to lock —
the advisory lock serializing the whole check-then-insert critical section
is the actual defense.

## Target safety strategy

`verifyStagingTargetSafety()` never trusts a bare "is this staging"
environment variable or flag. It requires:

1. A live `SELECT current_database()` against the connection actually in
   use (proves connectivity, not just configuration).
2. The connection hostname (parsed from `DATABASE_URL`, never the full
   string).

Both are compared against an explicit expectation
(`neondb` / `*.neon.tech` by default). Independently of the positive
match, any occurrence of a production-like substring (`prod`,
`production`, `live`) anywhere in either fact aborts unconditionally —
belt-and-suspenders against ever touching anything that looks like
production, even if the positive check would otherwise pass. If staging
identity cannot be positively established, the CLI aborts before importing
`@workspace/db`'s write path is ever reached with a live connection.

## Audit strategy

Reuses the existing `createAuditLog()` (`lib/audit.ts`) exclusively — no
parallel audit system. `recordAudit()` always passes the open transaction
(`tx`, never the bare module-level `db`) as the executor, which puts
`createAuditLog` into its existing "strict" mode: a failure there throws
and rolls back the whole transaction, rather than being silently
swallowed (the pre-existing best-effort default for callers that pass no
executor). Every successful `CREATE_NEW_RESOURCE` records: action type,
resource id, source workbook SHA-256, source sheet/rawName,
normalizedName, action fingerprint, approving operator (`approvedBy`), and
a `phase2d4bSource: "phase2d4b_staging_apply"` marker distinguishing this
write path from any other personnel write path.

## CLI design

`personnel-staging-apply.ts` supports exactly two modes, decided by
`parseCliMode()` in the DB-free safety module:

- No flags, or explicit `--preflight` → read-only. Classifies every
  `CREATE_NEW_RESOURCE` proposal as `WOULD_CREATE` /
  `WOULD_SKIP_ALREADY_EXECUTED` / `WOULD_SKIP_COLLISION_NORMALIZED_NAME` /
  `WOULD_SKIP_COLLISION_ALIAS` using only the adapter's read-only methods —
  verified by a focused-test assertion that inspects the `--preflight`
  code path and confirms it never references `insertResource`,
  `insertAlias`, `recordAudit`, or `runInTransaction`.
- `--apply` → requires `--confirm-staging-write` in addition. Without it,
  the CLI aborts (`ABORTED_MISSING_CONFIRMATION`) before importing
  `@workspace/db` at all — verified by a focused-test assertion that the
  abort is textually positioned before the lazy DB import.

Before any database module is even imported, the CLI runs, in order:
plan-integrity verification (`workbookSha256` +
`deterministicPackageSha256` against the authoritative approved values),
plan-classification verification (independently recounted
`CREATE_NEW_RESOURCE` / `MATCH_EXISTING_RESOURCE` / `DEFER` / `AMBIGUOUS` /
ESMA-mention counts against what was approved — 81/0/5/0/0), and,
if `--workbook` is supplied, a live re-hash of the workbook file compared
against both the plan and the authoritative expectation. `@workspace/db`
is imported lazily, only once every one of those pure checks has passed,
so the CLI's offline logic is fully testable with zero database
dependency at module-load time.

`DATABASE_URL` is never printed; only a redacted `host=... db=...
neonHost=...` summary (the same `describeDatabaseIdentitySafely` helper
used by the Phase 2D.4A approval-plan CLI) ever reaches stdout.

## Identity safety

No change to any identity/classification rule from Phase 2D.3/2D.4A. The
new NAZMICAN / NAZMI TARAKCI / NAZIM BAHADIR self-test (suite 23) confirms
these three visually-similar but distinct raw names normalize to three
distinct `normalizedName` values and receive three independent
`CREATE_NEW_RESOURCE` proposals with distinct action fingerprints, with
zero ambiguities inferred — mirroring the pre-existing GOKBORA / ERMAN
GOKBORA test (suite 5). The pre-existing DEFER rules for TAYLAN, ESMA, FF,
and display-review names are untouched (still enforced entirely inside
`personnel-staging-execution-planner.ts`, which this phase does not
modify).

## Known limitation

The real adapter's SQL correctness (the actual `drizzle-orm` queries
against `resources` / `resource_aliases` / `audit_logs`) could not be
exercised against a live database in this turn — this sandbox cannot
reach the Neon staging host at all. Confidence comes from: (a) the queries
are built to match, field-for-field, the already-reviewed, already-merged
patterns this codebase uses elsewhere for the same tables
(`routes/resources.ts`, `lib/historical-customer-link.ts`); (b) a clean
`tsc --noEmit` typecheck of the whole adapter, CLI, and safety module
against the real `@workspace/db` schema types (not a mock) — this caught
one real bug (a field-name mismatch between
`PHASE_2D4B_AUTHORITATIVE_EXPECTATION`'s shape and
`verifyPlanIntegrity`'s parameter shape) before this doc was written; and
(c) the pre-existing, already-tested `executeApprovedStagingAction`
orchestration function — which this phase's adapter plugs into unchanged —
is exhaustively covered against an in-memory fake with the same interface
shape. The real adapter's live SQL will get its first genuine exercise
when the operator runs `--preflight` against actual staging.
