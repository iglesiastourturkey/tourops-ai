import assert from "node:assert/strict";
import { buildHistoricalDryRunReport, operationDateFromWorksheet } from "./lib/historical-operation-parser";

const { default: ExcelJS } = await import("exceljs");
const workbook = new ExcelJS.Workbook();

const firstDay = workbook.addWorksheet("01");
firstDay.getCell("F1").value = "PRIVATE EPHESUS TOUR";
firstDay.addRow(["Type", "Agency", "Operator", "Adult", "Chd", "Guest Name", "P-up Point", "DIL", "P-up Time", "Tahsilat", "", "Notes"]);
firstDay.addRow(["PVT", "VIATOR", "IGLESIAS", 2, 0, "TEST CUSTOMER", "KUS LIMAN", "ING", "08:00", "", "", "TEST NOTES"]);
firstDay.addRow(["PVT", "VIATOR", "IGLESIAS", 2, 0, "TEST CUSTOMER", "KUS LIMAN", "ING", "08:00", "", "", "TEST NOTES"]);

const secondDay = workbook.addWorksheet("02");
secondDay.addRow(["Type", "Agency", "Operator", "Adult", "Chd", "Full Name", "P-up Point", "DIL", "P-up Time", "Tahsilat", "", "Notes"]);
secondDay.addRow(["REG", "TOURR", "LAAL", 1, 0, "", "HOTEL", "ING", "09:00", "", "", "TRANSFER"]);

const descriptor = {
  path: "/tmp/fixture.xlsx",
  sourceFileId: "drive-fixture-id",
  sourceKind: "gemi" as const,
  year: 2026 as const,
  month: 8,
};

assert.equal(operationDateFromWorksheet("1 AGUSTOS", 2026, 8), "2026-08-01");
assert.equal(operationDateFromWorksheet("32", 2026, 8), null);

const report = buildHistoricalDryRunReport([{ descriptor, workbook }], "2026-08-26T00:00:00.000Z");
assert.equal(report.summary.workbooks, 1);
assert.equal(report.summary.worksheets, 2);
assert.equal(report.summary.candidates, 3);
assert.equal(report.summary.ready, 2);
assert.equal(report.summary.reviewRequired, 1);
assert.equal(report.summary.possibleDuplicates, 2);
assert.equal(report.scope.databaseWrites, false);
assert.equal(report.scope.driveWrites, false);
assert.ok(report.candidates[0].sourceKey.startsWith("legacy:drive-fixture-id:01:"));
assert.ok(report.candidates[0].issues.includes("missing_booking_reference"));
assert.ok(report.candidates[2].issues.includes("missing_customer_name"));

console.log("historical migration dry-run self-test: passed");
