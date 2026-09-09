/**
 * Real @workspace/db-backed implementation of the Phase 2D.4A
 * `StagingExecutionAdapter` interface (personnel-staging-execution-planner.ts).
 *
 * Phase 2D.4B.1 — CODE + TESTS ONLY. No connection to any database was made
 * or is required to build or test this file. `executeApprovedStagingAction()`
 * itself (the orchestration logic — idempotency checks, duplicate checks,
 * fingerprint re-verification, transaction boundaries) is UNCHANGED from
 * Phase 2D.4A and remains fully unit-tested against an in-memory fake
 * adapter (personnel-staging-execution-planner-self-test.ts). This file is
 * the only thing that changes: it swaps that fake for real drizzle queries,
 * built to match — line for line — the already-reviewed, already-merged
 * transactional write patterns this codebase uses everywhere else a
 * `resources` / `resource_aliases` row is created (routes/resources.ts,
 * lib/historical-customer-link.ts): `db.transaction(async (tx) => ...)`,
 * `createAuditLog(params, tx)` in strict mode, and a dedicated
 * `pg_advisory_xact_lock` key.
 *
 * Idempotency basis (per the operator's explicit Phase 2D.4B.1 spec —
 * "use the deterministic action fingerprint plus canonical identity
 * evidence... do NOT rely only on normalized_name... do NOT create a
 * global unique normalized_name constraint"):
 *
 *   1. PRIMARY — hasExecutedActionFingerprint(): queries `audit_logs` for a
 *      prior row with eventType = PHASE_2D4B_AUDIT_EVENT_TYPE whose
 *      `metadata->>'actionFingerprint'` matches exactly. A hit means this
 *      exact approved action already ran to completion — genuinely safe to
 *      report as an idempotent no-op (executeApprovedStagingAction returns
 *      SKIPPED_ALREADY_EXECUTED, no new row is ever written).
 *
 *   2. SECONDARY (collision guard, never silently reused) —
 *      findResourceIdByNormalizedName() / findResourceIdByNormalizedAlias():
 *      plain lookups against `resources.normalized_name` /
 *      `resource_aliases.normalized_alias`. A hit here WITHOUT a matching
 *      audit fingerprint is a *different*, unverified resource — two
 *      distinct real people can share one normalized form (see the
 *      comment on resources.normalizedName), so this is deliberately never
 *      treated as proof of "already applied." executeApprovedStagingAction
 *      already returns SKIPPED_DUPLICATE_NORMALIZED_NAME /
 *      SKIPPED_DUPLICATE_ALIAS for this case rather than writing anything —
 *      the CLI surfaces that as a hard stop requiring human review, never
 *      as a silent success. Fuzzy/substring similarity
 *      (sameWorkbookSimilarityNotes) is never part of either check.
 *
 * Locking: a single dedicated advisory key, pg_advisory_xact_lock(2026, 9),
 * is taken at the very start of every action's transaction — the next
 * unused key after (2026, 3)..(2026, 8), already claimed elsewhere in this
 * codebase (historical-migration-stage.ts, historical-migration-promote.ts,
 * historical-pickup-time-correction.ts, historical-source-evidence-
 * loader.ts, lib/historical-customer-link.ts, routes/field.ts — grep
 * pg_advisory_xact_lock to confirm before ever reusing a key). This
 * serializes concurrent staging-apply runs so two processes can never race
 * past the duplicate-check into two inserts for the same identity. Row-
 * level `FOR UPDATE` locking is deliberately not layered on top: the rows
 * being protected against (a not-yet-inserted resource with a given
 * normalized_name) do not exist yet, so there is nothing to lock — the
 * advisory lock serializing the whole check-then-insert critical section
 * is the actual defense here, matching how lib/historical-customer-link.ts
 * combines both techniques only where a *pre-existing* row needs FOR UPDATE.
 */
