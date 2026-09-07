import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Phase 3E.4A — review readiness signal focused tests (updated for 3E.4B).
//
// Static-source assertions in the style of the 3E.2/3E.3 focused tests plus a
// runtime check of the pure readiness helper (DB-free module, no connection).
//
// Pre-3E.4B this file pinned "no HTTP approval endpoint". Phase 3E.4B
// authorizes exactly one handoff (POST /:sourceKey/approve + one detail-page
// panel); the assertions below pin that exact surface and nothing more.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(root, rel), 'utf8');

const readiness = read('artifacts/api-server/src/lib/historical-remediation-review-readiness.ts');
const readService = read('artifacts/api-server/src/lib/historical-remediation-read.ts');
const route = read('artifacts/api-server/src/routes/historical-remediation.ts');
const approval = read('artifacts/api-server/src/lib/historical-migration-approval.ts');
const queuePage = read('artifacts/tourops-ai/src/pages/historical-remediation.tsx');
const detailPage = read('artifacts/tourops-ai/src/pages/historical-remediation-detail.tsx');
const panel = read('artifacts/tourops-ai/src/components/historical-remediation/remediation-panel.tsx');
const schema = read('lib/db/src/schema/historical_operation_imports.ts');

let count = 0;
const check = (condition, message) => { assert.ok(condition, message); count += 1; };
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// --- A. blocking warning set -------------------------------------------------
check(readiness.includes('HISTORICAL_REMEDIATION_BLOCKING_WARNINGS'), 'A: explicit blocking set is exported');
for (const warning of ['missing_pickup_time', 'missing_language', 'missing_pickup_point', 'missing_adult_count', 'missing_operator']) {
  check(readiness.includes(`"${warning}"`), `A: blocking set contains ${warning}`);
}
check(!readiness.includes('"missing_agency"') || readiness.includes('RESIDUAL'), 'A: residuals are not blocking (only referenced as residual universe)');

// --- B/C/D. runtime derivation (pure helper, no DB) --------------------------
const tsx = path.join(root, 'artifacts/api-server/node_modules/.bin/tsx');
const runtime = spawnSync(tsx, ['--eval', `
import assert from "node:assert/strict";
import {
  HISTORICAL_REMEDIATION_BLOCKING_WARNINGS,
  blockingWarningsOf,
  deriveHistoricalReviewReadiness,
  isHistoricalRemediationBlockingWarning,
} from ${JSON.stringify(path.join(root, 'artifacts/api-server/src/lib/historical-remediation-review-readiness.ts'))};
assert.deepEqual([...HISTORICAL_REMEDIATION_BLOCKING_WARNINGS],
  ["missing_pickup_time", "missing_language", "missing_pickup_point", "missing_adult_count", "missing_operator"]);
// allowed residuals may remain and still be READY
assert.equal(deriveHistoricalReviewReadiness("pending", ["missing_agency", "missing_child_count"]), "READY_FOR_REVIEW");
assert.equal(deriveHistoricalReviewReadiness("pending", ["missing_agency"]), "READY_FOR_REVIEW");
assert.equal(deriveHistoricalReviewReadiness("pending", []), "READY_FOR_REVIEW");
// every blocking warning alone keeps the row UNRESOLVED
for (const warning of HISTORICAL_REMEDIATION_BLOCKING_WARNINGS) {
  assert.equal(deriveHistoricalReviewReadiness("pending", [warning]), "UNRESOLVED", warning);
  assert.ok(isHistoricalRemediationBlockingWarning(warning), warning);
}
assert.equal(deriveHistoricalReviewReadiness("pending", ["missing_operator", "missing_child_count"]), "UNRESOLVED");
assert.deepEqual(blockingWarningsOf(["missing_operator", "missing_child_count"]), ["missing_operator"]);
// unknown warnings fail closed, never READY
assert.equal(deriveHistoricalReviewReadiness("pending", ["missing_something_else"]), "UNRESOLVED");
// imported/approved/rejected are never READY_FOR_REVIEW
for (const status of ["imported", "approved", "rejected"]) {
  assert.equal(deriveHistoricalReviewReadiness(status, []), "UNRESOLVED", status);
  assert.equal(deriveHistoricalReviewReadiness(status, ["missing_agency"]), "UNRESOLVED", status);
}
// legacy 3E.1 self-test contract still holds through the rewired projection
assert.equal(deriveHistoricalReviewReadiness("pending", ["missing_agency", "missing_child_count"]), "READY_FOR_REVIEW");
console.log("review readiness runtime checks passed");
`], { cwd: root, encoding: 'utf8' });
assert.equal(runtime.status, 0, runtime.stderr || runtime.stdout);
count += 1;

// --- E. read model wiring ----------------------------------------------------
check(readService.includes('deriveHistoricalReviewReadiness'), 'E: read model derives through the status-aware helper');
check(readService.includes('export function deriveHistoricalRemediationState'), 'E: legacy projection export is preserved');
check(readService.includes('eq(historicalOperationImportsTable.status, "pending")'), 'E: list/detail reads stay pending-only');
check(!codeOf(readService).includes('db.transaction') && !codeOf(readService).includes('.for("update")'),
  'E: read model performs no writes or row locks');

