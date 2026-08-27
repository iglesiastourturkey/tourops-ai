import assert from "node:assert/strict";
import {
  buildHistoricalStageRows,
  parseHistoricalStagingPackage,
} from "./lib/historical-migration-stage-validation";

const record = {
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

const input = {
  version: 1 as const,
  policyVersion: "phase3b-2026-v1" as const,
  generatedAt: "2026-08-26T00:00:00.000Z",
  sourceReportGeneratedAt: "2026-08-26T00:00:00.000Z",
  databaseWrites: false as const,
  driveWrites: false as const,
  requiresImportApproval: true as const,
  records: [record],
};

const parsed = parseHistoricalStagingPackage(input);
const first = buildHistoricalStageRows(parsed)[0];
assert.ok(first);
assert.equal(first.sourceKey, record.idempotencyKey);
assert.match(first.payloadSha256, /^[0-9a-f]{64}$/);
assert.equal(first.payload.reservationDetails.childCount, null);
assert.equal(first.payload.reservationDetails.externalSource, null);
assert.equal(first.status, "pending");
assert.equal(
  buildHistoricalStageRows(parseHistoricalStagingPackage(JSON.parse(JSON.stringify(input))))[0]?.payloadSha256,
  first.payloadSha256,
  "canonical payload hash must be deterministic",
);

assert.throws(
  () => parseHistoricalStagingPackage({
    ...input,
    records: [{ ...record, idempotencyKey: "legacy:wrong:01:3" }],
  }),
  /sourceKey provenance ile uyusmuyor/,
);
assert.throws(
  () => parseHistoricalStagingPackage({ ...input, requiresImportApproval: false }),
);
assert.throws(
  () => parseHistoricalStagingPackage({ ...input, records: [record, record] }),
  /tekrar eden sourceKey/,
);

console.log("historical migration Phase 3C staging self-test: passed");
