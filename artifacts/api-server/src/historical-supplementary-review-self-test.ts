import assert from "node:assert/strict";

import {
  applyHistoricalSupplementaryDecisions,
  buildHistoricalSupplementaryReviewPackage,
  type HistoricalSupplementaryDecisionPackage,
} from "./lib/historical-supplementary-review";
import type { HistoricalDryRunReport, HistoricalOperationCandidate } from "./lib/historical-operation-parser";

function candidate(sourceRow: number, notesRaw: string | null): HistoricalOperationCandidate {
  return {
    sourceKey: `legacy:file-1:30:${sourceRow}`,
    contentFingerprint: "a".repeat(64),
    sourceFileId: "file-1",
    sourceKind: "gemi",
    worksheetName: "30",
    sourceRow,
    operationDate: "2026-05-30",
    reservationType: "REG",
    agency: null,
    operator: "VIATOR/2",
    adultCount: 2,
    childCount: null,
    customerName: "TEST CUSTOMER",
    pickupPoint: "KUS LIMAN",
    language: "ING",
    pickupTime: "07:30",
    collectionStatusRaw: null,
    notesRaw,
    tourSectionRaw: "PRIVATE EPHESUS TOUR",
    sourceBookingReference: null,
    disposition: "ready",
    issues: ["missing_booking_reference", "supplementary_booking_row"],
  };
}

const report: HistoricalDryRunReport = {
  version: 1,
  generatedAt: "2026-09-05T00:00:00.000Z",
  scope: { year: 2026, sourceKinds: ["gemi"], databaseWrites: false, driveWrites: false },
  summary: { workbooks: 1, worksheets: 1, candidates: 2, ready: 2, reviewRequired: 0, possibleDuplicates: 0 },
  candidates: [candidate(10, null), candidate(20, "GIRIS DAHIL")],
};

const review = buildHistoricalSupplementaryReviewPackage(report, "2026-09-05T01:00:00.000Z");
assert.equal(review.databaseWrites, false);
assert.equal(review.driveWrites, false);
assert.equal(review.requiresHumanApproval, true);
assert.equal(review.summary.groups, 1);
assert.equal(review.summary.sourceRows, 2);
assert.deepEqual(review.groups[0]?.sourceKeys, ["legacy:file-1:30:10", "legacy:file-1:30:20"]);
assert.equal(review.groups[0]?.status, "awaiting_human_decision");
assert.equal(review.groups[0]?.suggestedPrimarySourceKey, "legacy:file-1:30:10");

const approved: HistoricalSupplementaryDecisionPackage = {
  version: 1,
  reviewPackageGeneratedAt: review.generatedAt,
  decidedAt: "2026-09-05T02:00:00.000Z",
  decidedBy: "operator-7",
  decisions: [{
    groupKey: review.groups[0]!.groupKey,
    action: "consolidate",
    primarySourceKey: "legacy:file-1:30:10",
    supplementarySourceKey: "legacy:file-1:30:20",
    approved: true,
    resultingNotes: "GIRIS DAHIL",
  }],
};

const result = applyHistoricalSupplementaryDecisions(report, review, approved, "2026-09-05T03:00:00.000Z");
assert.equal(result.summary.consolidatedGroups, 1);
assert.equal(result.summary.stagingRecords, 1);
assert.equal(result.stagingPackage.records[0]?.idempotencyKey, "legacy:file-1:30:10");
assert.equal(result.stagingPackage.records[0]?.operation.notes, "GIRIS DAHIL");
assert.deepEqual(result.audit[0]?.sourceKeys, ["legacy:file-1:30:10", "legacy:file-1:30:20"]);
assert.equal(result.audit[0]?.supplementarySourceKey, "legacy:file-1:30:20");

const keptSeparate = applyHistoricalSupplementaryDecisions(report, review, {
  ...approved,
  decisions: [{
    groupKey: review.groups[0]!.groupKey,
    action: "keep_separate",
    primarySourceKey: "legacy:file-1:30:20",
    supplementarySourceKey: "legacy:file-1:30:10",
    approved: true,
  }],
});
assert.equal(keptSeparate.summary.keptSeparateGroups, 1);
assert.deepEqual(
  keptSeparate.stagingPackage.records.map(record => record.idempotencyKey),
  ["legacy:file-1:30:20", "legacy:file-1:30:10"],
);

assert.throws(
  () => applyHistoricalSupplementaryDecisions(report, review, { ...approved, decisions: [{ ...approved.decisions[0]!, approved: false }] }),
  /acik insan onayi/,
);
assert.throws(
  () => applyHistoricalSupplementaryDecisions(report, review, { ...approved, decisions: [] }),
  /eksik/,
);
assert.throws(
  () => applyHistoricalSupplementaryDecisions(report, review, {
    ...approved,
    decisions: [{ ...approved.decisions[0]!, primarySourceKey: "legacy:file-1:30:99" }],
  }),
  /primary sourceKey/,
);
assert.throws(
  () => applyHistoricalSupplementaryDecisions(report, review, {
    ...approved,
    reviewPackageGeneratedAt: "stale",
  }),
  /review paketi/,
);

console.log("historical supplementary review self-test: passed");
