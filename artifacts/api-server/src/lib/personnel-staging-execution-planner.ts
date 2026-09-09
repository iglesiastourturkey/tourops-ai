/**
 * Personnel Master Data Staging Execution Foundation (Phase 2D.4A).
 *
 * Builds a deterministic, human-approvable staging execution plan on top of
 * the Phase 2D.3 discovery/matching output (personnel-import-parser.ts,
 * personnel-identity.ts). This module NEVER writes to a database itself in
 * Phase 2D.4A — see the "Execution mechanism" section below for what that
 * means precisely.
 *
 * Design summary
 * ──────────────
 * 1. `buildStagingApprovalPlan()` — pure function. Takes an already-built
 *    Phase 2D.3 `PersonnelImportPlan` (itself built from a read-only
 *    workbook discovery plus already-fetched staging `resources` /
 *    `resource_aliases` rows) and translates each proposal into a staging
 *    execution proposal: one of CREATE_NEW_RESOURCE, MATCH_EXISTING_RESOURCE,
 *    ADD_ALIAS, DEFER, REJECT. This function never touches a database.
 *
 * 2. Action fingerprinting — `computeActionFingerprint()` derives a
 *    deterministic SHA-256 from exactly the fields the operator specified
 *    (sourceWorkbookSha256, sourceSheetName, rawName, normalizedName,
 *    proposedAction, proposedResourceType), and nothing else — never a
 *    generated timestamp. Re-running the planner against the same workbook
 *    and the same staging resource/alias snapshot reproduces byte-identical
 *    fingerprints; a changed workbook SHA changes every fingerprint it
 *    contributes to, because sourceWorkbookSha256 is baked into the hash.
 *
 * 3. Execution mechanism (interface only, Phase 2D.4A) — `StagingExecutionAdapter`
 *    is the seam a *future*, explicitly-approved Phase 2D.4B would implement
 *    against `@workspace/db` (real transactions, real duplicate checks, real
 *    `createAuditLog` calls in strict mode). `executeApprovedStagingAction()`
 *    in this file is the orchestration logic — idempotency checks, action-
 *    fingerprint re-validation, workbook-drift refusal, transaction
 *    boundaries — written and fully unit-tested against an in-memory FAKE
 *    adapter (see personnel-staging-execution-planner-self-test.ts). No
 *    concrete database-backed adapter is wired up in this phase, and nothing
 *    in this file, the CLI built alongside it, or its tests ever opens a
 *    write transaction against a real database. That wiring, and the human
 *    approval gate in front of it, is explicitly reserved for Phase 2D.4B.
 *
 * Safety invariants carried over from Phase 2D.3 (never re-litigated here):
 *   - TAYLAN and ESMA can never produce a GUIDE action of any kind.
 *   - FF (or any REVIEW_UNKNOWN_CODE_OR_IDENTITY sheet) can never produce
 *     CREATE_NEW_RESOURCE.
 *   - GUIDE_NAME_DISPLAY_REVIEW sheets always DEFER in this phase — never
 *     auto-created, regardless of match status.
 *   - Fuzzy/substring similarity (sameWorkbookSimilarityNotes) is carried
 *     through as pure metadata; it can never influence proposedAction.
 *   - No sheet is ever auto-merged with another sheet's identity. Any
 *     REVIEW_TRUE_IDENTITY_AMBIGUITY proposal always DEFERs.
 *   - ADD_ALIAS is never produced by algorithmic similarity. It exists only
 *     for an explicit, caller-supplied human alias-approval list — mirroring
 *     the humanSuppliedAmbiguityGroups pattern from Phase 2D.3 — and is
 *     empty by default.
 */
import { createHash } from "node:crypto";
import type { PersonnelImportPlan, PersonnelImportProposal, BusinessRole } from "./personnel-import-parser";

export type StagingProposedAction =
  | "CREATE_NEW_RESOURCE"
  | "MATCH_EXISTING_RESOURCE"
  | "ADD_ALIAS"
  | "DEFER"
  | "REJECT";

