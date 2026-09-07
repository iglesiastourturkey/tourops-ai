import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildHistoricalEvidenceSnapshot } from "./lib/historical-source-evidence";

const workbook = new ExcelJS.Workbook();
for (let index = 1; index <= 27; index += 1) workbook.addWorksheet(String(index));
const sheet = workbook.getWorksheet("27")!;
sheet.getCell("A101").value = "Guest Name";
sheet.getCell("B101").value = "Operator";
sheet.getCell("C101").value = "Type";
sheet.getCell("D101").value = "Adult";
sheet.getCell("A105").value = "Regression Guest";
sheet.getCell("B105").value = null;
sheet.getCell("C105").value = "VIATOR";
sheet.getCell("D105").value = 2;

const snapshot = buildHistoricalEvidenceSnapshot({
  worksheet: sheet,
  sourceKey: "legacy:test:27:105",
  sourceFileId: "test",
  workbookPath: "GEMI/4.AY - NISAN.xlsx",
  workbookSha256: "a".repeat(64),
  sourceRow: 105,
});
const operator = snapshot.cells.find(cell => cell.address === "B105");
const type = snapshot.cells.find(cell => cell.address === "C105");
assert.deepEqual(operator, { address: "B105", column: 2, header: "Operator", rawValue: null, displayValue: null, isBlank: true });
assert.equal(type?.header, "Type");
assert.equal(type?.displayValue, "VIATOR");
assert.equal(operator?.displayValue, null, "VIATOR must never be interpreted as Operator");

process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
const { deriveHistoricalRemediationState } = await import("./lib/historical-remediation-read");
assert.equal(deriveHistoricalRemediationState(["missing_agency", "missing_child_count"]), "READY_FOR_REVIEW");
assert.equal(deriveHistoricalRemediationState(["missing_operator", "missing_child_count"]), "UNRESOLVED");
console.log("historical source evidence self-test: 7 assertions passed");
