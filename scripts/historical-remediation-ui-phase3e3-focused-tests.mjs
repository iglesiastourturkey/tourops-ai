import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Phase 3E.3 — Controlled Historical Remediation UI focused tests.
//
// The front end has no component test runner in this repo, so these are
// static-source assertions in the same style as
// scripts/historical-remediation-mutation-focused-tests.mjs. They pin the
// safety-critical wiring: one field per request, permission gating, missing
// field restriction, human confirmation, optimistic concurrency, evidence
// read-only safety, and the absence of any bulk / approval surface.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(root, rel), 'utf8');

const api = read('artifacts/tourops-ai/src/lib/historical-remediation-api.ts');
const panel = read('artifacts/tourops-ai/src/components/historical-remediation/remediation-panel.tsx');
const detailPage = read('artifacts/tourops-ai/src/pages/historical-remediation-detail.tsx');
const readService = read('artifacts/api-server/src/lib/historical-remediation-read.ts');
const route = read('artifacts/api-server/src/routes/historical-remediation.ts');
const mutationValidation = read('artifacts/api-server/src/lib/historical-remediation-mutation-validation.ts');

let count = 0;
const check = (condition, message) => { assert.ok(condition, message); count += 1; };

// --- A. API client -----------------------------------------------------------
check(api.includes('remediate: (sourceKey: string, body: RemediationMutationRequest)'), 'A: typed remediate(sourceKey, body) method');
check(api.includes('`/api/historical-remediation/${encodeURIComponent(sourceKey)}/remediate`'), 'A: sourceKey goes in the URL, encoded');
check(api.includes("method: 'POST'"), 'A: remediate is a POST');
check(/field:\s*RemediationField;/.test(api) && /value:\s*string \| number;/.test(api)
  && /expectedVersion:\s*number;/.test(api) && /expectedPayloadHash:\s*string;/.test(api),
  'A: request carries exactly field/value/expectedVersion/expectedPayloadHash');
check(api.includes("REMEDIATION_FIELDS = ['pickupTime', 'passengerLanguage', 'pickupPoint', 'adultCount', 'externalOperator'] as const"),
  'A: exactly the five supported fields, matching the mutation engine');
const engineFields = [...mutationValidation.matchAll(/"(pickupTime|passengerLanguage|pickupPoint|adultCount|externalOperator)"/g)].map(m => m[1]);
check(new Set(engineFields).size === 5, 'A: mutation engine still exposes the same five fields');
check(!/:\s*any\b/.test(api), 'A: api client uses no `any`');

