import type {
  HistoricalDryRunReport,
  HistoricalOperationCandidate,
} from "./historical-operation-parser";

export type HistoricalMigrationDisposition = "staging_ready" | "manual_review" | "blocked";

export type HistoricalMigrationWarning =
  | "missing_agency"
  | "missing_operator"
  | "missing_adult_count"
  | "missing_child_count"
  | "missing_pickup_point"
  | "missing_language"
  | "missing_pickup_time";

export interface HistoricalMigrationReviewItem {
  disposition: Exclude<HistoricalMigrationDisposition, "staging_ready">;
  sourceKey: string;
  sourceFileId: string;
  sourceKind: HistoricalOperationCandidate["sourceKind"];
  worksheetName: string;
  sourceRow: number;
  operationDate: string | null;
  customerName: string | null;
  issues: HistoricalOperationCandidate["issues"];
  warnings: HistoricalMigrationWarning[];
}

export interface HistoricalStagingRecord {
  idempotencyKey: string;
  requiresHumanApproval: true;
  provenance: {
    sourceFileId: string;
    sourceKind: HistoricalOperationCandidate["sourceKind"];
    worksheetName: string;
    sourceRow: number;
  };
  customer: {
    fullName: string;
  };
  operation: {
    sourceType: "historical_legacy";
    sourceBookingReference: null;
    startDate: string;
    endDate: string;
    pickupTime: string | null;
    notes: string | null;
  };
  reservationDetails: {
    adultCount: number | null;
    childCount: number | null;
    passengerLanguage: string | null;
    tourType: string;
    itineraryRaw: string | null;
    pickupPoint: string | null;
    externalSource: string | null;
    externalOperator: string | null;
    collectionStatusRaw: string | null;
  };
  warnings: HistoricalMigrationWarning[];
}

export interface HistoricalMigrationPreparation {
  reviewPackage: {
    version: 1;
    policyVersion: "phase3b-2026-v1";
    generatedAt: string;
    sourceReportGeneratedAt: string;
    scope: {
      year: 2026;
      databaseWrites: false;
      driveWrites: false;
      requiresImportApproval: true;
    };
    policy: {
      idempotencyKey: "sourceKey";
      bookingReference: "preserve_null";
      blankChildCount: "preserve_null";
      missingAgency: "preserve_null";
      duplicateContent: "manual_review";
      missingCustomerName: "blocked";
      otherMissingFields: "warning";
    };
    summary: {
      candidates: number;
      stagingReady: number;
      manualReview: number;
      blocked: number;
      warningCounts: Record<HistoricalMigrationWarning, number>;
    };
    reviewItems: HistoricalMigrationReviewItem[];
  };
  stagingPackage: {
    version: 1;
    policyVersion: "phase3b-2026-v1";
    generatedAt: string;
    sourceReportGeneratedAt: string;
    databaseWrites: false;
    driveWrites: false;
    requiresImportApproval: true;
    records: HistoricalStagingRecord[];
  };
}

const WARNING_FIELDS: Array<{
  code: HistoricalMigrationWarning;
  field: keyof HistoricalOperationCandidate;
}> = [
  { code: "missing_agency", field: "agency" },
  { code: "missing_operator", field: "operator" },
  { code: "missing_adult_count", field: "adultCount" },
  { code: "missing_child_count", field: "childCount" },
  { code: "missing_pickup_point", field: "pickupPoint" },
  { code: "missing_language", field: "language" },
  { code: "missing_pickup_time", field: "pickupTime" },
];

function warningsFor(candidate: HistoricalOperationCandidate): HistoricalMigrationWarning[] {
  return WARNING_FIELDS
    .filter(({ field }) => candidate[field] === null)
    .map(({ code }) => code);
}