/**
 * PENDING_APPROVAL: a rule-clear proposal (CREATE_NEW_RESOURCE /
 * MATCH_EXISTING_RESOURCE / ADD_ALIAS) that still requires an explicit human
 * approval before any future executor may act on it — matching classification
 * alone is never sufficient to write.
 * PENDING_REVIEW: the proposal itself is not yet a clean, actionable
 * decision (ambiguity, unknown code, unsupported personnel type, display-name
 * confirmation needed) — a human must resolve this before any action-shaped
 * proposal (e.g. a future CREATE_NEW_RESOURCE) can even be formed.
 * REJECTED: only ever set by an explicit, caller-supplied rejection — never
 * produced algorithmically.
 */
export type StagingReviewStatus = "PENDING_APPROVAL" | "PENDING_REVIEW" | "REJECTED";

export interface StagingApprovalProposal {
  sourceWorkbookSha256: string;
  sourceSheetName: string;
  sheetIndex: number;
  rawName: string;
  normalizedName: string;
  businessRole?: BusinessRole;
  proposedAction: StagingProposedAction;
  /** Set only when proposedAction implies a resource of this type (CREATE_NEW_RESOURCE / MATCH_EXISTING_RESOURCE). */
  proposedResourceType?: "GUIDE";
  /** Set only for MATCH_EXISTING_RESOURCE (and, informationally, when a display-review name happens to already match). */
  existingResourceId: number | null;
  reason: string;
  reviewStatus: StagingReviewStatus;
  /** Deterministic SHA-256 over the fields above (see computeActionFingerprint). Never derived from a timestamp. */
  actionFingerprint: string;
  /** Carried through from Phase 2D.3 for full traceability — never influences proposedAction. */
  sourceFingerprint: string;
  dataRowCount: number;
  matchStatus: PersonnelImportProposal["matchStatus"];
  sameWorkbookSimilarityNotes: PersonnelImportProposal["sameWorkbookSimilarityNotes"];
}

export interface StagingApprovalPlanSummary {
  totalSourceCandidates: number;
  existingExactMatches: number;
  existingAliasMatches: number;
  proposedNewGuideResources: number;
  displayNameReviewDeferrals: number;
  unknownDeferrals: number;
  unsupportedPersonnelDeferrals: number;
  ambiguities: number;
  informationalSimilaritySuggestions: number;
  addAliasProposals: number;
  rejected: number;
}

export interface StagingApprovalPlan {
  version: 1;
  mode: "personnel-master-staging-approval-plan";
  sourceWorkbook: string;
  workbookSha256: string;
  /** Staging identity the resources/aliases snapshot was read from — never a connection string or secret. Null when no live read occurred. */
  stagingSourceDescription: string | null;
  /**
   * Wall-clock generation time. Non-authoritative metadata ONLY — never
   * feeds computeActionFingerprint, never feeds deterministicPackageSha256,
   * and must never be relied on to compare two plans for equality. Two
   * regenerations of the identical plan will legitimately have different
   * createdAt values; compare deterministicPackageSha256 instead.
   */
  createdAt: string;
  /**
   * SHA-256 over every authoritative field in this package (version, mode,
   * sourceWorkbook, workbookSha256, stagingSourceDescription, summary,
   * proposals) — explicitly EXCLUDING createdAt and this field itself.
   * Regenerating a plan from an identical workbook + identical staging
   * snapshot must always reproduce an identical deterministicPackageSha256,
   * even though the whole persisted file's own SHA-256 will differ because
   * createdAt differs. This is the value to compare when verifying that a
   * regeneration changed nothing real.
   */
  deterministicPackageSha256: string;
  summary: StagingApprovalPlanSummary;
  proposals: StagingApprovalProposal[];
}

/**
 * Deterministic action fingerprint. Field order and separator are fixed and
 * must never change without a version bump — every future executor's
 * duplicate-check and stale-plan-refusal logic depends on reproducibility.
 * Deliberately excludes any timestamp, existingResourceId, or reason text.
 */
export function computeActionFingerprint(input: {
  sourceWorkbookSha256: string;
  sourceSheetName: string;
  rawName: string;
  normalizedName: string;
  proposedAction: StagingProposedAction;
  proposedResourceType?: string;
}): string {
  const parts = [
    input.sourceWorkbookSha256,
    input.sourceSheetName,
    input.rawName,
    input.normalizedName,
    input.proposedAction,
    input.proposedResourceType ?? "",
  ];
  return createHash("sha256").update(parts.join("::")).digest("hex");
}

