import assert from "node:assert/strict";
import { parseHistoricalPickupTimeCorrectionPackage } from "./lib/historical-pickup-time-correction";
import { assertOnlyPickupTimeChanged, buildHistoricalPickupTimeCorrectionPackage } from "./lib/historical-pickup-time-correction-package";

const sourceKey = "legacy:file-1:01:3";
const sentinel = "1899-12-30T09:30:00.000Z";
const oldFingerprint = "a".repeat(64);
const newFingerprint = "b".repeat(64);
const oldCandidate = {
  sourceKey, sourceFileId: "file-1", worksheetName: "01", sourceRow: 3,
  pickupTime: sentinel, contentFingerprint: oldFingerprint,
};
const newCandidate = { ...oldCandidate, pickupTime: "09:30", contentFingerprint: newFingerprint };
const stagingRecord = {
  idempotencyKey: sourceKey,
  requiresHumanApproval: true as const,
  provenance: { sourceFileId: "file-1", sourceKind: "gemi" as const, worksheetName: "01", sourceRow: 3 },
  customer: { fullName: "TEST CUSTOMER" },
  operation: {
    sourceType: "historical_legacy" as const, sourceBookingReference: null,
    startDate: "2026-08-01", endDate: "2026-08-01", pickupTime: sentinel, notes: null,
  },
  reservationDetails: {
    adultCount: 1, childCount: 0, passengerLanguage: "ING", tourType: "PVT" as const,
    itineraryRaw: "TOUR", pickupPoint: "PORT", externalSource: null, externalOperator: null, collectionStatusRaw: null,
  },
  warnings: [],
};
const base = {
  oldReport: { generatedAt: "2026-08-30T00:00:00.000Z", candidates: [oldCandidate] },
  newReport: { generatedAt: "2026-08-31T00:00:00.000Z", candidates: [newCandidate] },
  stagingPackage: { generatedAt: "2026-08-30T00:00:00.000Z", sourceReportGeneratedAt: "2026-08-30T00:00:00.000Z", records: [stagingRecord] },
  generatedAt: "2026-08-31T00:00:00.000Z",
};

const valid = buildHistoricalPickupTimeCorrectionPackage(base);
assert.equal(valid.reconciliation.records, 1);
assert.equal(valid.reconciliation.oldSentinelCount, 1);
assert.equal(valid.reconciliation.fingerprintChanged, 1);
assert.equal(valid.reconciliation.payloadBeforeHashMismatch, 0);
assert.equal(valid.reconciliation.payloadAfterHashMismatch, 0);
assert.equal(valid.correctionPackage.records[0]?.sourceKey, sourceKey);
assert.equal(valid.correctionPackage.records[0]?.oldPickupTime, sentinel);
assert.equal(valid.correctionPackage.records[0]?.newPickupTime, "09:30");
assert.notEqual(valid.correctionPackage.records[0]?.payloadSha256Before, valid.correctionPackage.records[0]?.payloadSha256After);
assert.notEqual(valid.correctionPackage.records[0]?.contentFingerprintBefore, valid.correctionPackage.records[0]?.contentFingerprintAfter);
assert.equal(parseHistoricalPickupTimeCorrectionPackage(valid.correctionPackage).records.length, 1);

assert.throws(
  () => buildHistoricalPickupTimeCorrectionPackage({ ...base, oldReport: { ...base.oldReport, candidates: [oldCandidate, oldCandidate] } }),
  /duplicate sourceKey/,
);
assert.throws(
  () => buildHistoricalPickupTimeCorrectionPackage({ ...base, newReport: { ...base.newReport, candidates: [] } }),
  /new candidate missing/,
);
assert.throws(
  () => buildHistoricalPickupTimeCorrectionPackage({ ...base, stagingPackage: { ...base.stagingPackage, records: [{ ...stagingRecord, idempotencyKey: "legacy:file-1:01:4" }] } }),
  /payload schema gecersiz/,
);
assert.throws(
  () => buildHistoricalPickupTimeCorrectionPackage({ ...base, oldReport: { ...base.oldReport, candidates: [{ ...oldCandidate, pickupTime: "08:00" }] } }),
  /old staged pickup/,
);
assert.throws(
  () => buildHistoricalPickupTimeCorrectionPackage({ ...base, newReport: { ...base.newReport, candidates: [{ ...newCandidate, contentFingerprint: oldFingerprint }] } }),
  /fingerprint/,
);
assert.throws(
  () => assertOnlyPickupTimeChanged(stagingRecord, { ...stagingRecord, customer: { fullName: "MUTATED" }, operation: { ...stagingRecord.operation, pickupTime: "09:30" } }),
  /pickupTime disinda payload degisikligi/,
  "unrelated payload mutation must fail closed",
);
const secondSourceKey = "legacy:file-1:01:4";
const secondStagingRecord = {
  ...stagingRecord,
  idempotencyKey: secondSourceKey,
  provenance: { ...stagingRecord.provenance, sourceRow: 4 },
};
assert.equal(
  buildHistoricalPickupTimeCorrectionPackage({ ...base, stagingPackage: { ...base.stagingPackage, records: [stagingRecord, { ...secondStagingRecord, operation: { ...stagingRecord.operation, pickupTime: "8::30" } }] } }).reconciliation.records,
  1,
  "unrelated malformed pickup must be excluded",
);
assert.equal(
  buildHistoricalPickupTimeCorrectionPackage({ ...base, stagingPackage: { ...base.stagingPackage, records: [stagingRecord, { ...secondStagingRecord, operation: { ...stagingRecord.operation, pickupTime: "09:30" } }] } }).reconciliation.records,
  1,
  "already canonical pickup must be excluded",
);

console.log("historical pickup-time correction package self-test: passed");
