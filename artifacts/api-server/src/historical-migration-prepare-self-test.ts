import assert from "node:assert/strict";
import { buildHistoricalMigrationPreparation } from "./lib/historical-migration-review";
import type { HistoricalDryRunReport, HistoricalOperationCandidate } from "./lib/historical-operation-parser";

function candidate(overrides: Partial<HistoricalOperationCandidate> = {}): HistoricalOperationCandidate {
  return {
    sourceKey: "legacy:file-1:01:3",
    contentFingerprint: "a".repeat(64),
    sourceFileId: "file-1",
    sourceKind: "gemi",
    worksheetName: "01",
    sourceRow: 3,
    operationDate: "2026-08-01",
    reservationType: "PVT",
    agency: null,
    operator: "IGLESIAS",
    adultCount: 2,
    childCount: null,
    customerName: "TEST CUSTOMER",
    pickupPoint: "KUS LIMAN",
    language: "ING",
    pickupTime: "08:00",
    collectionStatusRaw: null,
    notesRaw: "TEST NOTES",
    tourSectionRaw: "PRIVATE EPHESUS TOUR",
    sourceBookingReference: null,
    disposition: "ready",
    issues: ["missing_booking_reference"],
    ...overrides,
  };
}

const candidates = [
  candidate(),
  candidate({
    sourceKey: "legacy:file-1:01:4",
    sourceRow: 4,
    contentFingerprint: "b".repeat(64),
    issues: ["missing_booking_reference", "possible_duplicate_content"],
  }),
  candidate({
    sourceKey: "legacy:file-1:01:5",
    sourceRow: 5,
    contentFingerprint: "b".repeat(64),
    issues: ["missing_booking_reference", "possible_duplicate_content"],
  }),
  candidate({
    sourceKey: "legacy:file-1:02:3",
    worksheetName: "02",
    sourceRow: 3,
    operationDate: "2026-08-02",
    customerName: null,
    disposition: "review_required",
    issues: ["missing_booking_reference", "missing_customer_name"],
  }),
];

const report: HistoricalDryRunReport = {
  version: 1,
  generatedAt: "2026-08-26T00:00:00.000Z",
  scope: { year: 2026, sourceKinds: ["gemi"], databaseWrites: false, driveWrites: false },
  summary: { workbooks: 1, worksheets: 2, candidates: 4, ready: 3, reviewRequired: 1, possibleDuplicates: 2 },
  candidates,
};

const preparation = buildHistoricalMigrationPreparation(report, "2026-08-26T01:00:00.000Z");
assert.equal(preparation.reviewPackage.summary.stagingReady, 1);
assert.equal(preparation.reviewPackage.summary.manualReview, 2);
assert.equal(preparation.reviewPackage.summary.blocked, 1);
assert.equal(preparation.reviewPackage.reviewItems.length, 3);
assert.equal(preparation.stagingPackage.records.length, 1);
assert.equal(preparation.stagingPackage.records[0]?.idempotencyKey, candidates[0]?.sourceKey);
assert.equal(preparation.stagingPackage.records[0]?.operation.sourceBookingReference, null);
assert.equal(preparation.stagingPackage.records[0]?.reservationDetails.childCount, null);
assert.equal(preparation.stagingPackage.records[0]?.reservationDetails.externalSource, null);
assert.ok(preparation.stagingPackage.records[0]?.warnings.includes("missing_child_count"));
assert.ok(preparation.stagingPackage.records[0]?.warnings.includes("missing_agency"));
assert.equal(preparation.stagingPackage.requiresImportApproval, true);
assert.equal(preparation.stagingPackage.databaseWrites, false);
assert.equal(preparation.stagingPackage.driveWrites, false);

console.log("historical migration Phase 3B preparation self-test: passed");
