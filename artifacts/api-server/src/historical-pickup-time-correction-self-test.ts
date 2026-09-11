import assert from "node:assert/strict";
import {
  assessHistoricalPickupTimeCorrection,
  canonicalPickupTimeFromSentinel,
  parseHistoricalPickupTimeCorrectionPackage,
  validateHistoricalPickupTimeCorrectionTarget,
} from "./lib/historical-pickup-time-correction";
import { buildPromotionProjectionFromStaging, sha256OfProjection } from "./lib/historical-migration-promote-validation";
import { sha256OfHistoricalStagingRecord } from "./lib/historical-migration-stage-validation";
import {
  MAX_APPLY_LIMIT,
  parseHistoricalPickupTimeCorrectionArgs,
  pickupTimeCorrectionWriteFlags,
  summarizePickupTimeCorrectionApply,
} from "./historical-pickup-time-correction";

const old0730 = "1899-12-30T07:30:00.000Z";
const old0930 = "1899-12-30T09:30:00.000Z";
assert.equal(canonicalPickupTimeFromSentinel(old0730), "07:30");
assert.equal(canonicalPickupTimeFromSentinel(old0930), "09:30");
assert.equal(canonicalPickupTimeFromSentinel("1899-12-30T00:00:00.000Z"), "00:00");
for (const rejected of ["8::30", "11.15", "08:30", "2026-08-01T08:30:00.000Z", "1899-12-29T08:30:00.000Z", "1899-12-31T08:30:00.000Z", "1899-12-30T08:30:01.000Z", "1899-12-30T08:30:00.000+00:00"]) {
  assert.equal(canonicalPickupTimeFromSentinel(rejected), null, `${rejected} must fail closed`);
}

const sourceKey = "legacy:file-1:01:3";
const payload = {
  idempotencyKey: sourceKey,
  requiresHumanApproval: true as const,
  provenance: { sourceFileId: "file-1", sourceKind: "gemi" as const, worksheetName: "01", sourceRow: 3 },
  customer: { fullName: "TEST CUSTOMER" },
  operation: {
    sourceType: "historical_legacy" as const, sourceBookingReference: null,
    startDate: "2026-08-01", endDate: "2026-08-01", pickupTime: old0930, notes: null,
  },
  reservationDetails: {
    adultCount: 2, childCount: 0, passengerLanguage: "ING", tourType: "PVT" as const,
    itineraryRaw: "TOUR", pickupPoint: "PORT", externalSource: "VIATOR", externalOperator: "OP", collectionStatusRaw: null,
  },
  warnings: [],
};
const correctedPayload = { ...payload, operation: { ...payload.operation, pickupTime: "09:30" } };
const beforeHash = sha256OfHistoricalStagingRecord(payload);
const afterHash = sha256OfHistoricalStagingRecord(correctedPayload);
const candidate = {
  sourceKey, oldPickupTime: old0930, newPickupTime: "09:30",
  contentFingerprintBefore: "a".repeat(64), contentFingerprintAfter: "b".repeat(64),
  payloadSha256Before: beforeHash, payloadSha256After: afterHash,
};
const packageInput = {
  mode: "historical-pickup-time-correction" as const,
  version: 1 as const, kind: "historical-pickup-time-correction" as const,
  generatedAt: "2026-08-30T00:00:00.000Z", sourceReportGeneratedAt: "2026-08-30T00:00:00.000Z",
  databaseWrites: false as const, records: [candidate],
};
assert.equal(parseHistoricalPickupTimeCorrectionPackage(packageInput).records.length, 1);
assert.throws(() => parseHistoricalPickupTimeCorrectionPackage({ ...packageInput, records: [{ ...candidate, newPickupTime: "08:30" }] }), /deterministik/);
assert.throws(() => parseHistoricalPickupTimeCorrectionPackage({ ...packageInput, records: [{ ...candidate, contentFingerprintAfter: candidate.contentFingerprintBefore }] }), /contentFingerprint/);

const pendingRow = {
  id: 10, sourceKey, sourceFileId: "file-1", worksheetName: "01", sourceRow: 3,
  status: "pending", payload, payloadSha256: beforeHash, importedOperationId: null, promotedContentSha256: null,
  approvalVersion: 1,
};
const pending = assessHistoricalPickupTimeCorrection({ candidate, historicalImport: pendingRow, operation: null });
assert.equal(pending.classification, "eligible_pending");
assert.equal(pending.correctedPayload?.operation.pickupTime, "09:30");
assert.equal(pending.correctedPayloadSha256, afterHash);
assert.equal(assessHistoricalPickupTimeCorrection({ candidate, historicalImport: { ...pendingRow, status: "approved" }, operation: null }).classification, "unsupported_status");
assert.equal(assessHistoricalPickupTimeCorrection({ candidate, historicalImport: { ...pendingRow, payload: { ...payload, operation: { ...payload.operation, pickupTime: "8::30" } } }, operation: null }).classification, "payload_integrity_failed");