import { db, resourcesTable, resourceAliasesTable, auditLogsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { createAuditLog } from "./audit";
import type { StagingExecutionAdapter, StagingExecutionAuditEntry } from "./personnel-staging-execution-planner";

/** Next unused pg_advisory_xact_lock key after (2026, 3)..(2026, 8). */
export const PHASE_2D4B_ADVISORY_LOCK_KEY = 9;

/** Dedicated event type — this is the ledger hasExecutedActionFingerprint() reads. Never reused for anything else. */
export const PHASE_2D4B_AUDIT_EVENT_TYPE = "personnel_staging_resource_created";

/** Recorded in every audit row's metadata so a Phase 2D.4B write is always distinguishable from any other personnel write path. */
export const PHASE_2D4B_SOURCE_MARKER = "phase2d4b_staging_apply";

type Executor = Pick<typeof db, "select" | "insert" | "execute">;

function buildAdapter(executor: Executor, actorProfileId: number | undefined): StagingExecutionAdapter {
  return {
    async findResourceIdByNormalizedName(normalizedName, type) {
      const [row] = await executor
        .select({ id: resourcesTable.id })
        .from(resourcesTable)
        .where(and(eq(resourcesTable.normalizedName, normalizedName), eq(resourcesTable.type, type)))
        .limit(1);
      return row?.id ?? null;
    },

    async findResourceIdByNormalizedAlias(normalizedAlias) {
      const [row] = await executor
        .select({ resourceId: resourceAliasesTable.resourceId })
        .from(resourceAliasesTable)
        .where(eq(resourceAliasesTable.normalizedAlias, normalizedAlias))
        .limit(1);
      return row?.resourceId ?? null;
    },

    async hasExecutedActionFingerprint(actionFingerprint) {
      const [row] = await executor
        .select({ id: auditLogsTable.id })
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.eventType, PHASE_2D4B_AUDIT_EVENT_TYPE),
            sql`${auditLogsTable.metadata} ->> 'actionFingerprint' = ${actionFingerprint}`,
          ),
        )
        .limit(1);
      return row != null;
    },

    async insertResource(data) {
      const [inserted] = await executor
        .insert(resourcesTable)
        .values({
          type: data.type,
          name: data.name,
          normalizedName: data.normalizedName,
          active: data.active,
        })
        .returning({ id: resourcesTable.id });
      return { id: inserted.id };
    },

    async insertAlias(data) {
      const [inserted] = await executor
        .insert(resourceAliasesTable)
        .values({
          resourceId: data.resourceId,
          source: data.source,
          alias: data.alias,
          normalizedAlias: data.normalizedAlias,
        })
        .returning({ id: resourceAliasesTable.id });
      return { id: inserted.id };
    },

    async recordAudit(entry: StagingExecutionAuditEntry) {
      // Strict mode: passing `executor` (the open tx, never the bare
      // module-level `db`) makes createAuditLog throw on failure instead
      // of swallowing it — see lib/audit.ts's `strict` branch. A thrown
      // error here rolls back everything else this transaction did (the
      // resource/alias insert above), which is exactly "do not create a
      // resource without its corresponding audit event."
      await createAuditLog(
        {
          eventType: PHASE_2D4B_AUDIT_EVENT_TYPE,
          actorProfileId,
          module: "personnel_staging_execution",
          entityType: "resource",
          entityId: entry.resourceId ?? undefined,
          metadata: {
            phase2d4bSource: PHASE_2D4B_SOURCE_MARKER,
            actor: entry.actor,
            action: entry.action,
            approvedAction: entry.approvedAction,
            sourceWorkbookSha256: entry.sourceWorkbookSha256,
            sourceSheetName: entry.sourceSheetName,
            rawName: entry.rawName,
            normalizedName: entry.normalizedName,
            actionFingerprint: entry.actionFingerprint,
            approvedAt: entry.timestamp,
          },
          description: `Phase 2D.4B staging apply: ${entry.approvedAction} for "${entry.rawName}"`,
        },
        executor,
      );
    },

    async runInTransaction(fn) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(2026, ${PHASE_2D4B_ADVISORY_LOCK_KEY})`);
        return fn(buildAdapter(tx, actorProfileId));
      });
    },
  };
}

/**
 * Construct the real, @workspace/db-backed StagingExecutionAdapter.
 * `actorProfileId` is optional because this CLI is designed to run from a
 * native terminal with no authenticated TourPilot login — the human
 * operator's identity is still recorded, just in metadata.actor
 * (ApprovedStagingAction.approvedBy) rather than as a profiles.id.
 */
export function createDbStagingExecutionAdapter(actorProfileId?: number): StagingExecutionAdapter {
  return buildAdapter(db, actorProfileId);
}