/**
 * Deterministic digest of a plan's authoritative content — every field of
 * StagingApprovalPlan EXCEPT createdAt (wall-clock, non-authoritative) and
 * deterministicPackageSha256 itself. Given an identical workbook and an
 * identical staging resources/aliases snapshot, two separate calls to
 * buildStagingApprovalPlan() must always produce an identical digest here,
 * regardless of when each call ran. Object key order is fixed explicitly
 * (not left to spread/insertion order) so the digest cannot drift if the
 * StagingApprovalPlan field order is ever reshuffled later.
 */
export function computeDeterministicPackageDigest(
  plan: Omit<StagingApprovalPlan, "createdAt" | "deterministicPackageSha256">,
): string {
  const canonical = {
    version: plan.version,
    mode: plan.mode,
    sourceWorkbook: plan.sourceWorkbook,
    workbookSha256: plan.workbookSha256,
    stagingSourceDescription: plan.stagingSourceDescription,
    summary: plan.summary,
    proposals: plan.proposals,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Explicit, human-supplied alias approvals — the ONLY channel that can ever
 * produce an ADD_ALIAS proposal. Mirrors the humanSuppliedAmbiguityGroups
 * pattern from Phase 2D.3: nothing algorithmic (substring similarity,
 * fuzzy score, mononym status) may promote itself into an alias proposal.
 */
export interface HumanSuppliedAliasApproval {
  /** Raw sheet name (sourceSheet) this approval applies to. */
  rawName: string;
  targetResourceId: number;
  source: "PERFORMANCE_2026";
}

export interface BuildStagingApprovalPlanOptions {
  /** Never algorithmic — see HumanSuppliedAliasApproval. Defaults to none. */
  humanSuppliedAliasApprovals?: HumanSuppliedAliasApproval[];
  /** Explicit, caller-supplied rejections keyed by an already-computed action fingerprint. Defaults to none — REJECT is never produced automatically. */
  humanRejectedActionFingerprints?: Set<string>;
  timestamp?: string;
  /** Human-readable, secret-free description of where resources/aliases were read from (e.g. a redacted host, or "NONE_SUPPLIED"). */
  stagingSourceDescription?: string | null;
}

function translateProposal(
  p: PersonnelImportProposal,
  aliasApprovalsByRawName: Map<string, HumanSuppliedAliasApproval>,
): Omit<StagingApprovalProposal, "actionFingerprint"> {
  const base = {
    sourceWorkbookSha256: p.sourceWorkbookSha256,
    sourceSheetName: p.sourceSheet,
    sheetIndex: p.sheetIndex,
    rawName: p.rawName,
    normalizedName: p.normalizedName,
    sourceFingerprint: p.sourceFingerprint,
    dataRowCount: p.dataRowCount,
    matchStatus: p.matchStatus,
    sameWorkbookSimilarityNotes: p.sameWorkbookSimilarityNotes,
  };

  // NON_GUIDE_PERSONNEL (TAYLAN = ACCOUNTING_PERSONNEL, ESMA = OPERATIONS_PERSONNEL,
  // when an actual ESMA worksheet exists): always DEFER, never a GUIDE action,
  // regardless of matchStatus. This is a hard rule, not a heuristic.
  if (p.businessBucket === "NON_GUIDE_PERSONNEL") {
    return {
      ...base,
      businessRole: p.businessRole,
      proposedAction: "DEFER",
      proposedResourceType: undefined,
      existingResourceId: null,
      reason: `${p.reason} Deferred in Phase 2D.4A: ${p.businessRole} personnel can never produce a GUIDE action.`,
      reviewStatus: "PENDING_REVIEW",
    };
  }

  // REVIEW_UNKNOWN_CODE_OR_IDENTITY (e.g. FF): always DEFER, never CREATE_NEW_RESOURCE.
  if (p.businessBucket === "REVIEW_UNKNOWN_CODE_OR_IDENTITY") {
    return {
      ...base,
      proposedAction: "DEFER",
      proposedResourceType: undefined,
      existingResourceId: null,
      reason: `${p.reason} Deferred in Phase 2D.4A: unexplained code-like identifiers can never auto-produce a resource proposal.`,
      reviewStatus: "PENDING_REVIEW",
    };
  }

  // REVIEW_TRUE_IDENTITY_AMBIGUITY: always DEFER. Never auto-merged, never picked.
  if (p.businessBucket === "REVIEW_TRUE_IDENTITY_AMBIGUITY") {
    return {
      ...base,
      proposedAction: "DEFER",
      proposedResourceType: undefined,
      existingResourceId: null,
      reason: `${p.reason} Deferred in Phase 2D.4A pending explicit human disambiguation.`,
      reviewStatus: "PENDING_REVIEW",
    };
  }

  // GUIDE_NAME_DISPLAY_REVIEW: always DEFER by default in 2D.4A, per explicit
  // operator instruction — even if matchStatus would otherwise be a clean
  // EXACT_MATCH/ALIAS_MATCH/UNMATCHED. rawName is preserved exactly; nothing
  // here rewrites or completes it.
  if (p.businessBucket === "GUIDE_NAME_DISPLAY_REVIEW") {
    return {
      ...base,
      proposedAction: "DEFER",
      proposedResourceType: "GUIDE",
      existingResourceId: p.matchedResourceId ?? null,
      reason: `${p.reason} Deferred by default in Phase 2D.4A: honorific/abbreviated display-name forms require human confirmation before any CREATE or MATCH action is taken.`,
      reviewStatus: "PENDING_REVIEW",
    };
  }

  // CLEAN_GUIDE_CANDIDATE: the only bucket eligible for CREATE_NEW_RESOURCE
  // or MATCH_EXISTING_RESOURCE. matchStatus AMBIGUOUS should not occur here
  // (the Phase 2D.3 parser routes AMBIGUOUS to REVIEW_TRUE_IDENTITY_AMBIGUITY
  // instead), but the branch below defends against it anyway.
  if (p.matchStatus === "EXACT_MATCH" || p.matchStatus === "ALIAS_MATCH") {
    return {
      ...base,
      proposedAction: "MATCH_EXISTING_RESOURCE",
      proposedResourceType: "GUIDE",
      existingResourceId: p.matchedResourceId ?? null,
      reason: `${p.reason} Proposed for staging approval in Phase 2D.4A — matching only, no write occurs until explicitly approved.`,
      reviewStatus: "PENDING_APPROVAL",
    };
  }

  if (p.matchStatus === "AMBIGUOUS") {
    // Defensive: should be unreachable given Phase 2D.3's own routing, but
    // ambiguity must never fall through to CREATE_NEW_RESOURCE by accident.
    return {
      ...base,
      proposedAction: "DEFER",
      proposedResourceType: undefined,
      existingResourceId: null,
      reason: `${p.reason} Deferred: ambiguous match must never auto-create or auto-pick a resource.`,
      reviewStatus: "PENDING_REVIEW",
    };
  }

  // UNMATCHED clean guide candidate. Check for an explicit, human-supplied
  // alias approval first — this is the ONLY way ADD_ALIAS can ever appear.
  const aliasApproval = aliasApprovalsByRawName.get(p.rawName);
  if (aliasApproval) {
    return {
      ...base,
      proposedAction: "ADD_ALIAS",
      proposedResourceType: "GUIDE",
      existingResourceId: aliasApproval.targetResourceId,
      reason: `Explicit human-supplied alias approval: '${p.rawName}' recorded as a ${aliasApproval.source} alias of resource ${aliasApproval.targetResourceId}. Not inferred from similarity.`,
      reviewStatus: "PENDING_APPROVAL",
    };
  }

  return {
    ...base,
    proposedAction: "CREATE_NEW_RESOURCE",
    proposedResourceType: "GUIDE",
    existingResourceId: null,
    reason: `${p.reason} Proposed for staging approval in Phase 2D.4A — no write occurs until explicitly approved.`,
    reviewStatus: "PENDING_APPROVAL",
  };
}

export function buildStagingApprovalPlan(
  importPlan: PersonnelImportPlan,
  options: BuildStagingApprovalPlanOptions = {},
): StagingApprovalPlan {
  const aliasApprovalsByRawName = new Map(
    (options.humanSuppliedAliasApprovals ?? []).map(a => [a.rawName, a] as const),
  );
  const rejectedFingerprints = options.humanRejectedActionFingerprints ?? new Set<string>();

  const proposals: StagingApprovalProposal[] = importPlan.proposals.map(p => {
    const translated = translateProposal(p, aliasApprovalsByRawName);
    const actionFingerprint = computeActionFingerprint({
      sourceWorkbookSha256: translated.sourceWorkbookSha256,
      sourceSheetName: translated.sourceSheetName,
      rawName: translated.rawName,
      normalizedName: translated.normalizedName,
      proposedAction: translated.proposedAction,
      proposedResourceType: translated.proposedResourceType,
    });

    if (rejectedFingerprints.has(actionFingerprint)) {
      return {
        ...translated,
        proposedAction: "REJECT" as const,
        reason: `${translated.reason} Explicitly rejected by human approval decision (fingerprint ${actionFingerprint}).`,
        reviewStatus: "REJECTED" as const,
        actionFingerprint,
      };
    }

    return { ...translated, actionFingerprint };
  });

  const summary: StagingApprovalPlanSummary = {
    totalSourceCandidates: proposals.length,
    existingExactMatches: proposals.filter(p => p.matchStatus === "EXACT_MATCH" && p.proposedAction === "MATCH_EXISTING_RESOURCE").length,
    existingAliasMatches: proposals.filter(p => p.matchStatus === "ALIAS_MATCH" && p.proposedAction === "MATCH_EXISTING_RESOURCE").length,
    proposedNewGuideResources: proposals.filter(p => p.proposedAction === "CREATE_NEW_RESOURCE").length,
    displayNameReviewDeferrals: proposals.filter(p => p.proposedAction === "DEFER" && p.proposedResourceType === "GUIDE").length,
    unknownDeferrals: proposals.filter(p => p.proposedAction === "DEFER" && p.businessRole === undefined && p.proposedResourceType === undefined && /unexplained code-like/i.test(p.reason)).length,
    unsupportedPersonnelDeferrals: proposals.filter(p => p.proposedAction === "DEFER" && p.businessRole !== undefined).length,
    ambiguities: proposals.filter(p => p.matchStatus === "AMBIGUOUS" || /identity ambiguity|ambiguous/i.test(p.reason)).length,
    informationalSimilaritySuggestions: proposals.reduce((sum, p) => sum + p.sameWorkbookSimilarityNotes.length, 0),
    addAliasProposals: proposals.filter(p => p.proposedAction === "ADD_ALIAS").length,
    rejected: proposals.filter(p => p.proposedAction === "REJECT").length,
  };

  const corePlan = {
    version: 1 as const,
    mode: "personnel-master-staging-approval-plan" as const,
    sourceWorkbook: importPlan.sourceWorkbook,
    workbookSha256: importPlan.workbookSha256,
    stagingSourceDescription: options.stagingSourceDescription ?? null,
    summary,
    proposals,
  };

  return {
    ...corePlan,
    createdAt: options.timestamp ?? new Date().toISOString(),
    deterministicPackageSha256: computeDeterministicPackageDigest(corePlan),
  };
}

/**
 * Refuses a plan whose workbookSha256 no longer matches the workbook the
 * caller is about to act against. This is the first check a future 2D.4B
 * executor must run before touching anything else — every action fingerprint
 * in a stale plan is definitionally wrong once the source has changed.
 */
export function validatePlanAgainstCurrentWorkbook(
  plan: StagingApprovalPlan,
  currentWorkbookSha256: string,
): { valid: true } | { valid: false; reason: string } {
  if (plan.workbookSha256 !== currentWorkbookSha256) {
    return {
      valid: false,
      reason: `Stale plan: plan.workbookSha256 (${plan.workbookSha256}) does not match the current workbook (${currentWorkbookSha256}). Refusing to execute — regenerate the plan.`,
    };
  }
  return { valid: true };
}

// ─── Execution mechanism (interface + orchestration only — Phase 2D.4A) ───
//
// StagingExecutionAdapter is the seam a future, explicitly-approved Phase
// 2D.4B implementation would provide, backed by @workspace/db (real
// transactions, real duplicate checks against `resources` / `resource_aliases`,
// real createAuditLog calls run in strict mode via the open transaction — see
// lib/audit.ts's `executor` parameter). No adapter implementation touching a
// real database exists anywhere in this phase; only an in-memory fake adapter
// is ever constructed, and only inside personnel-staging-execution-planner-self-test.ts.
export interface StagingExecutionAdapter {
  /** Duplicate check #1: exact normalized_name already present for this resource type. */
  findResourceIdByNormalizedName(normalizedName: string, type: "GUIDE" | "DRIVER"): Promise<number | null>;
  /** Duplicate check #2: this normalized alias is already recorded against some resource. */
  findResourceIdByNormalizedAlias(normalizedAlias: string): Promise<number | null>;
  /** Duplicate check #3 (source fingerprint / re-run safety): has this exact action fingerprint already been executed and audit-logged? */
  hasExecutedActionFingerprint(actionFingerprint: string): Promise<boolean>;
  /** Resource write. Must occur inside the same transaction as the audit write. */
  insertResource(data: { type: "GUIDE"; name: string; normalizedName: string; active: true }): Promise<{ id: number }>;
  /** Alias write (ADD_ALIAS only). Must occur inside the same transaction as the audit write. */
  insertAlias(data: { resourceId: number; source: "PERFORMANCE_2026"; alias: string; normalizedAlias: string }): Promise<{ id: number }>;
  /** Audit write — expected to be backed by createAuditLog(params, tx) in strict mode (see lib/audit.ts). Must occur inside the same transaction as the resource/alias write. */
  recordAudit(entry: StagingExecutionAuditEntry): Promise<void>;
  /**
   * Runs `fn` inside one database transaction (action-level, per operator
   * instruction — "prefer action-level transactions unless there is a
   * strong reason for one giant transaction"). Any thrown error must roll
   * the whole transaction back; nothing partial may be committed.
   */
  runInTransaction<T>(fn: (tx: StagingExecutionAdapter) => Promise<T>): Promise<T>;
}

export interface StagingExecutionAuditEntry {
  actor: string;
  action: StagingProposedAction;
  resourceId: number | null;
  sourceWorkbookSha256: string;
  sourceSheetName: string;
  rawName: string;
  normalizedName: string;
  approvedAction: StagingProposedAction;
  actionFingerprint: string;
  timestamp: string;
}

export type StagingExecutionResult =
  | { status: "EXECUTED"; resourceId: number; auditRecorded: true }
  | { status: "SKIPPED_DUPLICATE_NORMALIZED_NAME"; existingResourceId: number }
  | { status: "SKIPPED_DUPLICATE_ALIAS"; existingResourceId: number }
  | { status: "SKIPPED_ALREADY_EXECUTED"; actionFingerprint: string }
  | { status: "REFUSED_STALE_PLAN"; reason: string }
  | { status: "REFUSED_FINGERPRINT_MISMATCH"; expected: string; recomputed: string }
  | { status: "REFUSED_ACTION_NOT_EXECUTABLE"; proposedAction: StagingProposedAction };

/**
 * A human-approved action ready for a future executor. `approvedBy` and
 * `approvedAt` only ever exist once a human has explicitly signed off — this
 * type is never constructed by buildStagingApprovalPlan() itself.
 */
export interface ApprovedStagingAction extends StagingApprovalProposal {
  approvedBy: string;
  approvedAt: string;
}

/**
 * Orchestration logic for executing exactly one approved action. This
 * function is fully exercised in tests against an in-memory fake adapter —
 * see personnel-staging-execution-planner-self-test.ts. It is never called
 * with a real database-backed adapter anywhere in Phase 2D.4A.
 *
 * Order of operations (all four checks run before any write):
 *   1. Refuse if the workbook has drifted since the plan was generated.
 *   2. Refuse if the action's own fingerprint doesn't match a freshly
 *      recomputed one (protects against a tampered/edited approval record).
 *   3. Refuse if proposedAction isn't one of the three executable actions
 *      (CREATE_NEW_RESOURCE / MATCH_EXISTING_RESOURCE / ADD_ALIAS) — DEFER
 *      and REJECT can never reach a write.
 *   4. Inside one transaction: duplicate-check by normalized_name, by
 *      alias, and by action-fingerprint re-run; skip (no-op, not an error)
 *      if any duplicate is found; otherwise write + audit atomically.
 */
export async function executeApprovedStagingAction(
  action: ApprovedStagingAction,
  currentWorkbookSha256: string,
  adapter: StagingExecutionAdapter,
): Promise<StagingExecutionResult> {
  if (action.sourceWorkbookSha256 !== currentWorkbookSha256) {
    return {
      status: "REFUSED_STALE_PLAN",
      reason: `Workbook drift: action was generated against ${action.sourceWorkbookSha256}, current workbook is ${currentWorkbookSha256}.`,
    };
  }

  const recomputed = computeActionFingerprint({
    sourceWorkbookSha256: action.sourceWorkbookSha256,
    sourceSheetName: action.sourceSheetName,
    rawName: action.rawName,
    normalizedName: action.normalizedName,
    proposedAction: action.proposedAction,
    proposedResourceType: action.proposedResourceType,
  });
  if (recomputed !== action.actionFingerprint) {
    return { status: "REFUSED_FINGERPRINT_MISMATCH", expected: action.actionFingerprint, recomputed };
  }

  if (action.proposedAction !== "CREATE_NEW_RESOURCE" && action.proposedAction !== "MATCH_EXISTING_RESOURCE" && action.proposedAction !== "ADD_ALIAS") {
    return { status: "REFUSED_ACTION_NOT_EXECUTABLE", proposedAction: action.proposedAction };
  }

  return adapter.runInTransaction(async tx => {
    const alreadyExecuted = await tx.hasExecutedActionFingerprint(action.actionFingerprint);
    if (alreadyExecuted) {
      return { status: "SKIPPED_ALREADY_EXECUTED", actionFingerprint: action.actionFingerprint };
    }

    if (action.proposedAction === "CREATE_NEW_RESOURCE") {
      const existingByName = await tx.findResourceIdByNormalizedName(action.normalizedName, "GUIDE");
      if (existingByName != null) {
        return { status: "SKIPPED_DUPLICATE_NORMALIZED_NAME", existingResourceId: existingByName };
      }
      const existingByAlias = await tx.findResourceIdByNormalizedAlias(action.normalizedName);
      if (existingByAlias != null) {
        return { status: "SKIPPED_DUPLICATE_ALIAS", existingResourceId: existingByAlias };
      }

      const created = await tx.insertResource({
        type: "GUIDE",
        name: action.rawName,
        normalizedName: action.normalizedName,
        active: true,
      });
      await tx.recordAudit({
        actor: action.approvedBy,
        action: action.proposedAction,
        resourceId: created.id,
        sourceWorkbookSha256: action.sourceWorkbookSha256,
        sourceSheetName: action.sourceSheetName,
        rawName: action.rawName,
        normalizedName: action.normalizedName,
        approvedAction: action.proposedAction,
        actionFingerprint: action.actionFingerprint,
        timestamp: action.approvedAt,
      });
      return { status: "EXECUTED", resourceId: created.id, auditRecorded: true };
    }

    if (action.proposedAction === "MATCH_EXISTING_RESOURCE") {
      // Matching never creates or mutates a resource row — it only records
      // the audit trail of the human-approved link. existingResourceId is
      // required for this action by construction (see translateProposal).
      const resourceId = action.existingResourceId as number;
      await tx.recordAudit({
        actor: action.approvedBy,
        action: action.proposedAction,
        resourceId,
        sourceWorkbookSha256: action.sourceWorkbookSha256,
        sourceSheetName: action.sourceSheetName,
        rawName: action.rawName,
        normalizedName: action.normalizedName,
        approvedAction: action.proposedAction,
        actionFingerprint: action.actionFingerprint,
        timestamp: action.approvedAt,
      });
      return { status: "EXECUTED", resourceId, auditRecorded: true };
    }

    // ADD_ALIAS
    const targetResourceId = action.existingResourceId as number;
    const existingByAlias = await tx.findResourceIdByNormalizedAlias(action.normalizedName);
    if (existingByAlias != null) {
      return { status: "SKIPPED_DUPLICATE_ALIAS", existingResourceId: existingByAlias };
    }
    await tx.insertAlias({
      resourceId: targetResourceId,
      source: "PERFORMANCE_2026",
      alias: action.rawName,
      normalizedAlias: action.normalizedName,
    });
    await tx.recordAudit({
      actor: action.approvedBy,
      action: action.proposedAction,
      resourceId: targetResourceId,
      sourceWorkbookSha256: action.sourceWorkbookSha256,
      sourceSheetName: action.sourceSheetName,
      rawName: action.rawName,
      normalizedName: action.normalizedName,
      approvedAction: action.proposedAction,
      actionFingerprint: action.actionFingerprint,
      timestamp: action.approvedAt,
    });
    return { status: "EXECUTED", resourceId: targetResourceId, auditRecorded: true };
  });
}