const oldPromoted = sha256OfProjection(buildPromotionProjectionFromStaging(sourceKey, payload));
const importedRow = { ...pendingRow, status: "imported", importedOperationId: 77, promotedContentSha256: oldPromoted };
const importedOperation = { id: 77, sourceHistoricalKey: sourceKey, pickupTime: old0930, version: 3 };
const imported = assessHistoricalPickupTimeCorrection({ candidate, historicalImport: importedRow, operation: importedOperation });
assert.equal(imported.classification, "eligible_imported");
assert.notEqual(imported.correctedPromotedContentSha256, oldPromoted, "promotion hash must follow corrected projection");
assert.equal(assessHistoricalPickupTimeCorrection({ candidate, historicalImport: importedRow, operation: null }).classification, "missing_imported_operation");
assert.equal(assessHistoricalPickupTimeCorrection({ candidate, historicalImport: importedRow, operation: { ...importedOperation, pickupTime: "07:30" } }).classification, "operation_pickup_conflict");

const canonicalImportedRow = { ...importedRow, payload: correctedPayload, payloadSha256: afterHash, promotedContentSha256: imported.correctedPromotedContentSha256 };
assert.equal(assessHistoricalPickupTimeCorrection({ candidate, historicalImport: canonicalImportedRow, operation: { ...importedOperation, pickupTime: "09:30" } }).classification, "already_canonical");

assert.equal(MAX_APPLY_LIMIT, 25);
assert.deepEqual(parseHistoricalPickupTimeCorrectionArgs(["--input", "fixture.json"]), {
  inputPath: "fixture.json", sourceKeys: [], limit: null, apply: false, operatorProfileId: null,
});
assert.throws(() => parseHistoricalPickupTimeCorrectionArgs(["--input", "fixture.json", "--apply", "--confirm-pickup-correction", "wrong", "--limit", "1", "--operator-profile-id", "1"]), /tam onay/);
assert.throws(() => parseHistoricalPickupTimeCorrectionArgs(["--input", "fixture.json", "--apply", "--confirm-pickup-correction", "TOURPILOT_2026_HISTORICAL_PICKUP_CORRECTION", "--operator-profile-id", "1"]), /tam olarak --source-key veya --limit/);
assert.throws(() => parseHistoricalPickupTimeCorrectionArgs(["--input", "fixture.json", "--apply", "--confirm-pickup-correction", "TOURPILOT_2026_HISTORICAL_PICKUP_CORRECTION", "--limit", "1"]), /operator-profile-id/);
assert.throws(() => parseHistoricalPickupTimeCorrectionArgs(["--input", "fixture.json", "--apply", "--confirm-pickup-correction", "TOURPILOT_2026_HISTORICAL_PICKUP_CORRECTION", "--limit", "26", "--operator-profile-id", "1"]), /en fazla/);
assert.throws(() => parseHistoricalPickupTimeCorrectionArgs(["--input", "fixture.json", "--wat"]), /Desteklenmeyen/);
assert.throws(() => parseHistoricalPickupTimeCorrectionArgs(["--input", "fixture.json", "--apply", "--confirm-pickup-correction", "TOURPILOT_2026_HISTORICAL_PICKUP_CORRECTION", "--source-key", "not-a-source", "--operator-profile-id", "1"]), /canonical legacy/);
assert.deepEqual(
  pickupTimeCorrectionWriteFlags(summarizePickupTimeCorrectionApply(["pending_corrected"])),
  { databaseWrites: true, operationWrites: false, customerWrites: false },
  "pending-only correction must not report an operation write",
);
assert.deepEqual(
  pickupTimeCorrectionWriteFlags(summarizePickupTimeCorrectionApply(["imported_corrected"])),
  { databaseWrites: true, operationWrites: true, customerWrites: false },
  "imported correction must report its operation write",
);
assert.deepEqual(
  pickupTimeCorrectionWriteFlags(summarizePickupTimeCorrectionApply(["existing"])),
  { databaseWrites: false, operationWrites: false, customerWrites: false },
  "idempotent replay must report no writes",
);
assert.throws(() => validateHistoricalPickupTimeCorrectionTarget({ NODE_ENV: "production", HISTORICAL_STAGING_DATABASE_URL: "postgresql://x.neon.tech/db", HISTORICAL_STAGING_DATABASE_HOST: "x.neon.tech" }), /Production/);
assert.throws(() => validateHistoricalPickupTimeCorrectionTarget({}), /gerekli/);
assert.throws(() => validateHistoricalPickupTimeCorrectionTarget({ HISTORICAL_STAGING_DATABASE_URL: "postgresql://other.neon.tech/db", HISTORICAL_STAGING_DATABASE_HOST: "x.neon.tech" }), /allowlist/);

console.log("historical pickup-time correction self-test: passed");
