import { createHash } from "node:crypto";
import type ExcelJS from "exceljs";

export type LegacySourceKind = "gemi" | "sejour";

export interface HistoricalWorkbookDescriptor {
  path: string;
  sourceFileId: string;
  sourceKind: LegacySourceKind;
  year: 2026;
  month: number;
}

export type HistoricalCandidateIssue =
  | "missing_operation_date"
  | "missing_customer_name"
  | "missing_booking_reference"
  | "possible_duplicate_content";

export interface HistoricalOperationCandidate {
  sourceKey: string;
  contentFingerprint: string;
  sourceFileId: string;
  sourceKind: LegacySourceKind;
  worksheetName: string;
  sourceRow: number;
  operationDate: string | null;
  reservationType: string;
  agency: string | null;
  operator: string | null;
  adultCount: number | null;
  childCount: number | null;
  customerName: string | null;
  pickupPoint: string | null;
  language: string | null;
  pickupTime: string | null;
  collectionStatusRaw: string | null;
  notesRaw: string | null;
  tourSectionRaw: string | null;
  sourceBookingReference: null;
  disposition: "ready" | "review_required";
  issues: HistoricalCandidateIssue[];
}

export interface HistoricalDryRunReport {
  version: 1;
  generatedAt: string;
  scope: {
    year: 2026;
    sourceKinds: LegacySourceKind[];
    databaseWrites: false;
    driveWrites: false;
  };
  summary: {
    workbooks: number;
    worksheets: number;
    candidates: number;
    ready: number;
    reviewRequired: number;
    possibleDuplicates: number;
  };
  candidates: HistoricalOperationCandidate[];
}

type HeaderKey =
  | "type"
  | "agency"
  | "operator"
  | "adult"
  | "child"
  | "customerName"
  | "pickupPoint"
  | "language"
  | "pickupTime"
  | "collection"
  | "notes";

type HeaderMap = Partial<Record<HeaderKey, number>>;

const HEADER_ALIASES: Record<HeaderKey, string[]> = {
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
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

function cellText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text || null;
  }
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim() || null;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      const text = value.richText
        .map((part: { text?: unknown }) => typeof part.text === "string" ? part.text : "")
        .join("")
        .trim();
      return text || null;
    }
  }
  return null;
}

function numberValue(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value)?.replace(/[^\d.,-]/g, "") ?? "";
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function findHeaderMap(row: ExcelJS.Row): HeaderMap | null {
  const map: HeaderMap = {};
  row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const normalized = normalizeText(cellText(cell.value) ?? "");
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [HeaderKey, string[]][]) {
      if (!map[key] && aliases.includes(normalized)) map[key] = columnNumber;
    }
  });
  return map.type && map.customerName && map.adult ? map : null;
}

function sectionTitle(row: ExcelJS.Row): string | null {
  let selected: string | null = null;
  row.eachCell({ includeEmpty: false }, cell => {
    const text = cellText(cell.value);
    if (!text) return;
    const normalized = normalizeText(text);
    if (/tour|tur|transfer|activit/.test(normalized) && text.length >= 8) selected = text;
  });
  return selected;
}

function getText(row: ExcelJS.Row, map: HeaderMap, key: HeaderKey): string | null {
  const column = map[key];
  return column ? cellText(row.getCell(column).value) : null;
}

