import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { historicalCellDisplay, normalizeHistoricalHeader } from "./lib/historical-source-evidence";
import { summarizeHistoricalContacts, type HistoricalContact } from "./lib/historical-customer-projection";

const aliases = {
  type: ["type"],
  name: ["guestname", "fullname", "customername", "misafiradi", "musteriadi", "yolcuadi"],
  email: ["email", "emailadresi", "eposta", "mail"],
  phone: ["phone", "telephone", "telefon", "tel", "mobile", "mobil", "ceptelefonu", "whatsapp"],
  notes: ["notes", "notlar", "operasyonnotlari"],
} as const;

export function auditHistoricalWorkbook(workbook: ExcelJS.Workbook, sourceFileId: string): HistoricalContact[] {
  const result: HistoricalContact[] = [];
  for (const sheet of workbook.worksheets) {
    let columns: Partial<Record<keyof typeof aliases, number>> | null = null;
    sheet.eachRow({ includeEmpty: false }, row => {
      const found: Partial<Record<keyof typeof aliases, number>> = {};
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        const header = normalizeHistoricalHeader(historicalCellDisplay(cell.value) ?? "");
        for (const [key, values] of Object.entries(aliases) as [keyof typeof aliases, readonly string[]][]) {
          if (values.includes(header)) found[key] = column;
        }
      });
      if (found.type && found.name) { columns = found; return; }
      if (!columns) return;
      const value = (key: keyof typeof aliases) => columns?.[key] ? historicalCellDisplay(row.getCell(columns[key]!).value) : null;
      if (!/^(PVT|REG)$/i.test(value("type") ?? "")) return;
      const fullName = value("name");
      let email = value("email"), phone = value("phone");
      // The authoritative 2026 workbooks contain contact data in trailing,
      // sometimes unlabeled columns (observed as M). Scan only cells to the
      // right of the operational header block; never reinterpret PAX, money,
      // dates or pickup-time columns as contact identity.
      const operationalEnd = Math.max(...Object.values(columns).filter((column): column is number => Boolean(column)));
      for (let column = operationalEnd + 1; column <= row.cellCount; column += 1) {
        const candidate = historicalCellDisplay(row.getCell(column).value);
        if (!candidate) continue;
        if (!email) email = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
        const digits = candidate.replace(/\D/g, "");
        if (!phone && digits.length >= 7 && digits.length <= 15) phone = candidate;
      }
      if (fullName || email || phone) result.push({ sourceKey: `legacy:${sourceFileId}:${sheet.name}:${row.number}`, fullName, email, phone });
    });
  }
  return result;
}

async function main() {
  const manifestArg = process.argv[process.argv.indexOf("--manifest") + 1];
  if (!manifestArg) throw new Error("--manifest gerekli");
  const manifestPath = resolve(manifestArg);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: { path: string; sourceFileId: string }[] };
  const contacts: HistoricalContact[] = [];
  const auditedFiles: string[] = [];
  for (const file of manifest.files) {
    const path = resolve(dirname(manifestPath), file.path);
    if (!new Set([".xlsx", ".xlsm"]).has(extname(path).toLowerCase())) throw new Error(`Desteklenmeyen kaynak: ${path}`);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path);
    contacts.push(...auditHistoricalWorkbook(workbook, file.sourceFileId)); auditedFiles.push(path);
  }
  console.log(JSON.stringify({ mode: "HISTORICAL_CONTACT_SOURCE_AUDIT", databaseWrites: false, auditedFiles, ...summarizeHistoricalContacts(contacts) }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
