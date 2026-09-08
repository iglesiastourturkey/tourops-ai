import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Phase 2C — Canonical Guide/Driver Assignment focused tests.
//
// Two kinds of assertion, same convention as
// scripts/personnel-identity-phase2d1-focused-tests.mjs:
//  (1) real unit tests against operation-assignment.ts's pure functions,
//      loaded via Node's built-in TS type-stripping (no bundler/tsx);
//  (2) static-source assertions pinning the safety-critical wiring that
//      cannot be unit-tested without a live DB (RBAC gating, audit logging,
//      conflict identity, login-identity independence, no delete surface,
//      Daily Operations batching, legacy-text preservation).
//
// Numbered comments below map 1:1 to the 20 items in the Phase 2C spec's
// Section 21.

const assignmentUrl = new URL('../artifacts/api-server/src/lib/operation-assignment.ts', import.meta.url);
const { validateAssignmentCandidate, scanResourceConflicts, rangesOverlap, classifyAssignmentState } = await import(assignmentUrl.href);

function read(relPath) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

const fieldRouteSource = read('../artifacts/api-server/src/routes/field.ts');
const operationDetailReadSource = read('../artifacts/api-server/src/lib/operation-detail-read.ts');
const dailyOperationsReadSource = read('../artifacts/api-server/src/lib/daily-operations-read.ts');
const operationDetailTsxSource = read('../artifacts/tourops-ai/src/pages/operation-detail.tsx');
const domainWorkspaceSource = read('../artifacts/tourops-ai/src/components/OperationDomainWorkspace.tsx');
const fieldOperationDetailTsxSource = read('../artifacts/tourops-ai/src/pages/field-operation-detail.tsx');
const seedPermissionsSource = read('../artifacts/api-server/src/lib/seed-permissions.ts');
const resourcesSchemaSource = read('../lib/db/src/schema/operations.ts');
const openapiSource = read('../lib/api-spec/openapi.yaml');

let count = 0;
const check = (condition, message) => { assert.ok(condition, message); count += 1; };

// ─── 1-2. GUIDE resource assignable as guide; DRIVER rejected as guide ────

check(validateAssignmentCandidate({ id: 1, type: 'GUIDE', active: true }, 'GUIDE').ok === true,
  '1: an active GUIDE resource is a valid GUIDE assignment candidate');
{
  const verdict = validateAssignmentCandidate({ id: 2, type: 'DRIVER', active: true }, 'GUIDE');
  check(verdict.ok === false && verdict.code === 'resource_type_mismatch',
    '2: a DRIVER resource must be rejected when assigned as GUIDE');
}

// ─── 3-4. DRIVER resource assignable as driver; GUIDE rejected as driver ──

check(validateAssignmentCandidate({ id: 3, type: 'DRIVER', active: true }, 'DRIVER').ok === true,
  '3: an active DRIVER resource is a valid DRIVER assignment candidate');
{
  const verdict = validateAssignmentCandidate({ id: 4, type: 'GUIDE', active: true }, 'DRIVER');
  check(verdict.ok === false && verdict.code === 'resource_type_mismatch',
    '4: a GUIDE resource must be rejected when assigned as DRIVER');
}

// ─── 5. inactive resource cannot be assigned ──────────────────────────────

{
  const verdict = validateAssignmentCandidate({ id: 5, type: 'GUIDE', active: false }, 'GUIDE');
  check(verdict.ok === false && verdict.code === 'resource_inactive',
    '5: an inactive resource must be rejected regardless of type match');
}

// ─── 6. nonexistent resource rejected ─────────────────────────────────────

{
  const verdict = validateAssignmentCandidate(undefined, 'GUIDE');
  check(verdict.ok === false && verdict.code === 'resource_not_found',
    '6: a resource id that does not exist (candidate undefined) must be rejected, not silently accepted');
  const verdictNull = validateAssignmentCandidate(null, 'DRIVER');
  check(verdictNull.ok === false && verdictNull.code === 'resource_not_found',
    '6b: same for null candidate');
}

// ─── 7. assignment mutation permission enforced server-side ───────────────

check(fieldRouteSource.includes('hasPermission(res.locals.profile.id, res.locals.profile.role, "operations", "assign")'),
  '7: the assignments endpoint checks the operations.assign permission in-handler, server-side');
