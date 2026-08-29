import assert from "node:assert/strict";
import {
  buildPendingInspectReport,
  DEFAULT_PENDING_INSPECT_LIMIT,
  MAX_PENDING_INSPECT_LIMIT,
  parsePendingInspectArgs,
  validatePendingInspectTarget,
} from "./historical-pending-inspect";

assert.equal(DEFAULT_PENDING_INSPECT_LIMIT, 20);
assert.equal(MAX_PENDING_INSPECT_LIMIT, 100);
assert.deepEqual(parsePendingInspectArgs([]), { limit: 20 });
assert.deepEqual(parsePendingInspectArgs(["--limit", "100"]), { limit: 100 });
for (const args of [["--limit", "0"], ["--limit", "101"], ["--limit", "1.5"], ["--limit", "x"], ["--limit"], ["--all"], ["--limit", "20", "--limit", "21"]]) {
  assert.throws(() => parsePendingInspectArgs(args), /limit|Yalnizca/i);
}

const validTarget = {
  HISTORICAL_STAGING_DATABASE_URL: "postgresql://user:password@branch-123.neon.tech/neondb",
  HISTORICAL_STAGING_DATABASE_HOST: "branch-123.neon.tech",
};
assert.equal(validatePendingInspectTarget(validTarget), validTarget.HISTORICAL_STAGING_DATABASE_URL);
assert.throws(() => validatePendingInspectTarget({ ...validTarget, NODE_ENV: "production" }), /Production/);
assert.throws(() => validatePendingInspectTarget({}), /gerekli/);
assert.throws(() => validatePendingInspectTarget({ ...validTarget, HISTORICAL_STAGING_DATABASE_URL: "https://branch-123.neon.tech/db" }), /PostgreSQL/);
assert.throws(() => validatePendingInspectTarget({ ...validTarget, HISTORICAL_STAGING_DATABASE_HOST: "other.neon.tech" }), /allowlist/);
assert.throws(() => validatePendingInspectTarget({ ...validTarget, HISTORICAL_STAGING_DATABASE_HOST: "localhost" }), /allowlist/);

const report = buildPendingInspectReport(20, 1, [{
  id: 1,
  sourceKey: "legacy:file-1:01:3",
  sourceFileId: "file-1",
  sourceKind: "gemi",
  worksheetName: "01",
  sourceRow: 3,
  operationDate: "2026-08-01",
  customerName: "TEST CUSTOMER",
  warnings: ["missing_pickup_time"],
  status: "pending",
  payload: {
    operation: { pickupTime: null },
    reservationDetails: {
      tourType: "PVT",
      itineraryRaw: "PRIVATE EPHESUS TOUR",
      externalSource: "AGENCY",
      externalOperator: "GUIDE NAME",
      adultCount: 2,
      childCount: null,
      pickupPoint: "KUS LIMAN",
      passengerLanguage: "ING",
      collectionStatusRaw: null,
    },
    privateUnneededData: "must not be reported",
  },
}]);
assert.deepEqual(
  {
    mode: report.mode,
    databaseWrites: report.databaseWrites,
    customerWrites: report.customerWrites,
    operationWrites: report.operationWrites,
    requestedLimit: report.requestedLimit,
    pendingTotal: report.pendingTotal,
    selectedCount: report.selectedCount,
  },
  {
    mode: "historical-pending-inspect",
    databaseWrites: false,
    customerWrites: false,
    operationWrites: false,
    requestedLimit: 20,
    pendingTotal: 1,
    selectedCount: 1,
  },
);
assert.equal(report.details[0]?.sourceKey, "legacy:file-1:01:3");
assert.equal(report.details[0]?.tourOrService, "PRIVATE EPHESUS TOUR");
assert.ok(!("payload" in (report.details[0] ?? {})), "raw payload must not be included in detail output");

console.log("historical pending inspect self-test: passed");
