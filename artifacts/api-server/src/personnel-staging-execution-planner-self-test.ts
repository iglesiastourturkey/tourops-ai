/**
 * Pure, dependency-free self-test for Phase 2D.4A
 * (personnel-staging-execution-planner.ts). No network, no database, no
 * filesystem writes outside this process. Mirrors the established pattern
 * from personnel-master-import-self-test.ts (Phase 2D.3).
 */
import assert from "node:assert/strict";
import {
  discoverPersonnelWorkbook,
  buildPersonnelMasterImportPlan,
} from "./lib/personnel-import-parser";
import { normalizePersonName } from "./lib/personnel-identity";
import {
  buildStagingApprovalPlan,
  computeActionFingerprint,
  validatePlanAgainstCurrentWorkbook,
  executeApprovedStagingAction,
  type StagingExecutionAdapter,
  type ApprovedStagingAction,
  type StagingApprovalProposal,
} from "./lib/personnel-staging-execution-planner";

// Mock ExcelJS workbook builder — identical shape to Phase 2D.3's self-test helper.
function createMockWorkbook(sheetsData: Array<{ name: string; rows?: any[][] }>) {
  return {
    worksheets: sheetsData.map(s => ({
      name: s.name,
      eachRow: (_opts: any, cb: (row: { actualCellCount: number; eachCell: (o: any, cellCb: (c: { value: any }) => void) => void }, rowNumber: number) => void) => {
        const rows = s.rows ?? [["Header1", "Header2"], ["Val1", "Val2"]];
        rows.forEach((r, rIdx) => cb({
          actualCellCount: r.length,
          eachCell: (_o: any, cellCb: (c: { value: any }) => void) => { r.forEach(cellVal => cellCb({ value: cellVal })); },
        }, rIdx + 1));
      },
    })),
  } as any;
}

const WORKBOOK_SHA = "a".repeat(64);
const WORKBOOK_SHA_CHANGED = "b".repeat(64);

function plan(sheets: Array<{ name: string; rows?: any[][] }>, resources: any[] = [], aliases: any[] = [], sha = WORKBOOK_SHA) {
  const wb = createMockWorkbook(sheets);
  const discovery = discoverPersonnelWorkbook(wb, { sourceFilename: "TEST-2026.xlsx", workbookFingerprint: sha, workbookSha256: sha });
  const importPlan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  return buildStagingApprovalPlan(importPlan);
}

// ─── 1. Clean unmatched guide => CREATE_NEW_RESOURCE ──────────────────────
{
  const p = plan([{ name: "FATMA" }]);
  const proposal = p.proposals.find(x => x.rawName === "FATMA")!;
  assert.equal(proposal.proposedAction, "CREATE_NEW_RESOURCE");
  assert.equal(proposal.proposedResourceType, "GUIDE");
  assert.equal(proposal.reviewStatus, "PENDING_APPROVAL");
  assert.equal(proposal.existingResourceId, null);
  assert.equal(p.summary.proposedNewGuideResources, 1);
  assert.equal(p.summary.totalSourceCandidates, 1);
}

// ─── 2. Exact existing resource => MATCH_EXISTING_RESOURCE ────────────────
{
  const resources = [{ id: 101, normalizedName: normalizePersonName("FATMA") }];
  const p = plan([{ name: "FATMA" }], resources, []);
  const proposal = p.proposals.find(x => x.rawName === "FATMA")!;
  assert.equal(proposal.proposedAction, "MATCH_EXISTING_RESOURCE");
  assert.equal(proposal.existingResourceId, 101);
  assert.equal(proposal.reviewStatus, "PENDING_APPROVAL");
  assert.equal(p.summary.existingExactMatches, 1);
  assert.equal(p.summary.proposedNewGuideResources, 0);
}

