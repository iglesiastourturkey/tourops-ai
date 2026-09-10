import assert from "node:assert/strict";
import {
  BACKFILL_UPDATE_SQL,
  classifyBackfillRows,
  validateBackfillPlanTarget,
} from "./historical-operation-domain-backfill-plan";

// ── Pure projection ────────────────────────────────────────────────────────
const clean = classifyBackfillRows([
  { operationId: 1, sourceKind: "gemi", currentOperationType: null },
  { operationId: 2, sourceKind: "gemi", currentOperationType: null },
  { operationId: 3, sourceKind: "sejour", currentOperationType: null },
  { operationId: 4, sourceKind: "gemi", currentOperationType: "CRUISE" },
]);
assert.equal(clean.databaseWrites, false);
assert.equal(clean.promotedHistoricalOperations, 4);
assert.deepEqual(clean.projected, { CRUISE: 3, SEJOUR: 1 });
assert.equal(clean.wouldUpdate, 3);
assert.equal(clean.alreadyClassifiedMatching, 1);
assert.deepEqual(clean.conflicts, []);
assert.deepEqual(clean.unclassifiableSourceKinds, []);
assert.equal(clean.recommendedSql, BACKFILL_UPDATE_SQL);

// A row already classified the OTHER way is a conflict, never silently overwritten.
const conflicting = classifyBackfillRows([
  { operationId: 9, sourceKind: "sejour", currentOperationType: "CRUISE" },
]);
assert.equal(conflicting.wouldUpdate, 0);
assert.equal(conflicting.conflicts.length, 1);
assert.deepEqual(conflicting.conflicts[0], {
  operationId: 9, sourceKind: "sejour", currentOperationType: "CRUISE", projected: "SEJOUR",
});

// An unknown source_kind fails closed — it is reported, never guessed.
const unknown = classifyBackfillRows([
  { operationId: 10, sourceKind: "", currentOperationType: null },
  { operationId: 11, sourceKind: "transfer", currentOperationType: null },
]);
assert.equal(unknown.wouldUpdate, 0);
assert.deepEqual(unknown.projected, { CRUISE: 0, SEJOUR: 0 });
assert.equal(unknown.unclassifiableSourceKinds.length, 2);

// Orphan count is passed through untouched for owner review.
assert.equal(classifyBackfillRows([], 7).orphanHistoricalOperations, 7);

// The recommended statement is additive-only and idempotent (guarded by
// `operation_type IS NULL`), and never deletes or drops.
assert.match(BACKFILL_UPDATE_SQL, /operation_type IS NULL/);
assert.match(BACKFILL_UPDATE_SQL, /h\.status = 'imported'/);
assert.ok(!/DROP |DELETE |TRUNCATE /i.test(BACKFILL_UPDATE_SQL));

// ── Target guard: read-only, staging-only, Neon-only ───────────────────────
assert.throws(() => validateBackfillPlanTarget({ NODE_ENV: "production" } as NodeJS.ProcessEnv), /Production/);
assert.throws(() => validateBackfillPlanTarget({} as NodeJS.ProcessEnv), /HISTORICAL_STAGING_DATABASE_URL/);
assert.throws(() => validateBackfillPlanTarget({
  HISTORICAL_STAGING_DATABASE_URL: "postgres://u:p@evil.example.com/db",
  HISTORICAL_STAGING_DATABASE_HOST: "evil.example.com",
} as NodeJS.ProcessEnv), /Neon/);
assert.equal(
  validateBackfillPlanTarget({
    HISTORICAL_STAGING_DATABASE_URL: "postgres://u:p@staging-abc.neon.tech/db",
    HISTORICAL_STAGING_DATABASE_HOST: "staging-abc.neon.tech",
  } as NodeJS.ProcessEnv),
  "postgres://u:p@staging-abc.neon.tech/db",
);

console.log("historical operation domain backfill plan self-test: ok");
