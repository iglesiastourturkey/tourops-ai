import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function read(relPath) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

const plannerSource = read("../artifacts/api-server/src/lib/personnel-staging-execution-planner.ts");
const cliSource = read("../artifacts/api-server/src/personnel-master-staging-approval-plan.ts");
const apiPkgSource = read("../artifacts/api-server/package.json");

let assertions = 0;
function check(condition, msg) {
  assert.ok(condition, msg);
  assertions += 1;
}

// ─── 1. Static safety & zero DB mutation guarantees ───────────────────────

check(
  !/\bdb\.(insert|update|delete)\b/.test(plannerSource),
  "personnel-staging-execution-planner.ts must not contain live DB write statements",
);
check(
  !/\bdb\.(insert|update|delete)\b/.test(cliSource),
  "personnel-master-staging-approval-plan.ts must not contain live DB write statements",
);
check(
  !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i.test(plannerSource),
  "planner must not contain raw SQL mutation statements",
);
// Only real import/require statements count — the design docblocks in this
// file legitimately *discuss* @workspace/db as the future 2D.4B seam target
// (see the module header and the "Execution mechanism" section comment), and
// those mentions must not trip a false positive.
const workspaceDbImportPattern = /(?:from\s+["']@workspace\/db["']|require\(\s*["']@workspace\/db["']\s*\))/;
check(
  !workspaceDbImportPattern.test(plannerSource),
  "the planner/executor module must stay DB-free — it works only through the StagingExecutionAdapter interface, never a concrete @workspace/db import (design-doc comments mentioning the future seam are fine)",
);
check(
  !workspaceDbImportPattern.test(cliSource),
  "the CLI must never import @workspace/db directly — reads go through lib/personnel-read.ts (fetchIdentityCandidates), exactly like the Phase 2D.3 dry-run CLI",
);

// ─── 2. Secret-safety: never print a connection string ────────────────────

check(
  /describeDatabaseIdentitySafely/.test(cliSource) && !/console\.log\(.*DATABASE_URL/.test(cliSource),
  "the CLI must never console.log a raw DATABASE_URL — only a redacted identity summary",
);
check(
  /u\.hostname/.test(cliSource) && !/u\.password/.test(cliSource) && !/u\.username/.test(cliSource),
  "the redacted identity summary must expose hostname/dbname only, never username or password",
);

// ─── 3. Action fingerprint design ──────────────────────────────────────────

check(
  /computeActionFingerprint/.test(plannerSource) && /createHash\("sha256"\)/.test(plannerSource),
  "action fingerprints must be a deterministic sha256 digest",
);
check(
  !/computeActionFingerprint[\s\S]{0,400}Date\.now|computeActionFingerprint[\s\S]{0,400}new Date\(/.test(plannerSource),
  "the action fingerprint must never depend on a generated timestamp",
);

// ─── 4. Hard business rules carried over from Phase 2D.3 ──────────────────

check(
  /NON_GUIDE_PERSONNEL[\s\S]{0,300}proposedAction:\s*"DEFER"/.test(plannerSource),
  "NON_GUIDE_PERSONNEL (TAYLAN/ESMA) must always DEFER, never produce a GUIDE action",
);
check(
  /REVIEW_UNKNOWN_CODE_OR_IDENTITY[\s\S]{0,300}proposedAction:\s*"DEFER"/.test(plannerSource),
  "REVIEW_UNKNOWN_CODE_OR_IDENTITY (FF) must always DEFER, never CREATE_NEW_RESOURCE",
);
check(
  /GUIDE_NAME_DISPLAY_REVIEW[\s\S]{0,400}proposedAction:\s*"DEFER"/.test(plannerSource),
  "GUIDE_NAME_DISPLAY_REVIEW must DEFER by default in Phase 2D.4A",
);
check(
  /REVIEW_TRUE_IDENTITY_AMBIGUITY[\s\S]{0,300}proposedAction:\s*"DEFER"/.test(plannerSource),
  "REVIEW_TRUE_IDENTITY_AMBIGUITY must always DEFER — never auto-merged",
);

// ─── 5. ADD_ALIAS / REJECT are opt-in-only, never algorithmic ─────────────

check(
  /HumanSuppliedAliasApproval/.test(plannerSource) && /humanSuppliedAliasApprovals/.test(plannerSource),
  "ADD_ALIAS may only ever originate from an explicit, caller-supplied human alias approval list",
);
check(
  /humanRejectedActionFingerprints/.test(plannerSource),
  "REJECT may only ever originate from an explicit, caller-supplied rejection list, never algorithmically",
);

// ─── 6. Idempotency / stale-plan design ────────────────────────────────────

check(
  /validatePlanAgainstCurrentWorkbook/.test(plannerSource),
  "a workbook-drift guard function must exist and be usable before any future execution",
);
check(
  /hasExecutedActionFingerprint/.test(plannerSource) && /findResourceIdByNormalizedName/.test(plannerSource) && /findResourceIdByNormalizedAlias/.test(plannerSource),
  "the execution adapter interface must expose all three duplicate-check primitives (fingerprint, normalized_name, alias)",
);

// ─── 7. Transaction design ──────────────────────────────────────────────────

check(
  /runInTransaction/.test(plannerSource),
  "the execution adapter interface must expose an action-level transaction boundary",
);
check(
  /StagingExecutionAdapter/.test(plannerSource) && !/\bpool\.query\(/.test(plannerSource),
  "the executor must operate only through the StagingExecutionAdapter seam, never a raw pool query",
);

// ─── 8. Audit design reuses existing infrastructure ────────────────────────

check(
  /StagingExecutionAuditEntry/.test(plannerSource) &&
    ["actor", "action", "resourceId", "sourceWorkbookSha256", "sourceSheetName", "rawName", "normalizedName", "approvedAction", "actionFingerprint", "timestamp"]
      .every(field => plannerSource.includes(field)),
  "every audit entry must carry all operator-specified fields",
);

// ─── 9. Run the pure TS self-test suite via tsx ────────────────────────────

const tsx = new URL("../artifacts/api-server/node_modules/.bin/tsx", import.meta.url).pathname;
const selfTest = new URL("../artifacts/api-server/src/personnel-staging-execution-planner-self-test.ts", import.meta.url).pathname;

const result = spawnSync(tsx, [selfTest], { encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || result.stdout);
check(
  result.stdout.includes("20 suites passed"),
  "all 20 pure test suites must pass in the planner self-test",
);
check(
  apiPkgSource.includes("personnel:staging-approval-plan"),
  "api-server package.json must expose a CLI script for the staging approval plan generator",
);

// ─── 10. Deterministic-package digest is separated from wall-clock metadata ─
// (added after the operator flagged that createdAt inside the persisted
// plan would otherwise make the whole file's own SHA-256 nondeterministic
// across regenerations of an identical plan.)

check(
  /computeDeterministicPackageDigest/.test(plannerSource) && /deterministicPackageSha256/.test(plannerSource),
  "a deterministic-package digest, excluding createdAt, must exist and be embedded in StagingApprovalPlan",
);
check(
  !/computeDeterministicPackageDigest[\s\S]{0,600}Date\.now|computeDeterministicPackageDigest[\s\S]{0,600}new Date\(/.test(plannerSource),
  "the deterministic-package digest must never itself depend on a generated timestamp",
);
check(
  /deterministicPackageSha256/.test(cliSource),
  "the CLI must surface deterministicPackageSha256 in its output alongside the whole-file outputSha256",
);
check(
  /const fileContent = `\$\{JSON\.stringify\(stagingPlan, null, 2\)\}\\n`;[\s\S]{0,200}writeFile\(resolve\(outputArg\), fileContent[\s\S]{0,200}computeSha256\(fileContent\)/.test(cliSource),
  "outputSha256 must be computed over the exact same string that gets written to disk — a mismatched serialization (e.g. hashing compact JSON while writing pretty-printed JSON) would make the reported hash disagree with `shasum` on the real file",
);

console.log(`personnel-master-staging-execution-phase2d4: all ${assertions} focused safety assertions passed!`);
