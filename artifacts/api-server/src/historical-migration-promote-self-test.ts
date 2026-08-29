import assert from "node:assert/strict";
import {
  buildPromotionProjectionFromExisting,
  buildPromotionProjectionFromStaging,
  decidePromotionOutcome,
  historicalImportTransitionBlock,
  sha256OfProjection,
  verifyStagedPayloadIntegrity,
} from "./lib/historical-migration-promote-validation";
import { parseArgs, MAX_APPLY_LIMIT } from "./historical-migration-promote";
import { buildHistoricalStageRows, parseHistoricalStagingPackage } from "./lib/historical-migration-stage-validation";

// ── State machine ────────────────────────────────────────────────────────────

assert.equal(historicalImportTransitionBlock("approve", "pending"), null);
assert.equal(historicalImportTransitionBlock("reject", "pending"), null);
assert.equal(historicalImportTransitionBlock("promote", "approved"), null);

assert.ok(historicalImportTransitionBlock("promote", "pending"), "pending -> imported must be blocked");
assert.ok(historicalImportTransitionBlock("promote", "rejected"), "rejected -> imported must be blocked");
assert.ok(historicalImportTransitionBlock("approve", "imported"), "imported -> approved must be blocked");
assert.ok(historicalImportTransitionBlock("reject", "imported"), "imported -> rejected must be blocked");
assert.ok(historicalImportTransitionBlock("approve", "approved"), "approved -> approved must be blocked (no double-approve)");
assert.ok(historicalImportTransitionBlock("reject", "approved"), "approved -> rejected must be blocked");
assert.ok(historicalImportTransitionBlock("promote", "imported"), "imported cannot be promoted again as new");

// ── Payload integrity ─────────────────────────────────────────────────────────

const stagingRecord = {
  idempotencyKey: "legacy:file-1:01:3",
  requiresHumanApproval: true as const,
  provenance: { sourceFileId: "file-1", sourceKind: "gemi" as const, worksheetName: "01", sourceRow: 3 },
  customer: { fullName: "TEST CUSTOMER" },
  operation: {
    sourceType: "historical_legacy" as const,
    sourceBookingReference: null,
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    pickupTime: null,
    notes: null,
  },
  reservationDetails: {
    adultCount: 2,
    childCount: null,
    passengerLanguage: "ING",
    tourType: "PVT" as const,
    itineraryRaw: "PRIVATE EPHESUS TOUR",
    pickupPoint: "KUS LIMAN",
    externalSource: null,
    externalOperator: "IGLESIAS",
    collectionStatusRaw: null,
  },
  warnings: ["missing_agency", "missing_child_count", "missing_pickup_time"] as const,
};
const stagingPackage = parseHistoricalStagingPackage({
  version: 1 as const,
  policyVersion: "phase3b-2026-v1" as const,
  generatedAt: "2026-08-26T00:00:00.000Z",
  sourceReportGeneratedAt: "2026-08-26T00:00:00.000Z",
  databaseWrites: false as const,
  driveWrites: false as const,
  requiresImportApproval: true as const,
  records: [stagingRecord],
});
const stagedRow = buildHistoricalStageRows(stagingPackage)[0];
assert.ok(stagedRow);

assert.equal(verifyStagedPayloadIntegrity(stagedRow), true, "unmodified payload must verify against its own hash");
assert.equal(
  verifyStagedPayloadIntegrity({ ...stagedRow, payload: { ...stagedRow.payload, customer: { fullName: "TAMPERED" } } }),
  false,
  "a payload modified after Faz 3C staging must fail integrity verification",
);

// ── Canonical projection + hash determinism ───────────────────────────────────

const target = buildPromotionProjectionFromStaging(stagedRow.sourceKey, stagedRow.payload);
assert.equal(target.operation.sourceHistoricalKey, stagedRow.sourceKey);
assert.equal(target.operation.customerId, null, "Faz 3D-A must never assign a customer");
assert.equal(target.operation.tourId, null);
assert.equal(target.operation.portCallId, null);
assert.equal(target.operation.tourProductId, null);
assert.equal(target.operation.guideResourceId, null);
assert.equal(target.operation.driverResourceId, null);
assert.equal(target.operation.vehicleId, null);
assert.equal(target.reservationDetails.netAmount, null, "Faz 3D-A must never invent a financial figure");
assert.equal(target.reservationDetails.advanceAmount, null);
assert.equal(target.reservationDetails.currency, null);
assert.equal(target.reservationDetails.childCount, null, "blank child count must be preserved as null, never invented");

const targetHash = sha256OfProjection(target);
assert.match(targetHash, /^[0-9a-f]{64}$/);
assert.equal(
  sha256OfProjection(buildPromotionProjectionFromStaging(stagedRow.sourceKey, stagedRow.payload)),
  targetHash,
  "projection hash must be deterministic for identical input",
);

// ── Idempotency decision: Case 1 / 2 / 3 ──────────────────────────────────────

const case1 = decidePromotionOutcome(target, null);
assert.equal(case1.outcome, "inserted", "no existing operation must insert");

