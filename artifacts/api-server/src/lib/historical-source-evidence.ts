import { createHash } from "node:crypto";
import type ExcelJS from "exceljs";
import type { HistoricalSourceEvidenceCell } from "@workspace/db/schema";

export const EVIDENCE_HEADER_ALIASES = {
  type: ["type"],
  agency: ["agency"],
  operator: ["operator"],
  adult: ["adult"],
  child: ["chd", "child"],
  customerName: ["guestname", "fullname", "customername"],
  pickupPoint: ["puppoint", "pickuppoint"],
  language: ["dil", "language"],
  pickupTime: ["puptime", "pickuptime"],
  collection: ["tahsilat", "collection"],
  notes: ["notes", "notlar"],
} as const;

type HeaderKey = keyof typeof EVIDENCE_HEADER_ALIASES;
type HeaderMap = Partial<Record<HeaderKey, number>>;

export interface HistoricalEvidenceSnapshot {
  sourceKey: string;
  sourceFileId: string;
  workbookPath: string;
  workbookSha256: string;
  worksheetName: string;
  sourceRow: number;
  headerRow: number;
  cells: HistoricalSourceEvidenceCell[];
  evidenceSha256: string;
}

export function normalizeHistoricalHeader(value: string): string {
  return value.trim().toLowerCase()
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

export function historicalCellDisplay(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim() || null;
  }
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim() || null;
    if ("result" in value) return historicalCellDisplay(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map(part => typeof part.text === "string" ? part.text : "").join("").trim() || null;
    }
  }
  return null;
}

function rawEvidenceValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    if ("formula" in value) {
      return {
        formula: typeof value.formula === "string" ? value.formula : null,
        result: "result" in value ? rawEvidenceValue(value.result as ExcelJS.CellValue) : null,
      };
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return { richText: value.richText.map(part => typeof part.text === "string" ? part.text : "") };
    }
    if ("text" in value && typeof value.text === "string") return { text: value.text };
  }
  return historicalCellDisplay(value);
}

function discoverHeader(row: ExcelJS.Row): HeaderMap | null {
  const map: HeaderMap = {};
  row.eachCell({ includeEmpty: false }, (cell, column) => {
    const normalized = normalizeHistoricalHeader(historicalCellDisplay(cell.value) ?? "");
    for (const [key, aliases] of Object.entries(EVIDENCE_HEADER_ALIASES) as [HeaderKey, readonly string[]][]) {
      if (!map[key] && aliases.includes(normalized)) map[key] = column;
    }
  });
  return map.type && map.customerName && map.adult ? map : null;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function sha256OfHistoricalEvidence(value: Omit<HistoricalEvidenceSnapshot, "evidenceSha256">): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Build a source-faithful row snapshot using the last valid header above it. */
export function buildHistoricalEvidenceSnapshot(params: {
  worksheet: ExcelJS.Worksheet;
  sourceKey: string;
  sourceFileId: string;
  workbookPath: string;
  workbookSha256: string;
  sourceRow: number;
}): HistoricalEvidenceSnapshot {
  let headerRow = 0;
  let headerMap: HeaderMap | null = null;
  for (let rowNumber = 1; rowNumber < params.sourceRow; rowNumber += 1) {
    const discovered = discoverHeader(params.worksheet.getRow(rowNumber));
    if (discovered) {
      headerRow = rowNumber;
      headerMap = discovered;
    }
  }
  if (!headerMap || headerRow === 0) throw new Error(`Evidence header bulunamadi: ${params.sourceKey}`);

  // Operational columns plus one adjacent column on each side. This captures
  // B=Operator/C=Type-style context without storing the whole worksheet.
  const selected = new Set<number>();
  for (const column of Object.values(headerMap)) {
    if (!column) continue;
    selected.add(column);
    if (column > 1) selected.add(column - 1);
    selected.add(column + 1);
  }
  const source = params.worksheet.getRow(params.sourceRow);
  const headers = params.worksheet.getRow(headerRow);
  const cells = [...selected].sort((a, b) => a - b).map(column => {
    const cell = source.getCell(column);
    const displayValue = historicalCellDisplay(cell.value);
    return {
      address: cell.address,
      column,
      header: historicalCellDisplay(headers.getCell(column).value),
      rawValue: rawEvidenceValue(cell.value),
      displayValue,
      isBlank: displayValue === null,
    } satisfies HistoricalSourceEvidenceCell;
  });
  const base = {
    sourceKey: params.sourceKey,
    sourceFileId: params.sourceFileId,
    workbookPath: params.workbookPath,
    workbookSha256: params.workbookSha256,
    worksheetName: params.worksheet.name,
    sourceRow: params.sourceRow,
    headerRow,
    cells,
  };
  return { ...base, evidenceSha256: sha256OfHistoricalEvidence(base) };
}

export function evidenceSnapshotMatches(
  existing: { sourceKey: string; sourceFileId: string; worksheetName: string; sourceRow: number; workbookSha256: string; evidenceSha256: string },
  planned: HistoricalEvidenceSnapshot,
): boolean {
  return existing.sourceKey === planned.sourceKey
    && existing.sourceFileId === planned.sourceFileId
    && existing.worksheetName === planned.worksheetName
    && existing.sourceRow === planned.sourceRow
    && existing.workbookSha256 === planned.workbookSha256
    && existing.evidenceSha256 === planned.evidenceSha256;
}
