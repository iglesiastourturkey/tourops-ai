/**
 * Phase 2D.4B.1 — Real staging execution CLI.
 *
 * CODE + TESTS ONLY in this phase: this file is designed to be run from the
 * operator's own native Mac terminal against Neon STAGING, but no such run
 * happens as part of building it — this session cannot reach the staging
 * host at all (confirmed repeatedly: DNS failure, 403 from the egress
 * proxy on Neon's HTTP endpoint, raw TCP connect failure to 5432).
 *
 * Two modes, mutually exclusive, decided by lib/personnel-staging-cli-safety.ts:
 *   --preflight (default, and also explicit)  → strictly read-only. Never
 *     calls insertResource / insertAlias / recordAudit / runInTransaction's
 *     write path. Classifies every CREATE_NEW_RESOURCE proposal as
 *     WOULD_CREATE / WOULD_SKIP_ALREADY_EXECUTED / WOULD_SKIP_COLLISION_*.
 *   --apply  → requires --confirm-staging-write in addition. Without that
 *     flag, apply mode aborts before touching the database at all — see
 *     parseCliMode(). Runs executeApprovedStagingAction() (Phase 2D.4A,
 *     unchanged) against the real adapter for every CREATE_NEW_RESOURCE
 *     proposal in the plan.
 *
 * Safety layering before a single row may be written:
 *   1. parseCliMode()            — explicit mode + explicit confirmation flag.
 *   2. verifyPlanIntegrity()     — loaded plan's workbookSha256 /
 *                                  deterministicPackageSha256 match the
 *                                  authoritative approved values exactly.
 *   3. verifyPlanActionCounts()  — loaded plan's actual proposal counts
 *                                  (CREATE_NEW_RESOURCE/MATCH/DEFER/
 *                                  AMBIGUOUS/ESMA) match what was approved —
 *                                  independent of the plan's own summary.
 *   4. live workbook re-hash     — if --workbook is supplied, the file on
 *                                  disk is re-hashed and compared against
 *                                  both the plan and the authoritative
 *                                  expectation; a mismatch aborts.
 *   5. verifyStagingTargetSafety() — live `current_database()` + connection
 *                                  hostname positively identify staging;
 *                                  any production-like substring anywhere
 *                                  aborts unconditionally.
 *   6. executeApprovedStagingAction() (Phase 2D.4A, unchanged) — per-action
 *                                  workbook-drift + fingerprint + duplicate
 *                                  checks, all inside one transaction.
 *
 * Never prints DATABASE_URL. Only a redacted hostname/database-name summary
 * (describeDatabaseIdentitySafely, copied verbatim from the Phase 2D.4A
 * CLI's existing convention) ever reaches stdout.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeSha256 } from "./lib/personnel-import-parser";
import {
  executeApprovedStagingAction,
  type ApprovedStagingAction,
  type StagingApprovalPlan,
  type StagingExecutionResult,
} from "./lib/personnel-staging-execution-planner";
import {
  parseCliMode,
  verifyPlanIntegrity,
  verifyPlanActionCounts,
  countProposalsByAction,
  verifyStagingTargetSafety,
  PHASE_2D4B_AUTHORITATIVE_EXPECTATION,
  type DatabaseIdentityFacts,
} from "./lib/personnel-staging-cli-safety";

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

/** Never returns anything containing credentials — hostname/dbname only. Copied verbatim from personnel-master-staging-approval-plan.ts's existing convention. */
function describeDatabaseIdentitySafely(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    const dbName = u.pathname.replace(/^\//, "") || "(unknown)";
    return `host=${u.hostname} db=${dbName} neonHost=${u.hostname.endsWith(".neon.tech")}`;
  } catch {
    return "(unparseable DATABASE_URL — identity not confirmed)";
  }
}

type ActionOutcome =
  | { rawName: string; actionFingerprint: string; classification: "WOULD_CREATE" }
  | { rawName: string; actionFingerprint: string; classification: "WOULD_SKIP_ALREADY_EXECUTED" }
  | { rawName: string; actionFingerprint: string; classification: "WOULD_SKIP_COLLISION_NORMALIZED_NAME"; existingResourceId: number }
  | { rawName: string; actionFingerprint: string; classification: "WOULD_SKIP_COLLISION_ALIAS"; existingResourceId: number }
  | { rawName: string; actionFingerprint: string; classification: "EXECUTED"; resourceId: number }
  | { rawName: string; actionFingerprint: string; classification: "SKIPPED_ALREADY_EXECUTED" }
  | { rawName: string; actionFingerprint: string; classification: "SKIPPED_COLLISION"; existingResourceId: number }
  | { rawName: string; actionFingerprint: string; classification: "REFUSED"; reason: string };

