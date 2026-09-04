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
assert.equal(
  historicalImportTransitionBlock("promote", "imported"),
  null,
  "imported must be allowed only into idempotent replay/conflict verification",
);

assert.ok(historicalImportTransitionBlock("promote", "pending"), "pending -> imported must be blocked");
assert.ok(historicalImportTransitionBlock("promote", "rejected"), "rejected -> imported must be blocked");
assert.ok(historicalImportTransitionBlock("approve", "imported"), "imported -> approved must be blocked");
assert.ok(historicalImportTransitionBlock("reject", "imported"), "imported -> rejected must be blocked");
assert.ok(historicalImportTransitionBlock("approve", "approved"), "approved -> approved must be blocked (no double-approve)");
assert.ok(historicalImportTransitionBlock("reject", "approved"), "approved -> rejected must be blocked");

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
assert.equal(target.bookingParty.netAmount, null, "Historical promotion must never invent a financial figure");
assert.equal(target.bookingParty.advanceAmount, null);
assert.equal(target.bookingParty.currency, null);
assert.equal(target.bookingParty.childCount, null, "blank child count must be preserved as null, never invented");
assert.equal(target.reservation.leadGuestName, "TEST CUSTOMER");
assert.equal(target.reservation.sourceHistoricalKey, stagedRow.sourceKey);

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

const existingOperation = {
  sourceHistoricalKey: target.operation.sourceHistoricalKey,
  sourceType: target.operation.sourceType,
  sourceBookingReference: target.operation.sourceBookingReference,
  startDate: target.operation.startDate,
  endDate: target.operation.endDate,
  pickupTime: target.operation.pickupTime,
  notes: target.operation.notes,
  customerId: null, tourId: null, portCallId: null, tourProductId: null,
  guideResourceId: null, driverResourceId: null, vehicleId: null,
};
const existingReservation = {
  customerId: target.reservation.customerId,
  leadGuestName: target.reservation.leadGuestName,
  reservationType: target.reservation.reservationType,
  status: target.reservation.status,
  sourceType: target.reservation.sourceType,
  sourceHistoricalKey: target.reservation.sourceHistoricalKey,
  sourceBookingReference: target.reservation.sourceBookingReference,
};
const existingBookingParty = {
  adultCount: target.bookingParty.adultCount,
  childCount: target.bookingParty.childCount,
  passengerLanguage: target.bookingParty.passengerLanguage,
  itineraryRaw: target.bookingParty.itineraryRaw,
  pickupPoint: target.bookingParty.pickupPoint,
  externalSource: target.bookingParty.externalSource,
  externalOperator: target.bookingParty.externalOperator,
  collectionStatusRaw: target.bookingParty.collectionStatusRaw,
  netAmount: null, advanceAmount: null, currency: null,
};
const identicalExisting = buildPromotionProjectionFromExisting(existingOperation, existingReservation, existingBookingParty);
const case2 = decidePromotionOutcome(target, identicalExisting);
assert.equal(case2.outcome, "existing", "same key + identical projection must be an idempotent no-op");

const differentExisting = buildPromotionProjectionFromExisting(
  { ...existingOperation, startDate: "2026-08-02", endDate: "2026-08-02" },
  existingReservation,
  existingBookingParty,
);
const case3 = decidePromotionOutcome(target, differentExisting);
assert.equal(case3.outcome, "conflict", "same key + different projection must conflict, never overwrite");

const foreignCustomerExisting = buildPromotionProjectionFromExisting(
  { ...existingOperation, customerId: 42 },
  existingReservation,
  existingBookingParty,
);
assert.equal(
  decidePromotionOutcome(target, foreignCustomerExisting).outcome,
  "conflict",
  "an existing operation with a non-null customerId must never be treated as an idempotent match",
);

// ── CLI arg parsing / targeting restrictions (pure, no DB) ───────────────────