// --- F. approval endpoint: 3E.4B handoff ---------------------------------------
// Pre-3E.4B this section pinned "no HTTP approval endpoint". Phase 3E.4B
// authorizes exactly one: POST /:sourceKey/approve reusing the approval
// service with caller version/hash + readiness enforcement. No other approval
// surface may exist.
check(route.includes('approveHistoricalImport({') && !route.includes('rejectHistoricalImport'),
  'F: remediation router calls the approval service exactly once (the 3E.4B handoff), no reject path');
check((route.match(/router\.post\(/g) ?? []).length === 2 && route.includes('router.post("/:sourceKey/remediate"') && route.includes('router.post("/:sourceKey/approve"'),
  'F: remediation router exposes exactly remediate + approve POSTs');
check(!/router\.(put|patch|delete)\(/.test(route), 'F: no PUT/PATCH/DELETE added');
check(approval.includes('expectedVersion?: number;') && approval.includes('requireReadyForReview?: boolean;'),
  'F: approval service accepts caller version/hash + readiness as opt-in guards (CLI callers unaffected)');

// --- G. permission behavior --------------------------------------------------
check(route.includes('requirePermission("historical_migration", "review")'), 'G: list/detail still require review only');
check(route.includes('requirePermission("historical_migration", "remediate")'), 'G: remediate still requires remediate');
check((codeOf(route).match(/requirePermission\("historical_migration", "approve"\)/g) ?? []).length === 1,
  'G: remediation router grants exactly one approve surface (the 3E.4B handoff)');
check(!codeOf(queuePage).includes('usePermission') && !codeOf(detailPage).includes('usePermission'),
  'G: queue/detail add no permission hook — indicators are read-scoped, approval control untouched');

// --- H. indicators + the single 3E.4B handoff wiring ---------------------------
check(queuePage.includes('İncelemeye Hazır'), 'H: queue shows the ready indicator');
check(detailPage.includes('İncelemeye Hazır'), 'H: detail shows the ready indicator');
check(queuePage.includes('Çözülmedi') && detailPage.includes('Çözülmedi'), 'H: unresolved state with warning count is shown');
for (const cta of ['Onayla', 'approveHistoricalImport', 'historicalRemediationApi.approve', '/approve']) {
  check(!codeOf(queuePage).includes(cta), `H: no approval CTA surface ("${cta}") on the queue list`);
}
check((detailPage.match(/HistoricalApprovalHandoffPanel/g) ?? []).length === 2,
  'H: detail wires the 3E.4B handoff panel exactly once (import + render), nothing else added');
check(!codeOf(panel).includes('/approve') && !panel.includes('approveHistoricalImport'),
  'H: remediation panel gained no approval call (3E.3 single-field mutation untouched)');

// --- I. forbidden surfaces ---------------------------------------------------
for (const src of [codeOf(readiness), codeOf(readService), codeOf(queuePage), codeOf(detailPage)]) {
  for (const forbidden of ['promote', 'Promote', 'bulk', 'Bulk', 'autofill', 'Autofill', 'canonical', 'suggestion']) {
    check(!src.includes(forbidden), `I: no "${forbidden}" surface`);
  }
}
check(!codeOf(readiness).includes('evidence') && !codeOf(readiness).includes('db'),
  'I: readiness helper touches no evidence and no DB');
check(!/useMutation/.test(codeOf(queuePage)) && !/useMutation/.test(codeOf(detailPage)),
  'I: queue/detail add no mutation — 409/success-refetch behavior needs no new path (no new writer exists)');

// --- J. VIATOR / residual regressions ----------------------------------------
check(!/VIATOR/i.test(codeOf(readiness)) && !/\bType\b/.test(codeOf(readiness)),
  'J: readiness never reinterprets the source Type column / VIATOR');
check(!/VIATOR/i.test(codeOf(queuePage)) && !/VIATOR/i.test(codeOf(detailPage)),
  'J: indicators never reinterpret the source Type column / VIATOR');

// --- K. no DB lifecycle state ------------------------------------------------
check(!schema.includes('READY_FOR_REVIEW') && !schema.includes('UNRESOLVED'),
  'K: derived states are not persisted in the schema');
check(schema.includes(`status IN ('pending', 'approved', 'rejected', 'imported')`) || schema.includes("'pending', 'approved', 'rejected', 'imported'"),
  'K: status enum/state machine untouched');
const migrations = readdirSync(path.join(root, 'lib/db/migrations'));
check(!migrations.some(name => /^002[5-9]|^00[3-9]\d/.test(name)) && existsSync(path.join(root, 'lib/db/migrations/0024_historical_source_evidence.sql')),
  'K: no migration added (0024 remains the latest)');

console.log(`historical remediation review handoff (phase 3E.4) focused tests: ${count} assertions passed`);