export async function runPersonnelStagingApply(args: string[] = process.argv.slice(2)) {
  const cliMode = parseCliMode(args);
  if (cliMode.mode === "invalid") {
    const result = { mode: "personnel-staging-apply", status: "ABORTED_INVALID_MODE", reason: cliMode.reason, databaseWrites: false };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return result;
  }
  if (cliMode.mode === "apply" && !cliMode.confirmed) {
    const result = {
      mode: "personnel-staging-apply",
      status: "ABORTED_MISSING_CONFIRMATION",
      reason: "--apply requires --confirm-staging-write. Refusing to write without it.",
      databaseWrites: false,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return result;
  }

  const planArg = option(args, "--plan") ?? "/tmp/phase2d4-personnel-staging-approval-plan.json";
  const plan: StagingApprovalPlan = JSON.parse(await readFile(resolve(planArg), "utf8"));

  const expectation = PHASE_2D4B_AUTHORITATIVE_EXPECTATION;

  const integrity = verifyPlanIntegrity(plan, {
    expectedWorkbookSha256: expectation.workbookSha256,
    expectedDeterministicPackageSha256: expectation.deterministicPackageSha256,
  });
  if (!integrity.valid) {
    const result = { mode: "personnel-staging-apply", status: "ABORTED_PLAN_INTEGRITY", reason: integrity.reason, databaseWrites: false };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return result;
  }

  const actualCounts = countProposalsByAction(plan.proposals);
  const countsCheck = verifyPlanActionCounts(actualCounts, expectation.planActionCounts);
  if (!countsCheck.matches) {
    const result = { mode: "personnel-staging-apply", status: "ABORTED_PLAN_CLASSIFICATION_MISMATCH", reason: countsCheck.reason, databaseWrites: false };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return result;
  }

  const workbookArg = option(args, "--workbook");
  if (workbookArg) {
    const fileBuffer = await readFile(resolve(workbookArg));
    const currentWorkbookSha256 = computeSha256(fileBuffer);
    if (currentWorkbookSha256 !== expectation.workbookSha256 || currentWorkbookSha256 !== plan.workbookSha256) {
      const result = {
        mode: "personnel-staging-apply",
        status: "ABORTED_STALE_WORKBOOK",
        reason: `Live workbook SHA-256 (${currentWorkbookSha256}) does not match the approved workbook (${expectation.workbookSha256}) and/or the loaded plan's workbookSha256 (${plan.workbookSha256}).`,
        databaseWrites: false,
      };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return result;
    }
  }

  if (!process.env.DATABASE_URL) {
    const result = {
      mode: "personnel-staging-apply",
      status: "ABORTED_NO_DATABASE_URL",
      reason: "DATABASE_URL is not set. This CLI never fabricates or defaults a connection target.",
      databaseWrites: false,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return result;
  }
  const targetIdentitySummary = describeDatabaseIdentitySafely(process.env.DATABASE_URL);

  // Imported lazily, and only after every pure/offline check above has
  // passed, so this file remains importable and its pure logic testable
  // with zero database dependency at module-load time (@workspace/db's own
  // module throws at import if DATABASE_URL is unset, and opens a real pg
  // Pool as a side effect of being imported at all).
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  const { createDbStagingExecutionAdapter } = await import("./lib/personnel-staging-db-adapter");

  const identityRow = await db.execute(sql`SELECT current_database() AS database_name, inet_server_addr() AS server_addr`);
  const facts: DatabaseIdentityFacts = {
    databaseName: String(identityRow.rows[0]?.database_name ?? ""),
    hostname: new URL(process.env.DATABASE_URL).hostname,
  };
  const targetSafety = verifyStagingTargetSafety(facts);
  if (!targetSafety.safe) {
    const result = {
      mode: "personnel-staging-apply",
      status: "ABORTED_TARGET_SAFETY",
      reason: targetSafety.reason,
      targetIdentitySummary,
      databaseWrites: false,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return result;
  }

  const approvedBy = option(args, "--approved-by") ?? "unknown-operator";
  const approvedAt = new Date().toISOString();
  const actorProfileIdArg = option(args, "--actor-profile-id");
  const actorProfileId = actorProfileIdArg ? Number(actorProfileIdArg) : undefined;

  const createProposals = plan.proposals.filter(p => p.proposedAction === "CREATE_NEW_RESOURCE");
  const approvedActions: ApprovedStagingAction[] = createProposals.map(p => ({ ...p, approvedBy, approvedAt }));

  const outcomes: ActionOutcome[] = [];

  if (cliMode.mode === "preflight") {
    // Read-only classification. Uses the same adapter's read-only methods
    // directly (never runInTransaction, never insertResource/insertAlias/
    // recordAudit) so a --preflight run can never write, by construction —
    // not merely by convention.
    const readOnlyAdapter = createDbStagingExecutionAdapter(actorProfileId);
    for (const action of approvedActions) {
      const alreadyExecuted = await readOnlyAdapter.hasExecutedActionFingerprint(action.actionFingerprint);
      if (alreadyExecuted) {
        outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "WOULD_SKIP_ALREADY_EXECUTED" });
        continue;
      }
      const existingByName = await readOnlyAdapter.findResourceIdByNormalizedName(action.normalizedName, "GUIDE");
      if (existingByName != null) {
        outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "WOULD_SKIP_COLLISION_NORMALIZED_NAME", existingResourceId: existingByName });
        continue;
      }
      const existingByAlias = await readOnlyAdapter.findResourceIdByNormalizedAlias(action.normalizedName);
      if (existingByAlias != null) {
        outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "WOULD_SKIP_COLLISION_ALIAS", existingResourceId: existingByAlias });
        continue;
      }
      outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "WOULD_CREATE" });
    }
  } else {
    // --apply, confirmed. Delegates all write-path decisions to the
    // unchanged Phase 2D.4A orchestration function.
    const writeAdapter = createDbStagingExecutionAdapter(actorProfileId);
    for (const action of approvedActions) {
      const outcome: StagingExecutionResult = await executeApprovedStagingAction(action, plan.workbookSha256, writeAdapter);
      switch (outcome.status) {
        case "EXECUTED":
          outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "EXECUTED", resourceId: outcome.resourceId });
          break;
        case "SKIPPED_ALREADY_EXECUTED":
          outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "SKIPPED_ALREADY_EXECUTED" });
          break;
        case "SKIPPED_DUPLICATE_NORMALIZED_NAME":
        case "SKIPPED_DUPLICATE_ALIAS":
          outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "SKIPPED_COLLISION", existingResourceId: outcome.existingResourceId });
          break;
        case "REFUSED_STALE_PLAN":
          outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "REFUSED", reason: outcome.reason });
          break;
        case "REFUSED_FINGERPRINT_MISMATCH":
          outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "REFUSED", reason: `Fingerprint mismatch: expected ${outcome.expected}, recomputed ${outcome.recomputed}` });
          break;
        case "REFUSED_ACTION_NOT_EXECUTABLE":
          outcomes.push({ rawName: action.rawName, actionFingerprint: action.actionFingerprint, classification: "REFUSED", reason: `Action not executable: ${outcome.proposedAction}` });
          break;
      }
    }
  }

  const summaryCounts = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.classification] = (acc[o.classification] ?? 0) + 1;
    return acc;
  }, {});

  const hasRefusalsOrCollisions = outcomes.some(o =>
    o.classification === "REFUSED" || o.classification === "SKIPPED_COLLISION" || o.classification === "WOULD_SKIP_COLLISION_NORMALIZED_NAME" || o.classification === "WOULD_SKIP_COLLISION_ALIAS",
  );

  const result = {
    mode: "personnel-staging-apply",
    cliMode: cliMode.mode,
    status: "COMPLETED",
    databaseWrites: cliMode.mode === "apply",
    targetIdentitySummary,
    planPath: resolve(planArg),
    workbookSha256: plan.workbookSha256,
    deterministicPackageSha256: plan.deterministicPackageSha256,
    approvedActionCount: approvedActions.length,
    summaryCounts,
    outcomes,
  };

  console.log(JSON.stringify(result, null, 2));
  if (hasRefusalsOrCollisions) {
    process.exitCode = 1;
  }
  return result;
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  runPersonnelStagingApply().catch(error => {
    console.error("Staging apply failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
