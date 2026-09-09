# Phase 2D.4A: Personnel Master Data Staging Execution Foundation

## Status

**Planning / approval-package generation only. No database writes exist anywhere in this phase.** This phase builds a deterministic execution/approval planner that turns Phase 2D.3's discovery/matching output into a reviewable, machine-checkable staging approval plan. It does not execute any staging or production write. Execution is explicitly reserved for a future, separately-approved Phase 2D.4B.

## Scope

- `artifacts/api-server/src/lib/personnel-staging-execution-planner.ts` — the planner (pure functions, zero DB access) plus the `StagingExecutionAdapter` interface and `executeApprovedStagingAction` orchestration logic that a future 2D.4B implementation would wire to a real database.
- `artifacts/api-server/src/personnel-master-staging-approval-plan.ts` — CLI that runs the Phase 2D.3 discovery/import pipeline against the real workbook, optionally reads already-fetched staging `resources`/`resource_aliases` rows (via `--db` or `--resources-json`), and writes a deterministic JSON approval package. Contains no write code path.
- `artifacts/api-server/src/personnel-staging-execution-planner-self-test.ts` — 19 pure unit-test suites against an in-memory fake adapter (`makeFakeAdapter()`), covering every classification bucket, fingerprinting, idempotency, and transaction rollback.
- `scripts/personnel-master-staging-execution-phase2d4-focused-tests.mjs` — static source-safety assertions (no DB writes, no raw SQL, no `@workspace/db` import in the planner/CLI, no secret printing) plus a run of the self-test suite.
- `artifacts/api-server/package.json` — adds the `personnel:staging-approval-plan` script.

## Planner design

`buildStagingApprovalPlan(importPlan, options)` translates each Phase 2D.3 import-plan candidate into exactly one `StagingActionProposal`, carrying: `sourceWorkbookSha256`, `sourceSheetName`, `rawName`, `normalizedName`, `businessRole`, `proposedAction`, `proposedResourceType`, `existingResourceId` (if applicable), `reason`, `reviewStatus`, and an `actionFingerprint`.

Bucket → action mapping (fixed, not configurable per-run):

| Phase 2D.3 bucket | Staging action | Notes |
|---|---|---|
| `CLEAN_GUIDE_CANDIDATE`, unmatched | `CREATE_NEW_RESOURCE` (type `GUIDE`) | Name preserved exactly as the raw source identity; normalization reuses the existing Phase 2D.1 `normalizePersonName`. |
| Exact/alias match against supplied staging resources | `MATCH_EXISTING_RESOURCE` | Still only a *proposal* — no write occurs even for a clean exact match. |
| `GUIDE_NAME_DISPLAY_REVIEW` | `DEFER` | Always deferred, even when a match exists — a human decides the canonical display name first. |
| `NON_GUIDE_PERSONNEL` (TAYLAN, business role `ACCOUNTING_PERSONNEL`) | `DEFER` | `resources.type` supports GUIDE/DRIVER only — TAYLAN can never become a resource. |
| `REVIEW_UNKNOWN_CODE_OR_IDENTITY` (FF) | `DEFER` | Never `CREATE_NEW_RESOURCE`; requires human identification first. |
| `REVIEW_TRUE_IDENTITY_AMBIGUITY` | `DEFER` | Ambiguity is never auto-resolved. |
| ESMA (row-evidence-only, `OPERATIONS_PERSONNEL`) | *(no proposal generated)* | ESMA never appears as a worksheet/candidate and never produces a resource action of any kind. |

`ADD_ALIAS` and `REJECT` are never produced algorithmically. They can only originate from an explicit, caller-supplied list — `humanSuppliedAliasApprovals` (an opt-in `HumanSuppliedAliasApproval[]`) and `humanRejectedActionFingerprints` respectively. Same-workbook substring/fuzzy similarity (e.g. GOKBORA / ERMAN GOKBORA, NAZMICAN / NAZMI TARAKCI) is surfaced only as a `sameWorkbookSimilarityNotes` field with `basis: "INFORMATIONAL_SUGGESTION"` on the affected proposals — it never changes `proposedAction`, and no name pair is ever auto-merged.

## Action fingerprinting