check(/if \(guideResourceId !== undefined \|\| driverResourceId !== undefined\) \{\s*\n\s*const canAssign = await hasPermission/.test(fieldRouteSource),
  '7b: the permission check gates specifically on the request touching guideResourceId/driverResourceId, not every assignment PATCH');
// Safety-review fix: the handler now buffers early exits as a plain
// { error: { status, body } } value returned from inside db.transaction
// (see field.ts's own comment on AssignmentTxResult) instead of calling
// res.status(...) directly from inside the transaction callback — so the
// HTTP response is only ever sent once, after the transaction has actually
// committed or rolled back. The 403 status itself is still produced.
check(/if \(!canAssign\) \{\s*\n\s*return \{ error: \{ status: 403,/.test(fieldRouteSource),
  '7c: an unauthorized caller gets a 403 (via the buffered transaction result), not a silently-ignored write');
check(/if \("error" in result\) \{\s*\n\s*return res\.status\(result\.error\.status\)\.json\(result\.error\.body\);/.test(fieldRouteSource),
  '7e: the buffered error result is dispatched to res.status(...).json(...) exactly once, after the transaction settles');
check(/\["operations", "assign",\s*\["admin","operations"\]\]/.test(seedPermissionsSource),
  '7d: operations.assign is seeded for admin/operations (reusing the pre-existing dormant permission, not inventing a new one)');

// ─── 8. canonical resource ID persisted by the write model ────────────────

check(/if \(guideResourceId !== undefined\) \{\s*\n\s*updates\.guideResourceId = guideResourceId;/.test(fieldRouteSource),
  '8: guideResourceId is written to updates.guideResourceId when present in the request');
check(/if \(driverResourceId !== undefined\) \{\s*\n\s*updates\.driverResourceId = driverResourceId;/.test(fieldRouteSource),
  '8b: driverResourceId is written to updates.driverResourceId when present in the request');
check(/guideResourceId: integer\("guide_resource_id"\)\.references\(\(\) => resourcesTable\.id/.test(resourcesSchemaSource)
  && /driverResourceId: integer\("driver_resource_id"\)\.references\(\(\) => resourcesTable\.id/.test(resourcesSchemaSource),
  '8c: the schema already defines guide_resource_id/driver_resource_id as FKs to resources — no migration was needed for Phase 2C');

// ─── 9. legacy provenance/snapshot policy behaves exactly as documented ───

check(/if \(resolvedGuideResource && guideName === undefined\) updates\.guideName = resolvedGuideResource\.name;/.test(fieldRouteSource),
  '9: selecting a canonical guide resource snapshots its name into the legacy guideName column, unless the caller sent an explicit guideName of their own');
check(/if \(resolvedGuideResource && guidePhone === undefined\) updates\.guidePhone = resolvedGuideResource\.phone/.test(fieldRouteSource),
  '9b: same snapshot policy for guidePhone');
check(/if \(resolvedDriverResource && driverName === undefined\) updates\.driverName = resolvedDriverResource\.name;/.test(fieldRouteSource),
  '9c: same snapshot policy for driverName');
check(!/DELETE FROM operations|UPDATE operations SET guide_name = NULL WHERE/i.test(fieldRouteSource),
  '9d: no bulk/backfill rewrite of legacy text was introduced');

// ─── 10. conflict detection uses resource identity, not login identity ────

check(rangesOverlap('2026-06-01', '2026-06-05', '2026-06-04', '2026-06-10') === true,
  '10: overlapping ranges are detected');
check(rangesOverlap('2026-06-01', '2026-06-05', '2026-06-06', '2026-06-10') === false,
  '10b: adjacent non-overlapping ranges are not flagged');
{
  const candidate = { id: 100, startDate: '2026-07-01', endDate: '2026-07-05', status: 'planned' };
  const others = [
    { id: 101, startDate: '2026-07-03', endDate: '2026-07-08', status: 'planned' },
    { id: 102, startDate: '2026-08-01', endDate: '2026-08-05', status: 'planned' },
    { id: 100, startDate: '2026-07-01', endDate: '2026-07-05', status: 'planned' }, // self, excluded
    { id: 103, startDate: '2026-07-04', endDate: '2026-07-06', status: 'cancelled' }, // terminal, excluded
  ];
  const result = scanResourceConflicts(candidate, others);
  check(result.conflicts.length === 1 && result.conflicts[0].id === 101,
    '10c: scanResourceConflicts finds exactly the one real, non-terminal, non-self overlap');
}
{
  // Missing dates on either side must fail conservatively (indeterminate), never be silently ignored.
  const candidate = { id: 200, startDate: null, endDate: null, status: 'planned' };
  const others = [{ id: 201, startDate: '2026-07-01', endDate: '2026-07-05', status: 'planned' }];
  const result = scanResourceConflicts(candidate, others);
  check(result.conflicts.length === 0 && result.indeterminate.length === 1 && result.indeterminate[0].id === 201,
    '10d: an unprovable overlap (missing dates) is surfaced as indeterminate, never fabricated as a conflict or silently dropped');
}
check(/guideResourceOthers = await tx\.select.*\n.*\.from\(operationsTable\)\.where\(and\(eq\(operationsTable\.guideResourceId, guideResourceId\)/.test(fieldRouteSource),
  '10e: the canonical guide conflict scan queries other operations by guideResourceId, not by assignedGuideUserId');
check(/driverResourceOthers = await tx\.select.*\n.*\.from\(operationsTable\)\.where\(and\(eq\(operationsTable\.driverResourceId, driverResourceId\)/.test(fieldRouteSource),
  '10f: the canonical driver conflict scan queries other operations by driverResourceId');
check(/SELECT pg_advisory_xact_lock\(2026, 8\)/.test(fieldRouteSource),
  '10g: the assignment handler takes the dedicated (2026, 8) advisory lock, serializing all concurrent canonical assignment mutations globally so two different operations cannot both win a race for the same resource');
check(/\.where\(eq\(operationsTable\.id, opId\)\)\s*\n\s*\.for\("update"\);/.test(fieldRouteSource),
  '10h: the target operation row itself is locked FOR UPDATE for the duration of the transaction');
check((fieldRouteSource.match(/\}, tx\);/g) ?? []).length >= 4,
  '10i: all four assignment-related createAuditLog calls pass tx as the executor (each closes with "}, tx);"), so the audit row and the assignment update commit or roll back atomically together');

// ─── 11. assignedGuideUserId is never treated as canonical person identity ─

check(fieldRouteSource.includes('assignedGuideUserId, assignedGuideUserId)'),
  '11: the pre-existing assignedGuideUserId conflict check remains, unrelated to and untouched by the new resource-based checks');
check(!/validateAssignmentCandidate\(.*assignedGuideUserId/.test(fieldRouteSource),
  '11b: assignedGuideUserId is never passed into the canonical resource validator');
check(!/guideResourceId\s*=\s*assignedGuideUserId|assignedGuideUserId\s*=\s*guideResourceId/.test(fieldRouteSource),
  '11c: the two identities are never assigned from one another anywhere in the handler');
check(!/linkedProfileId.*name\.|name\..*linkedProfileId/.test(fieldRouteSource),
  '11d: linked_profile_id is never inferred from a name/text field in this handler');

// ─── 12. legacy-only operation remains readable ───────────────────────────

check(classifyAssignmentState(null, 'Ahmet Yılmaz (legacy)') === 'LEGACY_ONLY',
  '12: a null resourceId with non-empty legacy text classifies as LEGACY_ONLY, not UNASSIGNED or an error');
check(classifyAssignmentState(undefined, '') === 'UNASSIGNED', '12b: no resource and no legacy text classifies as UNASSIGNED');
check(classifyAssignmentState(7, 'Ahmet Yılmaz (legacy)') === 'CANONICAL', '12c: a resolved resourceId classifies as CANONICAL even if legacy text also exists');

// ─── 13. canonical operation renders canonical personnel ──────────────────

check(domainWorkspaceSource.includes('assignmentStateLabel(c.guideResourceName, op.guideName)')
  && domainWorkspaceSource.includes('assignmentStateLabel(c.driverResourceName, op.driverName)'),
  '13: the shared read-only workspace view renders the canonical/legacy/unassigned label, not a raw fallback chain that hides which case applies');
check(/if \(resourceName\) return `\$\{resourceName\} · Personel kaydıyla eşleşti`;/.test(domainWorkspaceSource),
  '13b: a resolved canonical resource name is what actually renders when present (CANONICAL state)');
check(operationDetailTsxSource.includes("guideResources ?? []).map(r => (") || operationDetailTsxSource.includes('(guideResources ?? []).map(r =>'),
  '13c: the desktop assignment editor lists real fetched canonical resources, not a hardcoded/fabricated list');

// ─── 14. no auto-create / auto-merge / fuzzy auto-match ───────────────────

for (const src of [fieldRouteSource, operationDetailTsxSource, fieldOperationDetailTsxSource]) {
  check(!/EXACT_MATCH|ALIAS_MATCH|AMBIGUOUS|UNMATCHED/.test(src),
    '14: no fuzzy/auto identity-matching status is introduced into the assignment write path or UI');
}
check(!/db\.insert\(resourcesTable\)/.test(fieldRouteSource), '14b: the assignment endpoint never creates a new Resource row (no auto-create)');
check(!/UPDATE resources SET .* WHERE id IN|MERGE INTO resources/i.test(fieldRouteSource), '14c: no resource auto-merge SQL exists in the assignment path');

// ─── 15. audit written on assignment changes (all four directions) ────────

for (const eventType of ['guide_resource_assigned', 'guide_resource_changed', 'guide_resource_unassigned',
                          'driver_resource_assigned', 'driver_resource_changed', 'driver_resource_unassigned']) {
  check(fieldRouteSource.includes(`"${eventType}"`), `15: audit eventType "${eventType}" is emitted somewhere in the handler`);
}
check((fieldRouteSource.match(/await createAuditLog\(\{/g) ?? []).length >= 4,
  '15b: at least the two pre-existing (legacy) and two new (canonical) createAuditLog calls are present — nothing was replaced, only added to');
check(/newValue: \{ guideResourceId \}/.test(fieldRouteSource) && /oldValue: \{ guideResourceId: op\.guideResourceId \}/.test(fieldRouteSource),
  '15c: the canonical guide audit entry records old/new resource ID, not just a description string');

// ─── 16. unassign works safely (null clears FK, legacy text untouched) ────

check(/guideResourceId != null\) \{/.test(fieldRouteSource),
  '16: guideResourceId handling distinguishes null (explicit unassign) from undefined (leave untouched)');
check(!/if \(guideResourceId === null\).*updates\.guideName = null/s.test(fieldRouteSource),
  '16b: unassigning the canonical resource (guideResourceId: null) does not also null out the legacy guideName snapshot');

// ─── 17. no physical personnel delete capability introduced ──────────────

check(!/router\.delete\("\/:id"/.test(fieldRouteSource), '17: no DELETE route added to the assignments handler');
check(!/db\.delete\(resourcesTable\)/.test(fieldRouteSource), '17b: no delete of a resources row anywhere in the assignment write path');

// ─── 18. Daily Operations remains no-N+1 (single batched join, untouched) ─

check(!/for\s*\(.*of.*\)\s*\{\s*\n\s*.*await db\.select/.test(dailyOperationsReadSource),
  '18: daily-operations-read.ts contains no per-row query loop (still one batched join)');
check(dailyOperationsReadSource.includes('guideResourceName: resourcesTable.name') && dailyOperationsReadSource.includes('driverResourceName: driver.name'),
  '18b: daily-operations-read.ts already selects guide/driver resource names in its one batched query — Phase 2C changed nothing here');
// ─── 19-20. Phase 2D.1 / Phase 2D.2 tests stay green ──────────────────────
// Not re-asserted here (that would duplicate scripts/personnel-identity-phase2d1-focused-tests.mjs
// and scripts/personnel-management-ui-phase2d2-focused-tests.mjs) — the regression run executes both
// scripts directly and both must exit 0. Two narrow compatibility checks here confirm the specific
// facts those two suites depend on are still true after Phase 2C's edits:
check(operationDetailReadSource.includes('guideResourceName: resourcesTable.name') && operationDetailReadSource.includes('driverResourceName: driver.name'),
  '19: operation-detail-read.ts still reads guideResourceName/driverResourceName exactly as Phase 2D.1 pinned — only additively extended (guideResourceActive/driverResourceActive)');
check(operationDetailReadSource.includes('guideResourceActive: resourcesTable.active') && operationDetailReadSource.includes('driverResourceActive: driver.active'),
  '20: operation-detail-read.ts additively exposes resource active-state for CANONICAL/LEGACY_ONLY/UNASSIGNED classification, nothing removed');

// ─── API contract: additive-only OpenAPI change ───────────────────────────

check(openapiSource.includes('guideResourceId: { type: ["number", "null"] }') && openapiSource.includes('driverResourceId: { type: ["number", "null"] }'),
  'API: Operation/OperationDetail schemas expose guideResourceId/driverResourceId as additive optional fields');

console.log(`canonical-operation-assignment-phase2c: ${count} assertions passed`);