// ─── 3. Alias match => MATCH_EXISTING_RESOURCE ────────────────────────────
{
  const resources = [{ id: 202, normalizedName: normalizePersonName("MEHMET KARATAS") }];
  const aliases = [{ resourceId: 202, normalizedAlias: normalizePersonName("MK") }];
  const p = plan([{ name: "MK" }], resources, aliases);
  const proposal = p.proposals.find(x => x.rawName === "MK")!;
  assert.equal(proposal.proposedAction, "MATCH_EXISTING_RESOURCE");
  assert.equal(proposal.existingResourceId, 202);
  assert.equal(p.summary.existingAliasMatches, 1);
}

// ─── 4. Ambiguous => DEFER ─────────────────────────────────────────────────
{
  const resources = [
    { id: 301, normalizedName: normalizePersonName("KADIR SAHIN") },
    { id: 302, normalizedName: normalizePersonName("KADIR SAHIN") },
  ];
  const p = plan([{ name: "KADIR SAHIN" }], resources, []);
  const proposal = p.proposals.find(x => x.rawName === "KADIR SAHIN")!;
  assert.equal(proposal.proposedAction, "DEFER");
  assert.equal(proposal.existingResourceId, null);
  assert.equal(proposal.reviewStatus, "PENDING_REVIEW");
  assert.equal(p.summary.ambiguities, 1);
  assert.equal(p.summary.proposedNewGuideResources, 0);
}

// ─── 5. Fuzzy/substring similarity => informational suggestion only ───────
{
  const p = plan([{ name: "GOKBORA" }, { name: "ERMAN GOKBORA" }]);
  const gokbora = p.proposals.find(x => x.rawName === "GOKBORA")!;
  const erman = p.proposals.find(x => x.rawName === "ERMAN GOKBORA")!;
  assert.equal(gokbora.proposedAction, "CREATE_NEW_RESOURCE", "substring similarity must never force DEFER/merge");
  assert.equal(erman.proposedAction, "CREATE_NEW_RESOURCE");
  assert.equal(gokbora.sameWorkbookSimilarityNotes.length, 1);
  assert.equal(gokbora.sameWorkbookSimilarityNotes[0]?.basis, "INFORMATIONAL_SUGGESTION");
  assert.ok(p.summary.informationalSimilaritySuggestions >= 2);
  assert.equal(p.summary.ambiguities, 0, "GOKBORA/ERMAN GOKBORA must never be inferred as the same person");
}

// ─── 6. Rerun same input produces same action fingerprint ────────────────
{
  const p1 = plan([{ name: "FATMA" }]);
  const p2 = plan([{ name: "FATMA" }]);
  const f1 = p1.proposals.find(x => x.rawName === "FATMA")!.actionFingerprint;
  const f2 = p2.proposals.find(x => x.rawName === "FATMA")!.actionFingerprint;
  assert.equal(f1, f2, "identical input must reproduce an identical fingerprint");
  assert.equal(f1.length, 64, "fingerprint is a sha256 hex digest");

  const direct = computeActionFingerprint({
    sourceWorkbookSha256: WORKBOOK_SHA,
    sourceSheetName: "FATMA",
    rawName: "FATMA",
    normalizedName: normalizePersonName("FATMA"),
    proposedAction: "CREATE_NEW_RESOURCE",
    proposedResourceType: "GUIDE",
  });
  assert.equal(direct, f1, "fingerprint must be derivable from documented fields alone, no timestamp involved");
}

// ─── 7. Changed workbook hash invalidates plan ────────────────────────────
{
  const p1 = plan([{ name: "FATMA" }], [], [], WORKBOOK_SHA);
  const p2 = plan([{ name: "FATMA" }], [], [], WORKBOOK_SHA_CHANGED);
  const f1 = p1.proposals.find(x => x.rawName === "FATMA")!.actionFingerprint;
  const f2 = p2.proposals.find(x => x.rawName === "FATMA")!.actionFingerprint;
  assert.notEqual(f1, f2, "a changed workbook SHA must change every fingerprint it contributes to");

  const validSameSha = validatePlanAgainstCurrentWorkbook(p1, WORKBOOK_SHA);
  assert.equal(validSameSha.valid, true);
  const invalidChangedSha = validatePlanAgainstCurrentWorkbook(p1, WORKBOOK_SHA_CHANGED);
  assert.equal(invalidChangedSha.valid, false);
  if (!invalidChangedSha.valid) assert.match(invalidChangedSha.reason, /Stale plan/);
}

