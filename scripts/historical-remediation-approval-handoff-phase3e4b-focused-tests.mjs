import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Phase 3E.4B — controlled approval handoff focused tests.
//
// Static-source assertions in the 3E.2/3E.3/3E.4A style plus runtime checks of
// the exported approve body schema (DB-free parse; route import runs under a
// dummy DATABASE_URL like the 3E.2 route test). No live DB is touched —
// transaction/audit ordering is pinned by source-order assertions, the same
// technique as scripts/historical-remediation-mutation-focused-tests.mjs.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(root, rel), 'utf8');

const route = read('artifacts/api-server/src/routes/historical-remediation.ts');
const service = read('artifacts/api-server/src/lib/historical-migration-approval.ts');
const api = read('artifacts/tourops-ai/src/lib/historical-remediation-api.ts');
const handoff = read('artifacts/tourops-ai/src/components/historical-remediation/approval-handoff-panel.tsx');
const detailPage = read('artifacts/tourops-ai/src/pages/historical-remediation-detail.tsx');
const queuePage = read('artifacts/tourops-ai/src/pages/historical-remediation.tsx');
const schema = read('lib/db/src/schema/historical_operation_imports.ts');

let count = 0;
const check = (condition, message) => { assert.ok(condition, message); count += 1; };
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const routeCode = codeOf(route);
const serviceCode = codeOf(service);
const handoffCode = codeOf(handoff);

