/**
 * Pure, dependency-free self-test for lib/personnel-staging-cli-safety.ts.
 * No network, no database, no filesystem access, no @workspace/db import
 * anywhere in this file's dependency chain — every function under test
 * takes plain data in and returns plain data out.
 */
import assert from "node:assert/strict";
import {
  parseCliMode,
  verifyStagingTargetSafety,
  verifyPlanIntegrity,
  countProposalsByAction,
  verifyPlanActionCounts,
  DEFAULT_STAGING_TARGET_EXPECTATION,
  PHASE_2D4B_AUTHORITATIVE_EXPECTATION,
} from "./lib/personnel-staging-cli-safety";

let suites = 0;
function suite(name: string, fn: () => void) {
  fn();
  suites += 1;
}

// ─── parseCliMode ───────────────────────────────────────────────────────

suite("no flags at all => read-only preflight, never a default apply", () => {
  assert.deepEqual(parseCliMode([]), { mode: "preflight" });
});

suite("explicit --preflight => preflight", () => {
  assert.deepEqual(parseCliMode(["--preflight"]), { mode: "preflight" });
});

suite("--apply without --confirm-staging-write is reported unconfirmed, never silently treated as preflight", () => {
  const result = parseCliMode(["--apply"]);
  assert.deepEqual(result, { mode: "apply", confirmed: false });
});

suite("--apply with --confirm-staging-write is confirmed", () => {
  const result = parseCliMode(["--apply", "--confirm-staging-write"]);
  assert.deepEqual(result, { mode: "apply", confirmed: true });
});

suite("--preflight and --apply together is invalid, never silently picks one", () => {
  const result = parseCliMode(["--preflight", "--apply"]);
  assert.equal(result.mode, "invalid");
});

suite("unrelated extra args never flip preflight into apply", () => {
  const result = parseCliMode(["--plan", "/tmp/x.json", "--workbook", "book.xlsx"]);
  assert.deepEqual(result, { mode: "preflight" });
});

// ─── verifyStagingTargetSafety ──────────────────────────────────────────

suite("a genuine staging identity is accepted", () => {
  const result = verifyStagingTargetSafety({ databaseName: "neondb", hostname: "ep-cool-thing-12345.us-east-2.aws.neon.tech" });
  assert.deepEqual(result, { safe: true });
});

suite("a production-named database is rejected even if the hostname looks like staging", () => {
  const result = verifyStagingTargetSafety({ databaseName: "production", hostname: "ep-cool-thing-12345.us-east-2.aws.neon.tech" });
  assert.equal(result.safe, false);
});

suite("a production-like hostname is rejected even if the database name matches", () => {
  const result = verifyStagingTargetSafety({ databaseName: "neondb", hostname: "prod-db.internal.example.com" });
  assert.equal(result.safe, false);
});

suite("an unrecognized/unknown target (neither staging nor obviously production) is rejected, never assumed safe", () => {
  const result = verifyStagingTargetSafety({ databaseName: "some_other_db", hostname: "db.example.com" });
  assert.equal(result.safe, false);
});

suite("a wrong database name against the expected staging identity is rejected", () => {
  const result = verifyStagingTargetSafety(
    { databaseName: "wrong_db", hostname: "ep-cool-thing.neon.tech" },
    DEFAULT_STAGING_TARGET_EXPECTATION,
  );
  assert.equal(result.safe, false);
});

suite("a custom expectation can be supplied and is honored", () => {
  const custom = { expectedDatabaseName: "staging_db", expectedHostSuffix: ".internal.example.com", forbiddenIdentifierSubstrings: ["prod"] };
  const ok = verifyStagingTargetSafety({ databaseName: "staging_db", hostname: "db1.internal.example.com" }, custom);
  assert.deepEqual(ok, { safe: true });
  const bad = verifyStagingTargetSafety({ databaseName: "staging_db", hostname: "db1.other.example.com" }, custom);
  assert.equal(bad.safe, false);
});

// ─── verifyPlanIntegrity ────────────────────────────────────────────────

const goodExpectation = {
  expectedWorkbookSha256: PHASE_2D4B_AUTHORITATIVE_EXPECTATION.workbookSha256,
  expectedDeterministicPackageSha256: PHASE_2D4B_AUTHORITATIVE_EXPECTATION.deterministicPackageSha256,
};

suite("a plan matching the authoritative approved values passes integrity", () => {
  const result = verifyPlanIntegrity(
    { workbookSha256: goodExpectation.expectedWorkbookSha256, deterministicPackageSha256: goodExpectation.expectedDeterministicPackageSha256 },
    goodExpectation,
  );
  assert.deepEqual(result, { valid: true });
});

suite("a stale workbook SHA-256 is rejected", () => {
  const result = verifyPlanIntegrity(
    { workbookSha256: "0".repeat(64), deterministicPackageSha256: goodExpectation.expectedDeterministicPackageSha256 },
    goodExpectation,
  );
  assert.equal(result.valid, false);
});

suite("a stale deterministic package SHA-256 is rejected even when the workbook SHA-256 matches", () => {
  const result = verifyPlanIntegrity(
    { workbookSha256: goodExpectation.expectedWorkbookSha256, deterministicPackageSha256: "0".repeat(64) },
    goodExpectation,
  );
  assert.equal(result.valid, false);
});

// ─── countProposalsByAction / verifyPlanActionCounts ───────────────────

suite("countProposalsByAction counts every action bucket independently from the plan's own summary", () => {
  const counts = countProposalsByAction([
    { rawName: "A", proposedAction: "CREATE_NEW_RESOURCE" },
    { rawName: "B", proposedAction: "CREATE_NEW_RESOURCE" },
    { rawName: "C", proposedAction: "MATCH_EXISTING_RESOURCE" },
    { rawName: "D", proposedAction: "DEFER" },
    { rawName: "ESMA HANIM", proposedAction: "DEFER" },
  ]);
  assert.equal(counts.createNewResource, 2);
  assert.equal(counts.matchExistingResource, 1);
  assert.equal(counts.defer, 2);
  assert.equal(counts.ambiguous, 0);
  assert.equal(counts.esmaProposalCount, 1);
});

suite("verifyPlanActionCounts matches when every bucket agrees", () => {
  const expected = PHASE_2D4B_AUTHORITATIVE_EXPECTATION.planActionCounts;
  const result = verifyPlanActionCounts(expected, expected);
  assert.deepEqual(result, { matches: true });
});

suite("verifyPlanActionCounts rejects a plan whose CREATE_NEW_RESOURCE count has drifted from what was approved", () => {
  const expected = PHASE_2D4B_AUTHORITATIVE_EXPECTATION.planActionCounts;
  const actual = { ...expected, createNewResource: expected.createNewResource + 1 };
  const result = verifyPlanActionCounts(actual, expected);
  assert.equal(result.matches, false);
});

suite("verifyPlanActionCounts rejects any newly-appeared ESMA resource proposal", () => {
  const expected = PHASE_2D4B_AUTHORITATIVE_EXPECTATION.planActionCounts;
  const actual = { ...expected, esmaProposalCount: expected.esmaProposalCount + 1 };
  const result = verifyPlanActionCounts(actual, expected);
  assert.equal(result.matches, false);
});

console.log(`personnel-staging-cli-safety-self-test: ${suites} suites passed`);