// ─── 8. TAYLAN cannot produce a GUIDE action ──────────────────────────────
{
  const p = plan([{ name: "TAYLAN" }]);
  const taylan = p.proposals.find(x => x.rawName === "TAYLAN")!;
  assert.equal(taylan.proposedAction, "DEFER");
  assert.equal(taylan.businessRole, "ACCOUNTING_PERSONNEL");
  assert.equal(taylan.proposedResourceType, undefined, "TAYLAN must never carry a GUIDE resource type");
  assert.equal(taylan.existingResourceId, null);
  assert.equal(p.summary.unsupportedPersonnelDeferrals, 1);
  assert.equal(p.summary.proposedNewGuideResources, 0);
}

// ─── 9. ESMA row mention cannot produce a resource action ─────────────────
{
  const p = plan([{ name: "CANAN", rows: [["Date", "Note"], ["2026-01-01", "ESMA handled the transfer"]] }]);
  assert.equal(p.proposals.some(x => x.rawName === "ESMA"), false, "row-level ESMA mention must never manufacture an ESMA proposal");
  const canan = p.proposals.find(x => x.rawName === "CANAN")!;
  assert.equal(canan.proposedAction, "CREATE_NEW_RESOURCE", "the host sheet's own action is unaffected by a row-level ESMA mention");

  const esmaSheet = plan([{ name: "ESMA" }]);
  const esmaProposal = esmaSheet.proposals.find(x => x.rawName === "ESMA")!;
  assert.equal(esmaProposal.proposedAction, "DEFER");
  assert.equal(esmaProposal.businessRole, "OPERATIONS_PERSONNEL");
  assert.equal(esmaProposal.proposedResourceType, undefined);
}

// ─── 10. FF cannot produce CREATE_NEW_RESOURCE ────────────────────────────
{
  const p = plan([{ name: "FF" }]);
  const ff = p.proposals.find(x => x.rawName === "FF")!;
  assert.equal(ff.proposedAction, "DEFER");
  assert.equal(ff.proposedResourceType, undefined);
  assert.equal(p.summary.unknownDeferrals, 1);
}

// ─── 11. Display-review names deferred by default ─────────────────────────
{
  const p = plan([{ name: "CIGDEM HANIM" }, { name: "SINAN BEY" }, { name: "BAHAR K." }]);
  for (const rawName of ["CIGDEM HANIM", "SINAN BEY", "BAHAR K."]) {
    const proposal = p.proposals.find(x => x.rawName === rawName)!;
    assert.equal(proposal.proposedAction, "DEFER", `${rawName} must DEFER by default in Phase 2D.4A`);
    assert.equal(proposal.rawName, rawName, "raw display name preserved exactly");
  }
  assert.equal(p.summary.displayNameReviewDeferrals, 3);

  // Even when a display-review name already exactly matches an existing
  // resource, Phase 2D.4A still DEFERs rather than auto-proposing a match —
  // per the explicit operator instruction that this bucket always defers.
  const resources = [{ id: 55, normalizedName: normalizePersonName("SINAN BEY") }];
  const withMatch = plan([{ name: "SINAN BEY" }], resources, []);
  const sinan = withMatch.proposals.find(x => x.rawName === "SINAN BEY")!;
  assert.equal(sinan.proposedAction, "DEFER");
  assert.equal(sinan.existingResourceId, 55, "the existing match is still surfaced informationally");
}

