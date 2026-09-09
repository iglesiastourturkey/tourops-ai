import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function read(relPath) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

const adapterSource = read("../artifacts/api-server/src/lib/personnel-staging-db-adapter.ts");
const cliSafetySource = read("../artifacts/api-server/src/lib/personnel-staging-cli-safety.ts");
const cliSource = read("../artifacts/api-server/src/personnel-staging-apply.ts");
const apiPkgSource = read("../artifacts/api-server/package.json");
const plannerSource = read("../artifacts/api-server/src/lib/personnel-staging-execution-planner.ts");

let assertions = 0;
function check(condition, msg) {
  assert.ok(condition, msg);
  assertions += 1;
}

// ─── 1. The adapter never writes outside a transaction ────────────────────

check(
  /runInTransaction/.test(adapterSource) && /db\.transaction\(/.test(adapterSource),
  "the real adapter must implement runInTransaction using db.transaction()",
);
check(
  !/\bpool\.query\(/.test(adapterSource),
  "the adapter must never issue a raw pool.query — all access goes through drizzle's query builder / db.transaction",
);
check(
  /pg_advisory_xact_lock\(2026,/.test(adapterSource),
  "the adapter must take a dedicated advisory lock at the start of every transaction, matching the codebase's existing (2026, N) convention",
);
check(
  !/pg_advisory_xact_lock\(2026,\s*[3-8]\)/.test(adapterSource),
  "the adapter must claim a NEW advisory lock key, never reuse one of the already-claimed keys (2026, 3)..(2026, 8)",
);

// ─── 2. Audit reuses existing infrastructure, never a parallel system ──────

check(
  /import\s*\{[^}]*createAuditLog[^}]*\}\s*from\s*["']\.\/audit["']/.test(adapterSource),
  "the adapter must reuse the existing createAuditLog from lib/audit.ts, never define a parallel audit writer",
);
check(
  /recordAudit[\s\S]{0,700}createAuditLog\(/.test(adapterSource),
  "recordAudit must call createAuditLog",
);
check(
  (() => {
    const start = adapterSource.indexOf("async recordAudit");
    const end = adapterSource.indexOf("async runInTransaction", start);
    if (start === -1 || end === -1) return false;
    const body = adapterSource.slice(start, end);
    // createAuditLog's call must close with `executor` as its second
    // argument (never the bare `db`), which is what makes a failure here
    // roll back the whole transaction (strict mode) instead of being
    // silently swallowed — see lib/audit.ts's `strict` branch.
    return /createAuditLog\(/.test(body) && /\},\s*executor,?\s*\);/.test(body) && !/\},\s*db,?\s*\);/.test(body);
  })(),
  "recordAudit must pass the open transaction executor (not the bare module-level db) into createAuditLog, so an audit failure rolls back the whole transaction (strict mode)",
);
check(
  !/createAuditLog\(\s*\{[^}]*\}\s*\)\s*;/.test(adapterSource.replace(/\/\/.*$/gm, "")),
  "createAuditLog must never be called with only one argument in this adapter (that would silently fall back to best-effort/non-strict mode against the bare db)",
);

// ─── 3. Idempotency basis matches the operator's explicit spec ────────────

