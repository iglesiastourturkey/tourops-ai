import { db } from "@workspace/db";
import { historicalOperationImportsTable, historicalSourceEvidenceTable } from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { parseHistoricalStagingRecord, sha256OfHistoricalStagingRecord } from "./historical-migration-stage-validation";
import { deriveHistoricalReviewReadiness } from "./historical-remediation-review-readiness";

export const REMEDIATION_WARNING_FIELDS = {
  missing_agency: "externalSource",
  missing_child_count: "childCount",
  missing_pickup_time: "pickupTime",
  missing_language: "passengerLanguage",
  missing_pickup_point: "pickupPoint",
  missing_adult_count: "adultCount",
  missing_operator: "externalOperator",
} as const;

export const RESIDUAL_REVIEW_WARNINGS = new Set(["missing_agency", "missing_child_count"]);
export type HistoricalRemediationState = "UNRESOLVED" | "READY_FOR_REVIEW";

export function deriveHistoricalRemediationState(warnings: readonly string[]): HistoricalRemediationState {
  // List/detail reads are pending-only; the status-aware 3E.4 helper keeps
  // this projection identical on real data while guaranteeing non-pending
  // rows can never derive READY_FOR_REVIEW.
  return deriveHistoricalReviewReadiness("pending", warnings);
}

export function warningProfile(warnings: readonly string[]): string {
  return [...warnings].sort().join(" + ");
}

export interface HistoricalRemediationFilters {
  missingField?: string;
  workbook?: string;
  month?: string;
  warningProfile?: string;
  sourceKind?: string;
  externalSource?: string;
  externalOperator?: string;
  derivedState?: HistoricalRemediationState;
  search?: string;
  page: number;
  pageSize: number;
}

type ReadRow = {
  historical: typeof historicalOperationImportsTable.$inferSelect;
  evidence: typeof historicalSourceEvidenceTable.$inferSelect | null;
};

function projectQueueRow(row: ReadRow) {
  const payload = parseHistoricalStagingRecord(row.historical.payload);
  const missingFields: string[] = row.historical.warnings
    .filter(warning => warning in REMEDIATION_WARNING_FIELDS)
    .map(warning => REMEDIATION_WARNING_FIELDS[warning as keyof typeof REMEDIATION_WARNING_FIELDS]);
  return {
    id: row.historical.id,
    sourceKey: row.historical.sourceKey,
    operationDate: row.historical.operationDate,
    customerName: row.historical.customerName,
    sourceKind: row.historical.sourceKind,
    sourceFileId: row.historical.sourceFileId,
    workbookPath: row.evidence?.workbookPath ?? null,
    worksheetName: row.historical.worksheetName,
    sourceRow: row.historical.sourceRow,
    warnings: row.historical.warnings,
    warningProfile: warningProfile(row.historical.warnings),
    missingFields,
    externalSource: payload.reservationDetails.externalSource,
    externalOperator: payload.reservationDetails.externalOperator,
    derivedState: deriveHistoricalRemediationState(row.historical.warnings),
    hasSourceEvidence: row.evidence !== null,
  };
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase("tr-TR") ?? "";
}

export function filterHistoricalRemediationRows(rows: ReturnType<typeof projectQueueRow>[], filters: HistoricalRemediationFilters) {
  const search = normalized(filters.search);
  return rows.filter(row => {
    if (filters.missingField && !row.missingFields.includes(filters.missingField)) return false;
    if (filters.workbook && row.workbookPath !== filters.workbook) return false;
    if (filters.month && !row.operationDate.startsWith(filters.month)) return false;
    if (filters.warningProfile && row.warningProfile !== filters.warningProfile) return false;
    if (filters.sourceKind && row.sourceKind !== filters.sourceKind) return false;
    if (filters.externalSource && (filters.externalSource === "__blank__" ? row.externalSource !== null : row.externalSource !== filters.externalSource)) return false;
    if (filters.externalOperator && (filters.externalOperator === "__blank__" ? row.externalOperator !== null : row.externalOperator !== filters.externalOperator)) return false;
    if (filters.derivedState && row.derivedState !== filters.derivedState) return false;
    if (search && ![row.sourceKey, row.customerName, row.workbookPath, row.worksheetName, row.externalSource, row.externalOperator]
      .some(value => normalized(value).includes(search))) return false;
    return true;
  });
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "tr"));
}