// ─── 12. ADD_ALIAS only via explicit human approval, never algorithmic ────
// ("MEMOCAN" — long enough to avoid the unrelated FF-style short-code
// heuristic in looksLikeUnknownCodeIdentity, which only fires at <=2 chars.)
{
  const withoutApproval = plan([{ name: "MEMOCAN" }]);
  const mkNoApproval = withoutApproval.proposals.find(x => x.rawName === "MEMOCAN")!;
  assert.equal(mkNoApproval.proposedAction, "CREATE_NEW_RESOURCE", "no ADD_ALIAS without an explicit human approval");

  const wb = createMockWorkbook([{ name: "MEMOCAN" }]);
  const discovery = discoverPersonnelWorkbook(wb, { sourceFilename: "TEST-2026.xlsx", workbookFingerprint: WORKBOOK_SHA, workbookSha256: WORKBOOK_SHA });
  const importPlan = buildPersonnelMasterImportPlan(discovery, [], []);
  const withApproval = buildStagingApprovalPlan(importPlan, {
    humanSuppliedAliasApprovals: [{ rawName: "MEMOCAN", targetResourceId: 202, source: "PERFORMANCE_2026" }],
  });
  const mkApproved = withApproval.proposals.find(x => x.rawName === "MEMOCAN")!;
  assert.equal(mkApproved.proposedAction, "ADD_ALIAS");
  assert.equal(mkApproved.existingResourceId, 202);
  assert.equal(mkApproved.reviewStatus, "PENDING_APPROVAL");
  assert.equal(withApproval.summary.addAliasProposals, 1);
}

// ─── 13. REJECT only via explicit human rejection, never algorithmic ──────
{
  const base = plan([{ name: "FATMA" }]);
  assert.equal(base.summary.rejected, 0);
  const fingerprint = base.proposals.find(x => x.rawName === "FATMA")!.actionFingerprint;

  const wb = createMockWorkbook([{ name: "FATMA" }]);
  const discovery = discoverPersonnelWorkbook(wb, { sourceFilename: "TEST-2026.xlsx", workbookFingerprint: WORKBOOK_SHA, workbookSha256: WORKBOOK_SHA });
  const importPlan = buildPersonnelMasterImportPlan(discovery, [], []);
  const rejectedPlan = buildStagingApprovalPlan(importPlan, {
    humanRejectedActionFingerprints: new Set([fingerprint]),
  });
  const rejected = rejectedPlan.proposals.find(x => x.rawName === "FATMA")!;
  assert.equal(rejected.proposedAction, "REJECT");
  assert.equal(rejected.reviewStatus, "REJECTED");
  assert.equal(rejectedPlan.summary.rejected, 1);
}

// ─── 14. No DB mutation occurs in 2D.4A: fully in-memory execution proof ──
// A minimal fake adapter — no network, no filesystem, no real database.
function makeFakeAdapter(seed: { resourcesByNormalizedName?: Record<string, number>; aliasesByNormalizedAlias?: Record<string, number>; executedFingerprints?: Set<string> } = {}) {
  const resourcesByNormalizedName = new Map(Object.entries(seed.resourcesByNormalizedName ?? {}));
  const aliasesByNormalizedAlias = new Map(Object.entries(seed.aliasesByNormalizedAlias ?? {}));
  const executedFingerprints = seed.executedFingerprints ?? new Set<string>();
  const auditLog: any[] = [];
  let nextId = 1000;

  const adapter: StagingExecutionAdapter = {
    async findResourceIdByNormalizedName(normalizedName) {
      return resourcesByNormalizedName.get(normalizedName) ?? null;
    },
    async findResourceIdByNormalizedAlias(normalizedAlias) {
      return aliasesByNormalizedAlias.get(normalizedAlias) ?? null;
    },
    async hasExecutedActionFingerprint(actionFingerprint) {
      return executedFingerprints.has(actionFingerprint);
    },
    async insertResource(data) {
      const id = nextId++;
      resourcesByNormalizedName.set(data.normalizedName, id);
      return { id };
    },
    async insertAlias(data) {
      const id = nextId++;
      aliasesByNormalizedAlias.set(data.normalizedAlias, data.resourceId);
      return { id };
    },
    async recordAudit(entry) {
      executedFingerprints.add(entry.actionFingerprint);
      auditLog.push(entry);
    },
    async runInTransaction(fn) {
      // Simplest possible transaction semantics for the fake: run fn, and
      // on any thrown error, undo what was recorded during this call.
      // Uses `this` (not the closure `adapter` const) so that a caller
      // spreading-and-overriding one method (e.g. a failing recordAudit in
      // test 19) is what actually gets passed into fn as `tx`.
      const resourcesSnapshot = new Map(resourcesByNormalizedName);
      const aliasesSnapshot = new Map(aliasesByNormalizedAlias);
      const executedSnapshot = new Set(executedFingerprints);
      const auditSnapshotLength = auditLog.length;
      try {
        return await fn(this as StagingExecutionAdapter);
      } catch (err) {
        resourcesByNormalizedName.clear();
        for (const [k, v] of resourcesSnapshot) resourcesByNormalizedName.set(k, v);
        aliasesByNormalizedAlias.clear();
        for (const [k, v] of aliasesSnapshot) aliasesByNormalizedAlias.set(k, v);
        executedFingerprints.clear();
        for (const v of executedSnapshot) executedFingerprints.add(v);
        auditLog.length = auditSnapshotLength;
        throw err;
      }
    },
  };
  return { adapter, resourcesByNormalizedName, aliasesByNormalizedAlias, executedFingerprints, auditLog };
}

