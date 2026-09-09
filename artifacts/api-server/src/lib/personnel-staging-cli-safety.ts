/**
 * Pure, DB-free safety logic for the Phase 2D.4B staging CLI
 * (personnel-staging-apply.ts). Deliberately kept in its own module with
 * zero imports from @workspace/db or any network-touching code, so every
 * rule here is unit-testable with no database and no network access — see
 * personnel-staging-cli-safety-self-test.ts. The CLI itself is the only
 * place that feeds these functions real, live values.
 */

// ─── CLI mode parsing — default behavior MUST NOT write ───────────────────

export type CliMode =
  | { mode: "preflight" }
  | { mode: "apply"; confirmed: boolean }
  | { mode: "invalid"; reason: string };

/**
 * No mode, or an explicit --preflight, both resolve to read-only preflight.
 * The CLI must never default to apply. --apply additionally requires
 * --confirm-staging-write before any write may occur; parseCliMode never
 * decides that on its own — it only reports whether the flag was present,
 * so the caller (personnel-staging-apply.ts) is the single place that acts
 * on it and can be reviewed in one place.
 */
export function parseCliMode(args: string[]): CliMode {
  const hasPreflight = args.includes("--preflight");
  const hasApply = args.includes("--apply");
  if (hasPreflight && hasApply) {
    return { mode: "invalid", reason: "--preflight and --apply are mutually exclusive; pass exactly one." };
  }
  if (hasApply) {
    return { mode: "apply", confirmed: args.includes("--confirm-staging-write") };
  }
  return { mode: "preflight" };
}

// ─── Target safety — never trust a bare "is this staging" boolean ─────────

export interface DatabaseIdentityFacts {
  /** From a live `SELECT current_database()` against the connection actually in use — proves connectivity, not just configuration. */
  databaseName: string;
  /** Connection hostname only — never the full connection string, username, or password. */
  hostname: string;
}

export interface StagingTargetExpectation {
  expectedDatabaseName: string;
  /** Hostname must end with this suffix (case-insensitive), e.g. ".neon.tech". */
  expectedHostSuffix: string;
  /** Case-insensitive substrings that, if found ANYWHERE in databaseName or hostname, always abort — belt-and-suspenders against ever touching anything that looks like production, independent of the positive match below. */
  forbiddenIdentifierSubstrings: string[];
}

export const DEFAULT_STAGING_TARGET_EXPECTATION: StagingTargetExpectation = {
  expectedDatabaseName: "neondb",
  expectedHostSuffix: ".neon.tech",
  forbiddenIdentifierSubstrings: ["prod", "production", "live"],
};

export type TargetSafetyResult = { safe: true } | { safe: false; reason: string };

/**
 * Positively verify the connected database looks like the expected staging
 * target. This never trusts a bare "is this staging" flag — it compares
 * live session identity facts (current_database(), the connection
 * hostname) against an explicit expectation, and separately refuses
 * outright if anything resembling a production identifier is present
 * anywhere in those facts, even if the positive match would otherwise
 * pass. If staging identity cannot be positively established by this
 * function, the caller must abort — there is no other authority to fall
 * back to.
 */
export function verifyStagingTargetSafety(
  facts: DatabaseIdentityFacts,
  expectation: StagingTargetExpectation = DEFAULT_STAGING_TARGET_EXPECTATION,
): TargetSafetyResult {
  const haystack = `${facts.databaseName} ${facts.hostname}`.toLowerCase();
  for (const forbidden of expectation.forbiddenIdentifierSubstrings) {
    if (haystack.includes(forbidden.toLowerCase())) {
      return {
        safe: false,
        reason: `Refusing: identity contains a production-like substring ("${forbidden}"). database=${facts.databaseName} host=${facts.hostname}`,
      };
    }
  }
  if (facts.databaseName !== expectation.expectedDatabaseName) {
    return {
      safe: false,
      reason: `Refusing: current_database() is "${facts.databaseName}", expected "${expectation.expectedDatabaseName}". Staging identity could not be positively established.`,
    };
  }
  if (!facts.hostname.toLowerCase().endsWith(expectation.expectedHostSuffix.toLowerCase())) {
    return {
      safe: false,
      reason: `Refusing: connection hostname "${facts.hostname}" does not end with the expected staging suffix "${expectation.expectedHostSuffix}". Staging identity could not be positively established.`,
    };
  }
  return { safe: true };
}

// ─── Plan integrity — catch a stale or substituted approval package ───────

export interface PlanIntegrityExpectation {
  expectedWorkbookSha256: string;
  expectedDeterministicPackageSha256: string;
}

export type PlanIntegrityResult = { valid: true } | { valid: false; reason: string };