const identicalExisting = buildPromotionProjectionFromExisting(
  {
    sourceHistoricalKey: target.operation.sourceHistoricalKey,
    sourceType: target.operation.sourceType,
    sourceBookingReference: target.operation.sourceBookingReference,
    startDate: target.operation.startDate,
    endDate: target.operation.endDate,
    pickupTime: target.operation.pickupTime,
    notes: target.operation.notes,
    customerId: null, tourId: null, portCallId: null, tourProductId: null,
    guideResourceId: null, driverResourceId: null, vehicleId: null,
  },
  {
    adultCount: target.reservationDetails.adultCount,
    childCount: target.reservationDetails.childCount,
    passengerLanguage: target.reservationDetails.passengerLanguage,
    tourType: target.reservationDetails.tourType,
    itineraryRaw: target.reservationDetails.itineraryRaw,
    pickupPoint: target.reservationDetails.pickupPoint,
    externalSource: target.reservationDetails.externalSource,
    externalOperator: target.reservationDetails.externalOperator,
    collectionStatusRaw: target.reservationDetails.collectionStatusRaw,
    netAmount: null, advanceAmount: null, currency: null,
  },
);
const case2 = decidePromotionOutcome(target, identicalExisting);
assert.equal(case2.outcome, "existing", "same key + identical projection must be an idempotent no-op");

const differentExisting = buildPromotionProjectionFromExisting(
  {
    sourceHistoricalKey: target.operation.sourceHistoricalKey,
    sourceType: target.operation.sourceType,
    sourceBookingReference: target.operation.sourceBookingReference,
    startDate: "2026-08-02", // different content under the same key
    endDate: "2026-08-02",
    pickupTime: target.operation.pickupTime,
    notes: target.operation.notes,
    customerId: null, tourId: null, portCallId: null, tourProductId: null,
    guideResourceId: null, driverResourceId: null, vehicleId: null,
  },
  {
    adultCount: target.reservationDetails.adultCount,
    childCount: target.reservationDetails.childCount,
    passengerLanguage: target.reservationDetails.passengerLanguage,
    tourType: target.reservationDetails.tourType,
    itineraryRaw: target.reservationDetails.itineraryRaw,
    pickupPoint: target.reservationDetails.pickupPoint,
    externalSource: target.reservationDetails.externalSource,
    externalOperator: target.reservationDetails.externalOperator,
    collectionStatusRaw: target.reservationDetails.collectionStatusRaw,
    netAmount: null, advanceAmount: null, currency: null,
  },
);
const case3 = decidePromotionOutcome(target, differentExisting);
assert.equal(case3.outcome, "conflict", "same key + different projection must conflict, never overwrite");

// A non-null value anywhere Faz 3D-A itself always writes null (e.g. a
// customerId set by something outside this code path) must also register as
// a conflict, not be silently normalized away.
const foreignCustomerExisting = buildPromotionProjectionFromExisting(
  {
    sourceHistoricalKey: target.operation.sourceHistoricalKey,
    sourceType: target.operation.sourceType,
    sourceBookingReference: target.operation.sourceBookingReference,
    startDate: target.operation.startDate,
    endDate: target.operation.endDate,
    pickupTime: target.operation.pickupTime,
    notes: target.operation.notes,
    customerId: 42, tourId: null, portCallId: null, tourProductId: null,
    guideResourceId: null, driverResourceId: null, vehicleId: null,
  },
  {
    adultCount: target.reservationDetails.adultCount,
    childCount: target.reservationDetails.childCount,
    passengerLanguage: target.reservationDetails.passengerLanguage,
    tourType: target.reservationDetails.tourType,
    itineraryRaw: target.reservationDetails.itineraryRaw,
    pickupPoint: target.reservationDetails.pickupPoint,
    externalSource: target.reservationDetails.externalSource,
    externalOperator: target.reservationDetails.externalOperator,
    collectionStatusRaw: target.reservationDetails.collectionStatusRaw,
    netAmount: null, advanceAmount: null, currency: null,
  },
);
assert.equal(
  decidePromotionOutcome(target, foreignCustomerExisting).outcome,
  "conflict",
  "an existing operation with a non-null customerId must never be treated as an idempotent match",
);

// ── CLI arg parsing / targeting restrictions (pure, no DB) ───────────────────

assert.equal(MAX_APPLY_LIMIT, 25);

assert.deepEqual(parseArgs([]), { sourceKeys: [], limit: null, apply: false }, "plan mode with no args must not require targeting");

assert.throws(
  () => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION"]),
  /source-key.*veya.*limit/i,
  "apply without --source-key/--limit must be rejected",
);

assert.doesNotThrow(() => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--limit", "3"]));
assert.doesNotThrow(() => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--source-key", "legacy:file-1:01:3"]));

assert.throws(
  () => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--limit", String(MAX_APPLY_LIMIT + 1)]),
  /en fazla/,
  "--limit above the hard maximum must be rejected",
);
assert.throws(
  () => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--limit", "0"]),
  /pozitif/,
  "--limit must be a positive integer",
);

const tooManyKeys = Array.from({ length: MAX_APPLY_LIMIT + 1 }, (_, i) => ["--source-key", `legacy:file-1:01:${i}`]).flat();
assert.throws(
  () => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", ...tooManyKeys]),
  /en fazla/,
  "more than MAX_APPLY_LIMIT --source-key values must be rejected",
);

console.log("historical migration Phase 3D-A promotion self-test: passed");
