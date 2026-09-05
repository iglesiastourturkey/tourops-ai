import assert from "node:assert/strict";

import {
  buildHistoricalMigrationPreparation,
} from "./lib/historical-migration-review";

import type {
  HistoricalCandidateIssue,
  HistoricalDryRunReport,
  HistoricalOperationCandidate,
} from "./lib/historical-operation-parser";

const baseCandidate: HistoricalOperationCandidate = {
  sourceKey: "legacy:test:1:1",
  contentFingerprint: "a".repeat(64),
  sourceFileId: "test-file",
  sourceKind: "gemi",
  worksheetName: "1",
  sourceRow: 1,
  operationDate: "2026-09-01",
  reservationType: "PVT",
  agency: null,
  operator: "IGLESIAS",
  adultCount: 2,
  childCount: null,
  customerName: "TEST CUSTOMER",
  pickupPoint: "KUS LIMAN",
  language: "ING",
  pickupTime: "08:30",
  collectionStatusRaw: null,
  notesRaw: null,
  tourSectionRaw: "PRIVATE EPHESUS TOUR",
  sourceBookingReference: null,
  disposition: "ready",
  issues: [],
};

function reportFor(
  issue: HistoricalCandidateIssue | null,
): HistoricalDryRunReport {
  const candidate: HistoricalOperationCandidate = {
    ...baseCandidate,
    issues: issue ? [issue] : [],
  };

  return {
    version: 1,
    generatedAt: "2026-09-05T00:00:00.000Z",
    scope: {
      year: 2026,
      sourceKinds: ["gemi"],
      databaseWrites: false,
      driveWrites: false,
    },
    summary: {
      workbooks: 1,
      worksheets: 1,
      candidates: 1,
      ready: 1,
      reviewRequired: 0,
      possibleDuplicates:
        issue === "possible_duplicate_content" ? 1 : 0,
    },
    candidates: [candidate],
  };
}

const ambiguousIssue: HistoricalCandidateIssue =
  "ambiguous_duplicate_content";

const supplementaryIssue: HistoricalCandidateIssue =
  "supplementary_booking_row";

const ambiguous = buildHistoricalMigrationPreparation(
  reportFor(ambiguousIssue),
  "2026-09-05T00:00:00.000Z",
);

assert.equal(ambiguous.reviewPackage.summary.manualReview, 1);
assert.equal(ambiguous.reviewPackage.summary.stagingReady, 0);
assert.equal(ambiguous.reviewPackage.reviewItems[0]?.disposition, "manual_review");

const supplementary = buildHistoricalMigrationPreparation(
  reportFor(supplementaryIssue),
  "2026-09-05T00:00:00.000Z",
);

assert.equal(supplementary.reviewPackage.summary.manualReview, 1);
assert.equal(supplementary.reviewPackage.summary.stagingReady, 0);
assert.equal(
  supplementary.reviewPackage.reviewItems[0]?.disposition,
  "manual_review",
);

const differentService = buildHistoricalMigrationPreparation(
  reportFor(null),
  "2026-09-05T00:00:00.000Z",
);

assert.equal(differentService.reviewPackage.summary.manualReview, 0);
assert.equal(differentService.reviewPackage.summary.stagingReady, 1);

console.log("historical_duplicate_preparation_self_test: PASS");