assert.equal(MAX_APPLY_LIMIT, 25);
assert.deepEqual(
  parseArgs([]),
  { sourceKeys: [], limit: null, apply: false, operatorProfileId: null },
  "plan mode with no args must not require targeting or an operator",
);
assert.throws(
  () => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--operator-profile-id", "1"]),
  /source-key.*veya.*limit/i,
  "apply without --source-key/--limit must be rejected",
);
assert.throws(
  () => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--limit", "3"]),
  /operator-profile-id zorunludur/,
  "apply without --operator-profile-id must be rejected before any DB connection",
);
assert.throws(
  () => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--limit", "3", "--operator-profile-id", "0"]),
  /pozitif/,
  "--operator-profile-id must be a positive integer",
);
assert.throws(
  () => parseArgs(["--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--limit", "3", "--operator-profile-id", "abc"]),
  /pozitif/,
  "a non-numeric --operator-profile-id must be rejected",
);
assert.doesNotThrow(() => parseArgs(["--limit", "3"]));
assert.equal(parseArgs(["--limit", "3"]).operatorProfileId, null);
assert.doesNotThrow(() => parseArgs([
  "--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--limit", "3", "--operator-profile-id", "7",
]));
assert.doesNotThrow(() => parseArgs([
  "--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION",
  "--source-key", "legacy:file-1:01:3", "--operator-profile-id", "7",
]));
assert.equal(
  parseArgs([
    "--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--limit", "3", "--operator-profile-id", "7",
  ]).operatorProfileId,
  7,
  "a valid --operator-profile-id must be threaded through as a number",
);
assert.throws(
  () => parseArgs([
    "--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION",
    "--limit", String(MAX_APPLY_LIMIT + 1), "--operator-profile-id", "7",
  ]),
  /en fazla/,
  "--limit above the hard maximum must be rejected",
);
assert.throws(
  () => parseArgs([
    "--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", "--limit", "0", "--operator-profile-id", "7",
  ]),
  /pozitif/,
  "--limit must be a positive integer",
);
const tooManyKeys = Array.from({ length: MAX_APPLY_LIMIT + 1 }, (_, i) => ["--source-key", `legacy:file-1:01:${i}`]).flat();
assert.throws(
  () => parseArgs([
    "--apply", "--confirm-promotion", "TOURPILOT_2026_HISTORICAL_PROMOTION", ...tooManyKeys, "--operator-profile-id", "7",
  ]),
  /en fazla/,
  "more than MAX_APPLY_LIMIT --source-key values must be rejected",
);

// ── Required change 1 / 5: review CLI arg parsing (pure, no DB) ─────────────
const { parseReviewArgs } = await import("./historical-migration-review-action");
assert.throws(
  () => parseReviewArgs(["--approve", "--operator-profile-id", "1", "--confirm-review", "TOURPILOT_2026_HISTORICAL_REVIEW"]),
  /tam olarak bir --source-key/i,
  "review with zero --source-key must be rejected (no bulk path)",
);
assert.throws(
  () => parseReviewArgs([
    "--source-key", "legacy:a:01:1", "--source-key", "legacy:a:01:2",
    "--approve", "--operator-profile-id", "1", "--confirm-review", "TOURPILOT_2026_HISTORICAL_REVIEW",
  ]),
  /tam olarak bir --source-key/i,
  "review with more than one --source-key must be rejected (no bulk path)",
);
assert.throws(
  () => parseReviewArgs(["--source-key", "legacy:a:01:1", "--operator-profile-id", "1", "--confirm-review", "TOURPILOT_2026_HISTORICAL_REVIEW"]),
  /--approve veya --reject/,
  "review without --approve or --reject must be rejected",
);
assert.throws(
  () => parseReviewArgs([
    "--source-key", "legacy:a:01:1", "--approve", "--reject",
    "--operator-profile-id", "1", "--confirm-review", "TOURPILOT_2026_HISTORICAL_REVIEW",
  ]),
  /--approve veya --reject/,
  "review with both --approve and --reject must be rejected",
);
assert.throws(
  () => parseReviewArgs(["--source-key", "legacy:a:01:1", "--reject", "--operator-profile-id", "1", "--confirm-review", "TOURPILOT_2026_HISTORICAL_REVIEW"]),
  /--reason zorunludur/,
  "reject without --reason must be rejected",
);
assert.throws(
  () => parseReviewArgs([
    "--source-key", "legacy:a:01:1", "--reject", "--reason", "   ",
    "--operator-profile-id", "1", "--confirm-review", "TOURPILOT_2026_HISTORICAL_REVIEW",
  ]),
  /--reason zorunludur/,
  "reject with a blank/whitespace-only --reason must be rejected",
);
assert.throws(
  () => parseReviewArgs(["--source-key", "legacy:a:01:1", "--approve", "--confirm-review", "TOURPILOT_2026_HISTORICAL_REVIEW"]),
  /operator-profile-id zorunludur/,
  "review CLI refuses missing --operator-profile-id",
);
const approveParsed = parseReviewArgs([
  "--source-key", "legacy:a:01:1", "--approve", "--operator-profile-id", "7", "--confirm-review", "TOURPILOT_2026_HISTORICAL_REVIEW",
]);
assert.equal(approveParsed.action, "approve");
assert.equal(approveParsed.operatorProfileId, 7);
assert.equal(approveParsed.confirmed, true);
const rejectParsed = parseReviewArgs([
  "--source-key", "legacy:a:01:1", "--reject", "--reason", "duplicate content",
  "--operator-profile-id", "7", "--confirm-review", "TOURPILOT_2026_HISTORICAL_REVIEW",
]);
assert.equal(rejectParsed.action, "reject");
assert.equal(rejectParsed.reason, "duplicate content");
assert.equal(
  parseReviewArgs(["--source-key", "legacy:a:01:1", "--approve", "--operator-profile-id", "7"]).confirmed,
  false,
);
assert.equal(
  parseReviewArgs([
    "--source-key", "legacy:a:01:1", "--approve", "--operator-profile-id", "7", "--confirm-review", "WRONG_PHRASE",
  ]).confirmed,
  false,
);

console.log("historical migration Phase 3D-A promotion self-test: passed");