function getNumber(row: ExcelJS.Row, map: HeaderMap, key: HeaderKey): number | null {
  const column = map[key];
  return column ? numberValue(row.getCell(column).value) : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function operationDateFromWorksheet(
  worksheetName: string,
  year: 2026,
  month: number,
): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const dayToken = worksheetName.match(/(?:^|\D)(\d{1,2})(?:\D|$)/)?.[1];
  if (!dayToken) return null;
  const day = Number.parseInt(dayToken, 10);
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fingerprint(candidate: Omit<HistoricalOperationCandidate, "contentFingerprint" | "disposition" | "issues">): string {
  const canonical = [
    candidate.operationDate,
    normalizeText(candidate.reservationType),
    normalizeText(candidate.customerName ?? ""),
    normalizeText(candidate.pickupPoint ?? ""),
    normalizeText(candidate.pickupTime ?? ""),
    candidate.adultCount,
    candidate.childCount,
    normalizeText(candidate.agency ?? ""),
    normalizeText(candidate.operator ?? ""),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export function parseHistoricalWorksheet(
  worksheet: ExcelJS.Worksheet,
  descriptor: HistoricalWorkbookDescriptor,
): HistoricalOperationCandidate[] {
  const candidates: HistoricalOperationCandidate[] = [];
  const operationDate = operationDateFromWorksheet(worksheet.name, descriptor.year, descriptor.month);
  let headers: HeaderMap | null = null;
  let currentSection: string | null = null;

  worksheet.eachRow({ includeEmpty: false }, row => {
    const title = sectionTitle(row);
    if (title) currentSection = title;

    const discoveredHeaders = findHeaderMap(row);
    if (discoveredHeaders) {
      headers = discoveredHeaders;
      return;
    }
    if (!headers) return;

    const reservationType = getText(row, headers, "type")?.trim().toUpperCase() ?? "";
    if (!/^(PVT|REG)$/.test(reservationType)) return;

    const base = {
      sourceKey: `legacy:${descriptor.sourceFileId}:${worksheet.name}:${row.number}`,
      sourceFileId: descriptor.sourceFileId,
      sourceKind: descriptor.sourceKind,
      worksheetName: worksheet.name,
      sourceRow: row.number,
      operationDate,
      reservationType,
      agency: getText(row, headers, "agency"),
      operator: getText(row, headers, "operator"),
      adultCount: getNumber(row, headers, "adult"),
      childCount: getNumber(row, headers, "child"),
      customerName: getText(row, headers, "customerName"),
      pickupPoint: getText(row, headers, "pickupPoint"),
      language: getText(row, headers, "language"),
      pickupTime: getText(row, headers, "pickupTime"),
      collectionStatusRaw: getText(row, headers, "collection"),
      notesRaw: getText(row, headers, "notes"),
      tourSectionRaw: currentSection,
      sourceBookingReference: null,
    } satisfies Omit<HistoricalOperationCandidate, "contentFingerprint" | "disposition" | "issues">;

    const issues: HistoricalCandidateIssue[] = ["missing_booking_reference"];
    if (!base.operationDate) issues.push("missing_operation_date");
    if (!base.customerName) issues.push("missing_customer_name");
    const disposition = base.operationDate && base.customerName ? "ready" : "review_required";
    candidates.push({
      ...base,
      contentFingerprint: fingerprint(base),
      disposition,
      issues,
    });
  });

  return candidates;
}

export function buildHistoricalDryRunReport(
  parsedWorkbooks: Array<{ descriptor: HistoricalWorkbookDescriptor; workbook: ExcelJS.Workbook }>,
  generatedAt = new Date().toISOString(),
): HistoricalDryRunReport {
  const candidates = parsedWorkbooks.flatMap(({ descriptor, workbook }) =>
    workbook.worksheets.flatMap(worksheet => parseHistoricalWorksheet(worksheet, descriptor)),
  );

  const byFingerprint = new Map<string, HistoricalOperationCandidate[]>();
  for (const candidate of candidates) {
    const matches = byFingerprint.get(candidate.contentFingerprint) ?? [];
    matches.push(candidate);
    byFingerprint.set(candidate.contentFingerprint, matches);
  }
  for (const matches of byFingerprint.values()) {
    if (matches.length < 2) continue;
    for (const candidate of matches) {
      if (!candidate.issues.includes("possible_duplicate_content")) {
        candidate.issues.push("possible_duplicate_content");
      }
    }
  }

  return {
    version: 1,
    generatedAt,
    scope: {
      year: 2026,
      sourceKinds: [...new Set(parsedWorkbooks.map(item => item.descriptor.sourceKind))],
      databaseWrites: false,
      driveWrites: false,
    },
    summary: {
      workbooks: parsedWorkbooks.length,
      worksheets: parsedWorkbooks.reduce((sum, item) => sum + item.workbook.worksheets.length, 0),
      candidates: candidates.length,
      ready: candidates.filter(item => item.disposition === "ready").length,
      reviewRequired: candidates.filter(item => item.disposition === "review_required").length,
      possibleDuplicates: candidates.filter(item => item.issues.includes("possible_duplicate_content")).length,
    },
    candidates,
  };
}