```
computeActionFingerprint = sha256([
  sourceWorkbookSha256,
  sourceSheetName,
  rawName,
  normalizedName,
  proposedAction,
  proposedResourceType ?? "",
].join("::"))
```

Deliberately excludes any generated timestamp. Re-running the planner against the same workbook and inputs always produces the same fingerprint for the same logical action; changing the workbook (a different SHA-256) changes every fingerprint derived from it. `validatePlanAgainstCurrentWorkbook(plan, currentWorkbookSha256)` lets a future executor refuse a stale plan outright before touching the database.

## Execution mechanism (interface only — reserved for Phase 2D.4B)

`StagingExecutionAdapter` is the seam a future, explicitly-approved implementation would provide, backed by `@workspace/db`:

- `findResourceIdByNormalizedName`, `findResourceIdByNormalizedAlias`, `hasExecutedActionFingerprint` — the three duplicate-check primitives an execution must run before any write, so re-running an approved plan can never create duplicates.
- `insertResource`, `insertAlias` — the only write primitives; `insertAlias` is only ever invoked for an explicitly human-approved `ADD_ALIAS`.
- `recordAudit` — writes a `StagingExecutionAuditEntry` (`actor`, `action`, `resourceId`, `sourceWorkbookSha256`, `sourceSheetName`, `rawName`, `normalizedName`, `approvedAction`, `actionFingerprint`, `timestamp`). Designed to be backed by the *existing* `createAuditLog` in `lib/audit.ts`, run in its strict mode (an explicit `tx` executor, so an audit failure rolls back the whole action) — no second audit system is introduced.
- `runInTransaction(fn)` — the action-level transaction boundary. `executeApprovedStagingAction` runs validation → duplicate checks → resource write → alias write (if approved) → audit write inside one `runInTransaction` call per approved action, and rolls back entirely on any failure. Action-level transactions were chosen over one giant transaction so that one bad row in a large approved batch cannot block every other independent action.

`executeApprovedStagingAction` (the orchestration logic) is fully written and unit-tested against an in-memory fake adapter (`personnel-staging-execution-planner-self-test.ts`, 19/19 suites passing) — including a rollback test that deliberately fails inside `recordAudit` and asserts every prior write in that action is undone. No adapter implementation backed by a real database exists anywhere in this phase; wiring `StagingExecutionAdapter` to `@workspace/db` is explicitly reserved for Phase 2D.4B.

## Known environment limitations encountered while validating this phase

1. **Staging database read-only preflight could not be executed.** This sandbox's network egress deliberately blocks the staging Neon Postgres host — confirmed via DNS resolution failure for the host, a working HTTPS request to a different allowed host (`api.github.com`, 200), and finally an explicit `403 Forbidden` returned by the network proxy itself for both the raw Postgres port and Neon's HTTP-based `/sql` endpoint. This is an org-level egress allowlist decision, not a transient error, and no attempt was made to route around it. As a direct consequence, the approval plan generated for this report was built with `stagingSourceDescription: "NONE_SUPPLIED"` — zero existing resources/aliases were fed into the matcher, so every proposal in this specific run is a fresh classification with no `MATCH_EXISTING_RESOURCE` results. If staging already has resources when this planner is next run with real `--db` access (or a `--resources-json` snapshot), matching results take precedence over the counts in this report, exactly as specified.
2. **A full 9-workspace `pnpm install` (needed for the two frontend workspaces this phase does not touch, `tourops-ai` and `mockup-sandbox`) could not complete inside this session** — repeated attempts consistently stalled during the final node_modules linking step when writing through the device-file bridge to the user's Mac, independent of network access. This is a device-bridge file-I/O throughput limit, not a code defect: a `pnpm install --frozen-lockfile` scoped to exactly the workspaces this phase modifies (`@workspace/api-server`, `@workspace/scripts`, and their `lib/db`/`lib/api-zod` dependencies) completed cleanly in under a minute, and typecheck/build/tests all passed against it. The unrelated `mockup-sandbox` workspace also has a separate, pre-existing quirk on this machine's architecture (a missing optional `@rollup/rollup-linux-arm64-gnu` native binary on a from-scratch install, despite `pnpm-workspace.yaml` already carrying an override that excludes that exact package) — this is unrelated to any file this phase touches and was not fixed, since doing so would mean modifying dependency/lockfile state outside Phase 2D.4A's approved file list.