/**
 * Compares the loaded approval plan's own workbookSha256 and
 * deterministicPackageSha256 against the authoritative values the operator
 * approved. This catches "wrong file was loaded" and "plan was
 * regenerated/edited since approval" before a single row is touched — it
 * is deliberately independent of, and in addition to, the live per-action
 * fingerprint re-verification already built into
 * executeApprovedStagingAction() in personnel-staging-execution-planner.ts.
 */
export function verifyPlanIntegrity(
  plan: { workbookSha256: string; deterministicPackageSha256: string },
  expectation: PlanIntegrityExpectation,
): PlanIntegrityResult {
  if (plan.workbookSha256 !== expectation.expectedWorkbookSha256) {
    return {
      valid: false,
      reason: `Stale plan: workbookSha256 is ${plan.workbookSha256}, expected ${expectation.expectedWorkbookSha256}.`,
    };
  }
  if (plan.deterministicPackageSha256 !== expectation.expectedDeterministicPackageSha256) {
    return {
      valid: false,
      reason: `Stale plan: deterministicPackageSha256 is ${plan.deterministicPackageSha256}, expected ${expectation.expectedDeterministicPackageSha256}.`,
    };
  }
  return { valid: true };
}

// ─── Plan summary/classification check — catch the wrong plan entirely ────

export interface PlanProposalLike {
  rawName: string;
  proposedAction: string;
}

export interface PlanActionCounts {
  createNewResource: number;
  matchExistingResource: number;
  defer: number;
  ambiguous: number;
  esmaProposalCount: number;
}

export interface PlanActionCountsExpectation {
  createNewResource: number;
  matchExistingResource: number;
  defer: number;
  ambiguous: number;
  esmaProposalCount: number;
}

/**
 * Counts proposals directly by proposedAction, plus a hard scan for any
 * proposal whose rawName mentions ESMA — deliberately not derived from the
 * plan's own `summary` object (which is a convenience aggregate computed
 * at plan-build time, not a substitute for independently re-checking the
 * actual proposals array the CLI is about to act on).
 */
export function countProposalsByAction(proposals: PlanProposalLike[]): PlanActionCounts {
  return {
    createNewResource: proposals.filter(p => p.proposedAction === "CREATE_NEW_RESOURCE").length,
    matchExistingResource: proposals.filter(p => p.proposedAction === "MATCH_EXISTING_RESOURCE").length,
    defer: proposals.filter(p => p.proposedAction === "DEFER").length,
    ambiguous: proposals.filter(p => /ambiguous/i.test(p.proposedAction)).length,
    esmaProposalCount: proposals.filter(p => p.rawName.toUpperCase().includes("ESMA")).length,
  };
}

export type PlanCountsResult = { matches: true } | { matches: false; reason: string };

export function verifyPlanActionCounts(
  actual: PlanActionCounts,
  expected: PlanActionCountsExpectation,
): PlanCountsResult {
  const mismatches: string[] = [];
  if (actual.createNewResource !== expected.createNewResource) {
    mismatches.push(`CREATE_NEW_RESOURCE: got ${actual.createNewResource}, expected ${expected.createNewResource}`);
  }
  if (actual.matchExistingResource !== expected.matchExistingResource) {
    mismatches.push(`MATCH_EXISTING_RESOURCE: got ${actual.matchExistingResource}, expected ${expected.matchExistingResource}`);
  }
  if (actual.defer !== expected.defer) {
    mismatches.push(`DEFER: got ${actual.defer}, expected ${expected.defer}`);
  }
  if (actual.ambiguous !== expected.ambiguous) {
    mismatches.push(`AMBIGUOUS: got ${actual.ambiguous}, expected ${expected.ambiguous}`);
  }
  if (actual.esmaProposalCount !== expected.esmaProposalCount) {
    mismatches.push(`ESMA proposals: got ${actual.esmaProposalCount}, expected ${expected.esmaProposalCount}`);
  }
  if (mismatches.length > 0) {
    return { matches: false, reason: `Loaded plan's classification does not match the approved plan: ${mismatches.join("; ")}` };
  }
  return { matches: true };
}

/** The exact values the operator approved for Phase 2D.4B. */
export const PHASE_2D4B_AUTHORITATIVE_EXPECTATION = {
  workbookSha256: "69301eb4dbca3d7583b06c55a2fe4b7aaffaf4ec47034043af55bec076fe82d3",
  deterministicPackageSha256: "341cf6814a5a5d3de2a9a997b22580e9a0173bd44f210b8a3e5766e1c9d91067",
  planActionCounts: {
    createNewResource: 81,
    matchExistingResource: 0,
    defer: 5,
    ambiguous: 0,
    esmaProposalCount: 0,
  } satisfies PlanActionCountsExpectation,
} as const;