function approve(proposal: StagingApprovalProposal): ApprovedStagingAction {
  return { ...proposal, approvedBy: "test-operator", approvedAt: "2026-01-01T00:00:00.000Z" };
}

{
  const p = plan([{ name: "FATMA" }]);
  const proposal = p.proposals.find(x => x.rawName === "FATMA")!;
  const { adapter, resourcesByNormalizedName, auditLog } = makeFakeAdapter();

  const result = await executeApprovedStagingAction(approve(proposal), WORKBOOK_SHA, adapter);
  assert.equal(result.status, "EXECUTED");
  if (result.status === "EXECUTED") {
    assert.equal(resourcesByNormalizedName.get(normalizePersonName("FATMA")), result.resourceId);
  }
  assert.equal(auditLog.length, 1);
  assert.equal(auditLog[0].actionFingerprint, proposal.actionFingerprint);
  assert.equal(auditLog[0].rawName, "FATMA");
}

// ─── 15. Idempotency: re-running an approved CREATE_NEW_RESOURCE is a no-op ─
{
  const p = plan([{ name: "FATMA" }]);
  const proposal = p.proposals.find(x => x.rawName === "FATMA")!;
  const { adapter } = makeFakeAdapter();

  const first = await executeApprovedStagingAction(approve(proposal), WORKBOOK_SHA, adapter);
  assert.equal(first.status, "EXECUTED");
  const second = await executeApprovedStagingAction(approve(proposal), WORKBOOK_SHA, adapter);
  assert.equal(second.status, "SKIPPED_ALREADY_EXECUTED", "the same approved action fingerprint must never be able to create a duplicate resource");
}

// ─── 16. Duplicate check by normalized_name blocks a second CREATE even without a prior fingerprint match ─
{
  const p = plan([{ name: "FATMA" }]);
  const proposal = p.proposals.find(x => x.rawName === "FATMA")!;
  const { adapter } = makeFakeAdapter({ resourcesByNormalizedName: { [normalizePersonName("FATMA")]: 555 } });
  const result = await executeApprovedStagingAction(approve(proposal), WORKBOOK_SHA, adapter);
  assert.equal(result.status, "SKIPPED_DUPLICATE_NORMALIZED_NAME");
  if (result.status === "SKIPPED_DUPLICATE_NORMALIZED_NAME") assert.equal(result.existingResourceId, 555);
}