function dispositionFor(candidate: HistoricalOperationCandidate): HistoricalMigrationDisposition {
  if (!candidate.operationDate || !candidate.customerName) return "blocked";

  if (
    candidate.issues.includes("possible_duplicate_content") ||
    candidate.issues.includes("ambiguous_duplicate_content") ||
    candidate.issues.includes("supplementary_booking_row")
  ) {
    return "manual_review";
  }

  return "staging_ready";
}

export function buildHistoricalMigrationPreparation(
  report: HistoricalDryRunReport,
  generatedAt = new Date().toISOString(),
): HistoricalMigrationPreparation {
  const warningCounts = Object.fromEntries(
    WARNING_FIELDS.map(({ code }) => [code, 0]),
  ) as Record<HistoricalMigrationWarning, number>;
  const reviewItems: HistoricalMigrationReviewItem[] = [];
  const records: HistoricalStagingRecord[] = [];
  let manualReview = 0;
  let blocked = 0;

  for (const candidate of report.candidates) {
    const warnings = warningsFor(candidate);
    for (const warning of warnings) warningCounts[warning] += 1;
    const disposition = dispositionFor(candidate);

    if (disposition !== "staging_ready") {
      if (disposition === "manual_review") manualReview += 1;
      else blocked += 1;
      reviewItems.push({
        disposition,
        sourceKey: candidate.sourceKey,
        sourceFileId: candidate.sourceFileId,
        sourceKind: candidate.sourceKind,
        worksheetName: candidate.worksheetName,
        sourceRow: candidate.sourceRow,
        operationDate: candidate.operationDate,
        customerName: candidate.customerName,
        issues: [...candidate.issues],
        warnings,
      });
      continue;
    }

    // dispositionFor only returns staging_ready when both values exist. Keep
    // this local guard so TypeScript and future refactors preserve that gate.
    if (!candidate.operationDate || !candidate.customerName) {
      throw new Error("Staging adayi tarih ve musteri adi olmadan hazirlanamaz");
    }

    records.push({
      idempotencyKey: candidate.sourceKey,
      requiresHumanApproval: true,
      provenance: {
        sourceFileId: candidate.sourceFileId,
        sourceKind: candidate.sourceKind,
        worksheetName: candidate.worksheetName,
        sourceRow: candidate.sourceRow,
      },
      customer: { fullName: candidate.customerName },
      operation: {
        sourceType: "historical_legacy",
        sourceBookingReference: null,
        startDate: candidate.operationDate,
        endDate: candidate.operationDate,
        pickupTime: candidate.pickupTime,
        notes: candidate.notesRaw,
      },
      reservationDetails: {
        adultCount: candidate.adultCount,
        childCount: candidate.childCount,
        passengerLanguage: candidate.language,
        tourType: candidate.reservationType,
        itineraryRaw: candidate.tourSectionRaw,
        pickupPoint: candidate.pickupPoint,
        externalSource: candidate.agency,
        externalOperator: candidate.operator,
        collectionStatusRaw: candidate.collectionStatusRaw,
      },
      warnings,
    });
  }

  const shared = {
    version: 1 as const,
    policyVersion: "phase3b-2026-v1" as const,
    generatedAt,
    sourceReportGeneratedAt: report.generatedAt,
  };

  return {
    reviewPackage: {
      ...shared,
      scope: {
        year: 2026,
        databaseWrites: false,
        driveWrites: false,
        requiresImportApproval: true,
      },
      policy: {
        idempotencyKey: "sourceKey",
        bookingReference: "preserve_null",
        blankChildCount: "preserve_null",
        missingAgency: "preserve_null",
        duplicateContent: "manual_review",
        missingCustomerName: "blocked",
        otherMissingFields: "warning",
      },
      summary: {
        candidates: report.candidates.length,
        stagingReady: records.length,
        manualReview,
        blocked,
        warningCounts,
      },
      reviewItems,
    },
    stagingPackage: {
      ...shared,
      databaseWrites: false,
      driveWrites: false,
      requiresImportApproval: true,
      records,
    },
  };
}
