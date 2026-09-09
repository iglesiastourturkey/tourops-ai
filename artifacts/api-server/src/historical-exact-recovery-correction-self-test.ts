import assert from "node:assert/strict";
import { sha256OfHistoricalStagingRecord, type HistoricalStagingRecord } from "./lib/historical-migration-stage-validation";
import { prepareHistoricalExactRecovery, validateHistoricalExactRecoveryTarget, type ExactRecoveryInput, type ExactRecoveryRow } from "./lib/historical-exact-recovery-correction";
import { parseHistoricalExactRecoveryArgs } from "./historical-exact-recovery-correction";

const sourceKey = "legacy:1QG0rIgXYwGKt9qNoE7e5yZIKod31wuyB:10:93";
const payload: HistoricalStagingRecord = {
  idempotencyKey: sourceKey, requiresHumanApproval: true,
  provenance: { sourceFileId: "1QG0rIgXYwGKt9qNoE7e5yZIKod31wuyB", sourceKind: "gemi", worksheetName: "10", sourceRow: 93 },
  customer: { fullName: "Preserved Customer" },
  operation: { sourceType: "historical_legacy", sourceBookingReference: null, startDate: "2026-08-10", endDate: "2026-08-10", pickupTime: null, notes: "preserve me" },
  reservationDetails: { adultCount: 2, childCount: null, passengerLanguage: "en", tourType: "PVT", itineraryRaw: "Ephesus", pickupPoint: "Port", externalSource: null, externalOperator: "Guide", collectionStatusRaw: null },
  warnings: ["missing_agency", "missing_child_count", "missing_pickup_time"],
};
const oldHash = sha256OfHistoricalStagingRecord(payload);
const row: ExactRecoveryRow = { id: 9, sourceKey, sourceFileId: payload.provenance.sourceFileId, worksheetName: "10", sourceRow: 93, status: "pending", payload, payloadSha256: oldHash, warnings: [...payload.warnings] };
const input: ExactRecoveryInput = { sourceKey, expectedPayloadSha256: oldHash, field: "pickupTime", value: "07:30", warningToRemove: "missing_pickup_time", operatorProfileId: 1 };

const prepared = prepareHistoricalExactRecovery(row, input);
assert.equal(prepared.correctedPayload.operation.pickupTime, "07:30");
assert.deepEqual(prepared.correctedWarnings, ["missing_agency", "missing_child_count"]);
assert.deepEqual(prepared.correctedPayload.warnings, prepared.correctedWarnings);
assert.equal(prepared.correctedPayload.operation.notes, "preserve me");
assert.deepEqual(prepared.correctedPayload.customer, payload.customer);
assert.deepEqual(prepared.correctedPayload.reservationDetails, payload.reservationDetails);
assert.notEqual(prepared.newPayloadSha256, oldHash);
assert.equal(prepared.newPayloadSha256, sha256OfHistoricalStagingRecord(prepared.correctedPayload));

assert.throws(() => validateHistoricalExactRecoveryTarget({ NODE_ENV: "production", HISTORICAL_STAGING_DATABASE_URL: "postgres://x@stage.neon.tech/db", HISTORICAL_STAGING_DATABASE_HOST: "stage.neon.tech" }), /production/);
assert.throws(() => validateHistoricalExactRecoveryTarget({ HISTORICAL_STAGING_DATABASE_URL: "postgres://x@wrong.neon.tech/db", HISTORICAL_STAGING_DATABASE_HOST: "stage.neon.tech" }), /host/);
assert.throws(() => parseHistoricalExactRecoveryArgs(["--source-key", sourceKey, "--field", "pickupTime", "--value", "07:30", "--remove-warning", "missing_pickup_time", "--operator-profile-id", "1"]), /expected-payload/);
assert.throws(() => prepareHistoricalExactRecovery(row, { ...input, expectedPayloadSha256: "0".repeat(64) }), /CAS/);
assert.throws(() => prepareHistoricalExactRecovery({ ...row, status: "approved" }, input), /pending/);
assert.throws(() => prepareHistoricalExactRecovery({ ...row, payload: { ...payload, operation: { ...payload.operation, pickupTime: "06:00" } } }, input), /dogrulanamadi|zaten dolu/);
const payloadWithoutWarning = { ...payload, warnings: ["missing_agency", "missing_child_count"] } as HistoricalStagingRecord;
const hashWithoutWarning = sha256OfHistoricalStagingRecord(payloadWithoutWarning);
assert.throws(() => prepareHistoricalExactRecovery({ ...row, warnings: [...payloadWithoutWarning.warnings], payload: payloadWithoutWarning, payloadSha256: hashWithoutWarning }, { ...input, expectedPayloadSha256: hashWithoutWarning }), /warning/);
for (const value of ["7:30", "24:00", "07:60", "1899-12-30T07:30:00.000Z"]) assert.throws(() => prepareHistoricalExactRecovery(row, { ...input, value }), /HH:mm/);
assert.throws(() => prepareHistoricalExactRecovery({ ...row, payload: prepared.correctedPayload, payloadSha256: prepared.newPayloadSha256, warnings: prepared.correctedWarnings }, input), /CAS/);

const args = parseHistoricalExactRecoveryArgs(["--source-key", sourceKey, "--expected-payload-sha256", oldHash, "--field", "pickupTime", "--value", "07:30", "--remove-warning", "missing_pickup_time", "--operator-profile-id", "1"]);
assert.equal(args.apply, false);
assert.throws(() => parseHistoricalExactRecoveryArgs(["--source-key", sourceKey, "--expected-payload-sha256", oldHash, "--field", "pickupTime", "--value", "07:30", "--remove-warning", "missing_pickup_time", "--operator-profile-id", "1", "--apply", "--confirm", "wrong"]), /confirmation/);
console.log("historical exact-recovery correction self-test: passed");