// ─── 17. Stale-plan / fingerprint-mismatch refusal before any write ───────
{
  const p = plan([{ name: "FATMA" }], [], [], WORKBOOK_SHA);
  const proposal = p.proposals.find(x => x.rawName === "FATMA")!;
  const { adapter, auditLog } = makeFakeAdapter();

  const staleResult = await executeApprovedStagingAction(approve(proposal), WORKBOOK_SHA_CHANGED, adapter);
  assert.equal(staleResult.status, "REFUSED_STALE_PLAN");
  assert.equal(auditLog.length, 0, "a stale-plan refusal must occur before any write or audit record");

  const tampered = { ...approve(proposal), actionFingerprint: "0".repeat(64) };
  const mismatchResult = await executeApprovedStagingAction(tampered, WORKBOOK_SHA, adapter);
  assert.equal(mismatchResult.status, "REFUSED_FINGERPRINT_MISMATCH");
  assert.equal(auditLog.length, 0);
}

// ─── 18. DEFER and REJECT can never reach a write ──────────────────────────
{
  const p = plan([{ name: "TAYLAN" }]);
  const taylan = p.proposals.find(x => x.rawName === "TAYLAN")!;
  const { adapter, auditLog } = makeFakeAdapter();
  const result = await executeApprovedStagingAction(approve(taylan), WORKBOOK_SHA, adapter);
  assert.equal(result.status, "REFUSED_ACTION_NOT_EXECUTABLE");
  assert.equal(auditLog.length, 0);
}

// ─── 19. Transaction rollback: a failing write leaves no partial state ────
{
  const p = plan([{ name: "FATMA" }]);
  const proposal = p.proposals.find(x => x.rawName === "FATMA")!;
  const { adapter, resourcesByNormalizedName, auditLog } = makeFakeAdapter();
  const failingAdapter: StagingExecutionAdapter = {
    ...adapter,
    async recordAudit() {
      throw new Error("simulated audit failure");
    },
  };
  await assert.rejects(() => executeApprovedStagingAction(approve(proposal), WORKBOOK_SHA, failingAdapter));
  assert.equal(resourcesByNormalizedName.size, 0, "a failed audit write must roll back the resource insert within the same transaction");
  assert.equal(auditLog.length, 0);
}

// ─── 20. Deterministic package digest is stable even when createdAt differs ─
{
  const wb = createMockWorkbook([{ name: "FATMA" }]);
  const discovery = discoverPersonnelWorkbook(wb, { sourceFilename: "TEST-2026.xlsx", workbookFingerprint: WORKBOOK_SHA, workbookSha256: WORKBOOK_SHA });
  const importPlan = buildPersonnelMasterImportPlan(discovery, [], []);

  const planA = buildStagingApprovalPlan(importPlan, { timestamp: "2026-01-01T00:00:00.000Z" });
  const planB = buildStagingApprovalPlan(importPlan, { timestamp: "2099-12-31T23:59:59.999Z" });

  assert.notEqual(planA.createdAt, planB.createdAt, "test setup sanity check: createdAt must actually differ between the two runs");
  assert.equal(
    planA.deterministicPackageSha256,
    planB.deterministicPackageSha256,
    "deterministicPackageSha256 must be identical across regenerations of an identical plan, regardless of createdAt",
  );
  assert.equal(planA.deterministicPackageSha256.length, 64, "deterministic package digest is a sha256 hex digest");

  // The whole persisted JSON is legitimately NOT byte-identical, because
  // createdAt differs — this is the expected, non-hidden nondeterminism.
  assert.notEqual(JSON.stringify(planA), JSON.stringify(planB));

  // But every action fingerprint (which never depends on createdAt) must
  // still match exactly between the two runs.
  for (const pa of planA.proposals) {
    const pb = planB.proposals.find(x => x.rawName === pa.rawName && x.sourceSheetName === pa.sourceSheetName);
    assert.ok(pb, `matching proposal for ${pa.rawName} must exist in the second run`);
    assert.equal(pa.actionFingerprint, pb!.actionFingerprint);
  }
}

console.log("personnel-staging-execution-planner-self-test: 20 suites passed");