// --- A. route contract -------------------------------------------------------
check(route.includes('router.post("/:sourceKey/approve"'), 'A: exactly one approve POST under the remediation area');
check((route.match(/router\.post\("\/:sourceKey\/approve"/g) ?? []).length === 1, 'A: single approve route, no duplicates');
check(route.includes('requirePermission("historical_migration", "approve")'), 'A: approve endpoint requires the approve permission');
check(route.includes('export const approvalBodySchema'), 'A: approve body schema is exported for testing');
check(route.includes('approveHistoricalImport({'), 'A: route reuses the existing approval service (no second implementation)');
check(route.includes('requireReadyForReview: true'), 'A: HTTP path always enforces review readiness');
check(route.includes('actorProfileId: res.locals.profile.id'), 'A: actor comes from the session, never the body');
check(!routeCode.includes('router.post("/:sourceKey/reject"') && !routeCode.includes('/promote'),
  'A: no reject/promote endpoint in this phase');
check((route.match(/router\.post\(/g) ?? []).length === 2, 'A: router exposes exactly remediate + approve POSTs');
check(!/router\.(put|patch|delete)\(/.test(route), 'A: no PUT/PATCH/DELETE');

// --- B. body schema: exactly version + hash, nothing else --------------------
const tsx = path.join(root, 'artifacts/api-server/node_modules/.bin/tsx');
const bodyRuntime = spawnSync(tsx, ['--eval', `
import assert from "node:assert/strict";
import { approvalBodySchema } from ${JSON.stringify(path.join(root, 'artifacts/api-server/src/routes/historical-remediation.ts'))};
const good = { expectedVersion: 3, expectedPayloadHash: "b".repeat(64) };
assert.equal(approvalBodySchema.safeParse(good).success, true, "valid body parses");
assert.equal(approvalBodySchema.safeParse({ expectedVersion: 3 }).success, false, "missing hash rejected");
assert.equal(approvalBodySchema.safeParse({ expectedPayloadHash: "b".repeat(64) }).success, false, "missing version rejected");
assert.equal(approvalBodySchema.safeParse({ ...good, field: "pickupTime", value: "x" }).success, false, "correction field/value rejected");
assert.equal(approvalBodySchema.safeParse({ ...good, expectedVersion: 0 }).success, false, "non-positive version rejected");
assert.equal(approvalBodySchema.safeParse({ ...good, expectedPayloadHash: "ZZZ" }).success, false, "non-sha hash rejected");
console.log("approve body schema checks passed");
`], { cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused' } });
assert.equal(bodyRuntime.status, 0, bodyRuntime.stderr || bodyRuntime.stdout);
count += 1;

// --- C. HTTP status mapping, no stack traces ---------------------------------
check(route.includes('res.status(400).json({ error: "Invalid historical approval request"'), 'C: malformed body → 400');
check(route.includes('res.status(404).json({ error: result.message, code: result.code })'), 'C: missing source key → 404');
check(route.includes('res.status(403).json({ error: result.message, code: result.code })'), 'C: operator/permission failures → 403');
check(route.includes('res.status(409).json({ error: result.message, code: result.code })'), 'C: stale/concurrent/not-ready → 409');
check(route.includes('res.status(500).json({ error: "Historical approval failed" })'), 'C: internal failure → 500 without a stack trace');
check(!routeCode.includes('error.stack') && !routeCode.includes('.stack'), 'C: no stack traces leak to the client');

// --- D. service: opt-in guards, CLI behavior preserved -----------------------
check(service.includes('expectedVersion?: number;'), 'D: expectedVersion is opt-in');
check(service.includes('expectedPayloadHash?: string;'), 'D: expectedPayloadHash is opt-in');
check(service.includes('requireReadyForReview?: boolean;'), 'D: readiness gate is opt-in');
check(serviceCode.includes('payloadHash !== row.payloadSha256'), 'D: stored payload integrity is recomputed');
check(serviceCode.includes("deriveHistoricalReviewReadiness(row.status, warnings)"), 'D: readiness is derived from the locked row');
check(serviceCode.includes('SELECT ... FOR UPDATE') || serviceCode.includes('.for("update")'), 'D: exact row is locked');
check(serviceCode.includes('eq(historicalOperationImportsTable.approvalVersion, row.approvalVersion)'), 'D: CAS on approvalVersion in the UPDATE');
check(serviceCode.includes('approvalVersion: sql'), 'D: version increments per existing approval semantics');

// --- E. transaction / integrity order ----------------------------------------
const lockAt = serviceCode.indexOf('.for("update")');
const notFoundAt = serviceCode.indexOf('"Staging kaydi bulunamadi"');
const transitionAt = serviceCode.indexOf('historicalImportTransitionBlock("approve"');
const integrityAt = serviceCode.indexOf('Stored historical payload hash integrity check failed');
const versionAt = serviceCode.indexOf('params.expectedVersion !== undefined');
const hashAt = serviceCode.indexOf('params.expectedPayloadHash !== undefined');
const readinessAt = serviceCode.indexOf('params.requireReadyForReview');
const updateAt = serviceCode.indexOf('approvedByOperatorId: params.actorProfileId');
const auditAt = serviceCode.indexOf('eventType: "historical_migration_approved"');
for (const [name, idx] of Object.entries({ lockAt, notFoundAt, transitionAt, integrityAt, versionAt, hashAt, readinessAt, updateAt, auditAt })) {
  check(idx !== -1, `E: ${name} exists in the approval transaction`);
}
check(lockAt < notFoundAt && notFoundAt < transitionAt, 'E: lock → exists → pending state check');
check(transitionAt < integrityAt, 'E: pending check precedes integrity proof');
check(integrityAt < versionAt && versionAt < hashAt && hashAt < readinessAt, 'E: corrupt stored hash fails before any caller expectation; version → hash → readiness');
check(readinessAt < updateAt && updateAt < auditAt, 'E: guards → mutation → same-transaction audit');
check(serviceCode.includes('return db.transaction'), 'E: approval stays atomic');
check(serviceCode.includes('}, tx);'), 'E: audit uses the open transaction (rollback on audit failure)');

// --- F. audit semantics ------------------------------------------------------
check(serviceCode.includes('eventType: "historical_migration_approved"'), 'F: authoritative approval event reused, no new vague event');
check(serviceCode.includes('previousStatus: row.status') && serviceCode.includes('newStatus: "approved"'), 'F: audit identifies old/new status');
check(serviceCode.includes('previousVersion: row.approvalVersion') && serviceCode.includes('newVersion: row.approvalVersion + 1'), 'F: audit identifies old/new version');
check(serviceCode.includes('payloadSha256: row.payloadSha256'), 'F: audit identifies the payload hash');
check(serviceCode.includes('actorProfileId: params.actorProfileId'), 'F: audit identifies the actor');
check(serviceCode.includes('entityId: row.id'), 'F: audit identifies the historical import id');
check(serviceCode.includes('sourceKey: params.sourceKey'), 'F: audit metadata keeps the source key (backward compatible)');

// --- G. no downstream / promote / bulk ---------------------------------------
for (const table of ['operationsTable', 'reservationsTable', 'customersTable', 'bookingParties', 'historicalSourceEvidenceTable']) {
  check(!serviceCode.includes(table), `G: approval writes no ${table}`);
}
check(!/from "\.\/historical-migration-promote"/.test(serviceCode) && !/promoteHistorical|startPromotion|runPromotion/.test(serviceCode + routeCode), 'G: approval cannot promote');
check(!serviceCode.includes('for (') || !/for\s*\(.*sourceKey/.test(serviceCode), 'G: one request approves exactly one row (no loop over keys)');
check(!routeCode.includes('allowedWarnings'), 'G: HTTP boundary exposes no batch allowlist (no bulk surface)');

// --- H. frontend CTA visibility (detail only) --------------------------------
check(handoff.includes("usePermission('historical_migration', 'approve')"), 'H: CTA gates on the approve permission');
check(/if \(row\.derivedState !== 'READY_FOR_REVIEW' \|\| row\.status !== 'pending' \|\| !row\.payloadHashIntegrity \|\| !canApprove\)/.test(handoffCode.replace(/\n\s*/g, ' ')),
  'H: CTA renders only for READY + pending + intact hash + approve permission');
check(handoff.includes('İncelemeyi Onayla'), 'H: single CTA labeled exactly “İncelemeyi Onayla”');
check(detailPage.includes('<HistoricalApprovalHandoffPanel row={row} />'), 'H: CTA lives on the detail page');
check(!codeOf(queuePage).includes('HistoricalApprovalHandoffPanel') && !codeOf(queuePage).includes('İncelemeyi Onayla'),
  'H: no CTA on the queue list');

// --- I. confirmation copy ----------------------------------------------------
check(handoff.includes('Kaynak anahtarı') && handoff.includes('{row.sourceKey}'), 'I: confirm shows the source key');
check(handoff.includes('Misafir') && handoff.includes('{row.customerName'), 'I: confirm shows the customer');
check(handoff.includes('Mevcut uyarılar') && handoff.includes('row.warnings.map'), 'I: confirm shows current warnings');
check(handoff.includes('Payload SHA256') && handoff.includes('{row.payloadSha256}'), 'I: confirm shows the payload hash');
check(handoff.includes('Onay sürümü') && handoff.includes('{row.approvalVersion}'), 'I: confirm shows the approval version');
check(handoff.includes('Bu işlem yalnızca kaydı onaylar. Operasyon/rezervasyon oluşturmaz ve promotion çalıştırmaz.'),
  'I: confirm states approval is not promotion');
check(/>Vazgeç<\/AlertDialogCancel>/.test(handoff) && />\s*Onayla\s*<\/AlertDialogAction>/.test(handoff), 'I: “Vazgeç” / “Onayla” buttons');

// --- J. exact request body, double-submit, refetch ---------------------------
check(api.includes('approve: (sourceKey: string, body: ApprovalHandoffRequest)'), 'J: typed approve(sourceKey, body) client');
check(api.includes('/approve`') && api.includes("method: 'POST'"), 'J: approval is a POST to …/approve');
check(/expectedVersion: row\.approvalVersion,\s*expectedPayloadHash: row\.payloadSha256,/.test(handoffCode.replace(/\n\s*/g, ' ')),
  'J: request body is exactly the loaded version + hash at submit time');
check(!/field:|value:/.test(handoffCode.split('historicalRemediationApi.approve')[1]?.split('}')[0] ?? ''), 'J: approval request carries no correction field/value');
check(handoff.includes('disabled={mutation.isPending}'), 'J: double submit disabled while pending');
check((handoff.match(/mutation\.mutate\(\)/g) ?? []).length === 1, 'J: mutate() called exactly once');
check(/onSuccess:[\s\S]*queryKey: \['historical-remediation', row\.id\][\s\S]*queryKey: \['historical-remediation'\][\s\S]*İnceleme onaylandı/.test(handoffCode),
  'J: success closes over server truth — invalidates detail + queue, success toast, no faked status');
check(!handoffCode.includes('retry:'), 'J: no automatic retry configured');

// --- K. 409 + error handling -------------------------------------------------
check(/status === 409[\s\S]*invalidateQueries[\s\S]*Kayıt bu sırada değişti\. Güncel veriyi yeniden yükleyin\./.test(handoffCode),
  'K: 409 → refetch detail + queue with the exact conflict message, no retry');
for (const [code, title] of [[400, 'Geçersiz istek'], [401, 'Oturum doğrulanamadı'], [403, 'Yetki yok'], [404, 'Kayıt bulunamadı']]) {
  check(handoffCode.includes(`status === ${code}`), `K: ${code} handled distinctly (${title})`);
}

// --- L. forbidden + VIATOR + lifecycle ---------------------------------------
for (const src of [handoffCode, routeCode]) {
  for (const forbidden of ['promote', 'bulk', 'Bulk', 'autofill', 'Autofill', 'canonical', 'suggestion', 'reject']) {
    check(!src.includes(forbidden), `L: no "${forbidden}" surface`);
  }
}
check(!/VIATOR/i.test(handoffCode) && !/VIATOR/i.test(routeCode), 'L: C105 — Type/VIATOR remains irrelevant');
check(!schema.includes('READY_FOR_REVIEW') && !schema.includes('UNRESOLVED'), 'L: no new lifecycle status persisted');
const migrations = readdirSync(path.join(root, 'lib/db/migrations'));
check(!migrations.some(name => /^002[5-9]|^00[3-9]\d/.test(name)), 'L: no migration added');
check(existsSync(path.join(root, 'artifacts/api-server/src/lib/historical-remediation-review-readiness.ts')), 'L: 3E.4A readiness helper still present and reused');

console.log(`historical remediation approval handoff (phase 3E.4B) focused tests: ${count} assertions passed`);