export async function listHistoricalRemediation(filters: HistoricalRemediationFilters) {
  const raw = await db.select({ historical: historicalOperationImportsTable, evidence: historicalSourceEvidenceTable })
    .from(historicalOperationImportsTable)
    .leftJoin(historicalSourceEvidenceTable, eq(historicalSourceEvidenceTable.historicalImportId, historicalOperationImportsTable.id))
    .where(eq(historicalOperationImportsTable.status, "pending"))
    .orderBy(asc(historicalOperationImportsTable.operationDate), asc(historicalOperationImportsTable.id));
  const all = raw.map(projectQueueRow);
  const filtered = filterHistoricalRemediationRows(all, filters);
  const offset = (filters.page - 1) * filters.pageSize;
  return {
    mode: "historical-remediation-read-only",
    databaseWrites: false,
    total: filtered.length,
    page: filters.page,
    pageSize: filters.pageSize,
    rows: filtered.slice(offset, offset + filters.pageSize),
    facets: {
      workbooks: unique(all.map(row => row.workbookPath)),
      months: unique(all.map(row => row.operationDate.slice(0, 7))),
      warningProfiles: unique(all.map(row => row.warningProfile)),
      sourceKinds: unique(all.map(row => row.sourceKind)),
      externalSources: unique(all.map(row => row.externalSource)),
      externalOperators: unique(all.map(row => row.externalOperator)),
    },
  };
}

export async function getHistoricalRemediationDetail(id: number) {
  const [row] = await db.select({ historical: historicalOperationImportsTable, evidence: historicalSourceEvidenceTable })
    .from(historicalOperationImportsTable)
    .leftJoin(historicalSourceEvidenceTable, eq(historicalSourceEvidenceTable.historicalImportId, historicalOperationImportsTable.id))
    .where(and(eq(historicalOperationImportsTable.id, id), eq(historicalOperationImportsTable.status, "pending")))
    .limit(1);
  if (!row) return null;
  const payload = parseHistoricalStagingRecord(row.historical.payload);
  return {
    ...projectQueueRow(row),
    status: row.historical.status,
    // Phase 3E.3: expose the CAS token the Phase 3E.2 mutation engine compares
    // against (approvalVersion). Read-only surfacing — mutation semantics are
    // untouched; the detail read stays pending-only and writes nothing.
    approvalVersion: row.historical.approvalVersion,
    payloadSha256: row.historical.payloadSha256,
    payloadHashIntegrity: sha256OfHistoricalStagingRecord(payload) === row.historical.payloadSha256,
    historicalRecord: {
      customer: payload.customer.fullName,
      date: payload.operation.startDate,
      reservationType: payload.reservationDetails.tourType,
      adultCount: payload.reservationDetails.adultCount,
      childCount: payload.reservationDetails.childCount,
      tour: payload.reservationDetails.itineraryRaw,
      pickupPoint: payload.reservationDetails.pickupPoint,
      pickupTime: payload.operation.pickupTime,
      passengerLanguage: payload.reservationDetails.passengerLanguage,
      externalOperator: payload.reservationDetails.externalOperator,
      externalSource: payload.reservationDetails.externalSource,
      notes: payload.operation.notes,
    },
    provenance: payload.provenance,
    evidence: row.evidence ? {
      workbookPath: row.evidence.workbookPath,
      workbookSha256: row.evidence.workbookSha256,
      worksheetName: row.evidence.worksheetName,
      sourceRow: row.evidence.sourceRow,
      headerRow: row.evidence.headerRow,
      cells: row.evidence.cells,
      evidenceSha256: row.evidence.evidenceSha256,
      capturedAt: row.evidence.capturedAt,
    } : null,
  };
}