// --- B. permission behavior ------------------------------------------------
check(panel.includes("usePermission('historical_migration', 'remediate')"), 'B: panel gates on the remediate permission via the shared hook');
check(/if \(row\.status !== 'pending' \|\| !row\.payloadHashIntegrity \|\| !canRemediate \|\| remediableFields\.length === 0\)\s*{\s*return null;/.test(panel.replace(/\n\s*/g, ' ')),
  'B: without remediate permission (or non-pending / bad hash / no missing field) the panel renders nothing');
check(route.includes('requirePermission("historical_migration", "review")'), 'B: GET detail still only needs review');
check(route.includes('requirePermission("historical_migration", "remediate")'), 'B: backend still enforces remediate on the mutation');
check(detailPage.includes('<HistoricalRemediationPanel row={row} />'), 'B: read-only detail page renders unchanged, panel is additive');

// --- C. missing-field restriction ----------------------------------------
check(panel.includes('row.missingFields.filter(isSupportedField)'), 'C: options = supported ∩ currently-missing');
check(panel.includes('remediableFields.map(item =>'), 'C: the select only lists remediable missing fields');
check(!panel.includes('REMEDIATION_FIELDS.map'), 'C: the full supported list is never rendered as choices');

// --- D. field inputs ---------------------------------------------------------
check(panel.includes("field === 'pickupTime'") && panel.includes('type="time"'), 'D: pickupTime uses a time input');
check(/PICKUP_TIME_RE\s*=\s*\/\^\(\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$\//.test(panel), 'D: pickupTime validated as HH:mm');
check(panel.includes("field === 'passengerLanguage'"), 'D: passengerLanguage has its own text input');
check(panel.includes("field === 'pickupPoint'") && panel.includes('maxLength={120}'), 'D: pickupPoint text input capped at 120');
check(panel.includes("field === 'adultCount'") && panel.includes('type="number"') && panel.includes('min={1}') && panel.includes('max={99}'),
  'D: adultCount integer input 1..99');
check(panel.includes('n >= 1 && n <= 99') && panel.includes('Number.isInteger(n)'), 'D: adultCount client validation is integer 1..99');
check(panel.includes("field === 'externalOperator'") && panel.includes('Operatör adını elle yazın'), 'D: externalOperator is a manual text input');

// --- E. human confirmation -------------------------------------------------
check(panel.includes('onClick={() => setConfirmOpen(true)}'), 'E: the form button only opens the confirmation dialog');
const mutateCalls = [...panel.matchAll(/mutation\.mutate\(\)/g)];
check(mutateCalls.length === 1, 'E: mutation.mutate is called exactly once in the component');
check(/<AlertDialogAction[\s\S]{0,220}mutation\.mutate\(\)/.test(panel), 'E: the only mutate() call is inside AlertDialogAction');
check(panel.includes('event.preventDefault(); mutation.mutate();'), 'E: no one-click auto-submit — action stays open until the mutation resolves');
check(panel.includes('Kaynak anahtarı') && panel.includes('{row.sourceKey}'), 'E: confirm shows the source key');
check(panel.includes('Misafir') && panel.includes('{row.customerName'), 'E: confirm shows the customer name');
check(panel.includes('Düzeltilecek alan') && panel.includes('REMEDIATION_FIELD_LABELS[field]'), 'E: confirm shows the field being corrected');
check(panel.includes('Yeni değer') && panel.includes('{displayValue'), 'E: confirm shows the new value');
check(panel.includes('Mevcut uyarılar') && panel.includes('row.warnings.map'), 'E: confirm shows current warnings');
check(panel.includes('Kaldırılacak uyarı') && panel.includes('{removedWarning'), 'E: confirm shows the warning that will be removed');
check((panel.match(/Düzeltmeyi Kaydet/g) ?? []).length === 2, 'E: explicit "Düzeltmeyi Kaydet" CTA on both the form button and the confirm action');
check(/>Vazgeç<\/AlertDialogCancel>/.test(panel), 'E: explicit "Vazgeç" cancel CTA');

// --- F. optimistic concurrency ------------------------------------------------
check(readService.includes('approvalVersion: row.historical.approvalVersion'), 'F: read service now exposes approvalVersion (smallest read-only backend extension)');
check(api.includes('approvalVersion: number;'), 'F: RemediationDetail type carries approvalVersion');
check(panel.includes('expectedVersion: row.approvalVersion'), 'F: expectedVersion comes from the loaded row');
check(panel.includes('expectedPayloadHash: row.payloadSha256'), 'F: expectedPayloadHash comes from the loaded row');
check(!panel.includes('useRef'), 'F: no ref holding a stale version/hash');
check(!/useState[^;]*approvalVersion/.test(panel) && !/useState[^;]*payloadSha256/.test(panel), 'F: version/hash are never copied into local state');
check((panel.match(/row\.approvalVersion/g) ?? []).length === 1 && (panel.match(/expectedVersion:/g) ?? []).length === 1,
  'F: the single expectedVersion is read directly from row.approvalVersion at submit time');
check(!panel.includes('retry:'), 'F: mutation never sets retry — no automatic retry');
check(/status === 409[\s\S]*invalidateQueries[\s\S]*Kayıt bu sırada değişti\. Güncel veriyi yeniden yükleyin\./.test(panel),
  'F: 409 → refetch detail + queue and show the exact conflict message, no retry');

// --- G. success flow -------------------------------------------------------
check(/onSuccess:[\s\S]*setConfirmOpen\(false\)[\s\S]*resetForm\(\)/.test(panel), 'G: success closes the dialog and clears the local form');
check(/onSuccess:[\s\S]*queryKey: \['historical-remediation', row\.id\]/.test(panel), 'G: success invalidates the detail query');
check(/onSuccess:[\s\S]*queryKey: \['historical-remediation'\] \}\)/.test(panel), 'G: success invalidates the remediation queue query');
check(/onSuccess:[\s\S]*toast\(\{ title: 'Düzeltme kaydedildi' \}\)/.test(panel), 'G: success toast');
check(panel.includes("const payloadValue: string | number = field === 'adultCount' ? Number(value) : value.trim()"),
  'G: server-computed state is trusted — client only sends the raw field value, never a faked next state');

// --- H. invalid provenance regression -----------------------------------------
// Strip comments — the file documents these hazards in prose on purpose; what
// matters is that no executable code touches evidence or the Type column.
const panelCode = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check(!/\bevidence\b/i.test(panelCode), 'H: no code path reads Source Evidence');
check(!/\brow\.evidence\b/.test(panelCode), 'H: row.evidence is never dereferenced');
check(!/VIATOR/i.test(panelCode) && !/\bType\b/.test(panelCode), 'H: no code reinterprets the source Type column / VIATOR');
check(!/defaultValue=/.test(panelCode) && !/value=\{[^}]*row\./.test(panelCode), 'H: no field input is prefilled from a derived/row value');
check(panelCode.includes("useState('')"), 'H: the correction value starts empty, not seeded');

// --- I. no forbidden controls -----------------------------------------------
// Executable code only (comments describe what is intentionally absent).
for (const forbidden of ['bulk', 'Bulk', 'approve', 'Approve', 'reject', 'Reject', 'promote', 'Promote',
  'canonical', 'Autofill', 'autofill', 'Bu değeri kullan', 'Öneriyi uygula', 'suggestion', 'selectAll', 'checkbox']) {
  check(!panelCode.includes(forbidden), `I: panel code contains no "${forbidden}" surface`);
}
check((detailPage.match(/HistoricalRemediationPanel/g) ?? []).length === 2, 'I: detail page wires the panel once (import + render), nothing else added');
check(!/router\.(put|patch|delete)\(/.test(route) && (route.match(/router\.post\(/g) ?? []).length === 1,
  'I: backend remediation router still exposes exactly one POST and no PUT/PATCH/DELETE');

console.log(`historical remediation UI (phase 3E.3) focused tests: ${count} assertions passed`);