check(
  /hasExecutedActionFingerprint[\s\S]{0,700}metadata['"]?\s*->>\s*'actionFingerprint'/.test(adapterSource),
  "hasExecutedActionFingerprint must query audit_logs.metadata->>'actionFingerprint', not normalized_name",
);
check(
  (() => {
    // Strip comments first so the docblock's own description of what NOT
    // to do (which necessarily contains these words) can never trip this.
    const codeOnly = adapterSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    return !/CREATE\s+UNIQUE\s+INDEX[\s\S]{0,80}normalized_name/i.test(codeOnly) && !/\.unique\(\)[\s\S]{0,80}normalizedName/.test(codeOnly);
  })(),
  "the adapter must never introduce a global unique constraint on normalized_name in actual code (comments describing the constraint NOT to add are fine)",
);
check(
  /findResourceIdByNormalizedName[\s\S]{0,300}resourcesTable/.test(adapterSource) &&
    /findResourceIdByNormalizedAlias[\s\S]{0,300}resourceAliasesTable/.test(adapterSource),
  "the adapter must implement both duplicate-check primitives against the real resources/resource_aliases tables",
);

// ─── 4. CLI safety layer: default must never write ─────────────────────────

check(
  /export function parseCliMode/.test(cliSafetySource),
  "personnel-staging-cli-safety.ts must export parseCliMode",
);
check(
  /hasApply\s*\)\s*\{\s*return\s*\{\s*mode:\s*["']apply["'],\s*confirmed:\s*args\.includes\(["']--confirm-staging-write["']\)/.test(cliSafetySource.replace(/\s+/g, " ")),
  "apply mode confirmation must come only from an explicit --confirm-staging-write flag",
);
check(
  /return\s*\{\s*mode:\s*["']preflight["']\s*\}\s*;\s*\}\s*$/m.test(cliSafetySource) || /return \{ mode: "preflight" \};/.test(cliSafetySource),
  "parseCliMode's fallthrough (no flags, or unrecognized flags) must resolve to read-only preflight, never apply",
);

// ─── 5. CLI wiring: apply requires confirmation before any write path runs ─

check(
  /cliMode\.mode === ["']apply["']\s*&&\s*!cliMode\.confirmed/.test(cliSource),
  "the CLI must explicitly check for apply+unconfirmed and abort before reaching any database code",
);
check(
  (() => {
    const abortIdx = cliSource.indexOf("ABORTED_MISSING_CONFIRMATION");
    const dbImportIdx = cliSource.indexOf('await import("@workspace/db")');
    return abortIdx !== -1 && dbImportIdx !== -1 && abortIdx < dbImportIdx;
  })(),
  "the missing-confirmation abort must occur textually before the lazy @workspace/db import, confirming no DB module is even loaded on that path",
);
check(
  /await import\(["']@workspace\/db["']\)/.test(cliSource),
  "the CLI must import @workspace/db lazily (not as a top-level import), so pure/offline checks can run and abort before any DB dependency is touched",
);
check(
  !/^import\s.*["']@workspace\/db["']/m.test(cliSource),
  "the CLI must never statically/top-level import @workspace/db",
);

// ─── 6. Target safety: never trust a bare env var, never print secrets ────

check(
  /verifyStagingTargetSafety/.test(cliSource),
  "the CLI must call verifyStagingTargetSafety before any write path",
);
check(
  /current_database\(\)/.test(cliSource),
  "the CLI must positively verify identity via a live current_database() query, not just an environment variable name",
);
check(
  !/console\.log\([^)]*DATABASE_URL/.test(cliSource) && !/console\.error\([^)]*DATABASE_URL/.test(cliSource),
  "the CLI must never print DATABASE_URL",
);
check(
  /describeDatabaseIdentitySafely/.test(cliSource),
  "the CLI must use a redacted identity summary helper, matching the Phase 2D.4A CLI's existing convention",
);

// ─── 7. Plan/workbook staleness checks happen before any write ────────────

check(
  /verifyPlanIntegrity/.test(cliSource) && /verifyPlanActionCounts/.test(cliSource),
  "the CLI must verify both plan integrity (SHA-256s) and plan action-count classification before executing anything",
);
check(
  (() => {
    const integrityIdx = cliSource.indexOf("verifyPlanIntegrity(");
    const dbImportIdx = cliSource.indexOf('await import("@workspace/db")');
    return integrityIdx !== -1 && dbImportIdx !== -1 && integrityIdx < dbImportIdx;
  })(),
  "plan integrity must be verified before the database module is even imported",
);

// ─── 8. Preflight mode never reaches a write method ────────────────────────

check(
  (() => {
    const match = cliSource.match(/if \(cliMode\.mode === ["']preflight["']\) \{([\s\S]*?)\n  \} else \{/);
    if (!match) return false;
    // Strip comments first — this block's own explanatory comment
    // necessarily names the write methods it says it never calls.
    const codeOnly = match[1].replace(/\/\/.*$/gm, "");
    return !/\.insertResource\(|\.insertAlias\(|\.recordAudit\(|\.runInTransaction\(/.test(codeOnly);
  })(),
  "the --preflight code path must never call insertResource/insertAlias/recordAudit/runInTransaction — it is read-only by construction, not merely by convention",
);

// ─── 9. package.json exposes the two new CLI entry points ─────────────────

check(
  apiPkgSource.includes("personnel:staging-preflight") && apiPkgSource.includes("personnel:staging-apply"),
  "api-server package.json must expose both personnel:staging-preflight and personnel:staging-apply scripts",
);
check(
  /"personnel:staging-preflight":\s*"tsx src\/personnel-staging-apply\.ts --preflight"/.test(apiPkgSource),
  "the preflight script must hard-code --preflight so a bare pnpm run can never accidentally apply",
);

// ─── 10. Existing Phase 2D.4A orchestration logic is untouched ────────────

check(
  /export async function executeApprovedStagingAction/.test(plannerSource),
  "the pre-existing, already-tested orchestration function must still exist unchanged in this phase",
);
check(
  /executeApprovedStagingAction/.test(cliSource),
  "the CLI's apply path must call the existing executeApprovedStagingAction rather than reimplementing its duplicate/fingerprint logic",
);

// ─── 11. Run both pure TS self-test suites via tsx ─────────────────────────

const tsx = new URL("../artifacts/api-server/node_modules/.bin/tsx", import.meta.url).pathname;

const plannerSelfTest = new URL("../artifacts/api-server/src/personnel-staging-execution-planner-self-test.ts", import.meta.url).pathname;
const plannerResult = spawnSync(tsx, [plannerSelfTest], { encoding: "utf8" });
assert.equal(plannerResult.status, 0, plannerResult.stderr || plannerResult.stdout);
check(
  plannerResult.stdout.includes("23 suites passed"),
  "all 23 pure test suites (20 from Phase 2D.4A + 3 new in Phase 2D.4B.1) must pass in the planner self-test",
);

const cliSafetySelfTest = new URL("../artifacts/api-server/src/personnel-staging-cli-safety-self-test.ts", import.meta.url).pathname;
const cliSafetyResult = spawnSync(tsx, [cliSafetySelfTest], { encoding: "utf8" });
assert.equal(cliSafetyResult.status, 0, cliSafetyResult.stderr || cliSafetyResult.stdout);
check(
  /(\d+) suites passed/.test(cliSafetyResult.stdout),
  "the cli-safety self-test must report a suite count",
);

console.log(`personnel-staging-db-adapter-phase2d4b1: all ${assertions} focused safety assertions passed!`);
