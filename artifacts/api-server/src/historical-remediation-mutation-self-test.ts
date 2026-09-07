import assert from "node:assert/strict";
import {
  applyHistoricalRemediationValue,
  getHistoricalRemediationValue,
  REMEDIATION_WARNING_BY_FIELD,
  validateRemediationValue,
} from "./lib/historical-remediation-mutation-validation";
import type { HistoricalStagingRecord } from "./lib/historical-migration-stage-validation";

const payload = {
  idempotencyKey: "legacy:file:27:105",
  requiresHumanApproval: true,
  provenance: { sourceFileId: "file", sourceKind: "gemi", worksheetName: "27", sourceRow: 105 },
  customer: { fullName: "Guest" },
  operation: {
    sourceType: "historical_legacy",
    sourceBookingReference: null,
    startDate: "2026-04-01",
    endDate: "2026-04-01",
    pickupTime: null,
    notes: null,
  },
  reservationDetails: {
    adultCount: null,
    childCount: null,
    passengerLanguage: null,
    tourType: "REG",
    itineraryRaw: null,
    pickupPoint: null,
    externalSource: null,
    externalOperator: null,
    collectionStatusRaw: null,
  },
  warnings: ["missing_operator", "missing_pickup_time", "missing_language"],
} satisfies HistoricalStagingRecord;

assert.equal(validateRemediationValue("pickupTime", " 09:05 "), "09:05");
assert.throws(() => validateRemediationValue("pickupTime", "9:05"));
assert.equal(validateRemediationValue("passengerLanguage", " English "), "English");
assert.throws(() => validateRemediationValue("passengerLanguage", "  "));
assert.equal(validateRemediationValue("pickupPoint", " Hotel "), "Hotel");
assert.throws(() => validateRemediationValue("pickupPoint", "x".repeat(121)));
assert.equal(validateRemediationValue("adultCount", 2), 2);
assert.throws(() => validateRemediationValue("adultCount", 2.5));
assert.throws(() => validateRemediationValue("adultCount", 0));
assert.throws(() => validateRemediationValue("adultCount", 100));
assert.equal(validateRemediationValue("externalOperator", " VIATOR "), "VIATOR");
assert.throws(() => validateRemediationValue("externalOperator", ""));

const corrected = applyHistoricalRemediationValue(payload, "externalOperator", "Iglesias Tour");
assert.equal(getHistoricalRemediationValue(corrected, "externalOperator"), "Iglesias Tour");
assert.equal(corrected.reservationDetails.passengerLanguage, null);
assert.equal(corrected.reservationDetails.pickupPoint, null);
assert.equal(corrected.operation.pickupTime, null);
assert.deepEqual(REMEDIATION_WARNING_BY_FIELD, {
  pickupTime: "missing_pickup_time",
  passengerLanguage: "missing_language",
  pickupPoint: "missing_pickup_point",
  adultCount: "missing_adult_count",
  externalOperator: "missing_operator",
});

console.log("historical remediation mutation self-test: passed");
