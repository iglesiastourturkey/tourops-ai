import { z } from "zod";
import {
  buildPromotionProjectionFromStaging,
  sha256OfProjection,
} from "./historical-migration-promote-validation";
import {
  parseHistoricalStagingRecord,
  sha256OfHistoricalStagingRecord,
  type HistoricalStagingRecord,
} from "./historical-migration-stage-validation";

export const HISTORICAL_PICKUP_TIME_SENTINEL = /^1899-12-30T(\d{2}):(\d{2}):00\.000Z$/;
export const CANONICAL_PICKUP_TIME = /^\d{2}:\d{2}$/;
export const SHA256 = /^[0-9a-f]{64}$/;

export type PickupTimeCorrectionClassification =
  | "eligible_pending"
  | "eligible_imported"
  | "already_canonical"
  | "malformed_or_unsupported"
  | "payload_integrity_failed"
  | "missing_imported_operation"
  | "operation_pickup_conflict"
  | "unsupported_status"
  | "source_not_found";

export interface HistoricalPickupTimeCorrectionCandidate {
  sourceKey: string;
  oldPickupTime: string;
  newPickupTime: string;
  // Report provenance only. contentFingerprint is not a staging-column hash,
  // so it is never written as payload_sha256 or promoted_content_sha256.
  contentFingerprintBefore: string;
  contentFingerprintAfter: string;
  payloadSha256Before: string;
  payloadSha256After: string;
}

export interface HistoricalPickupTimeCorrectionPackage {
  mode: "historical-pickup-time-correction";
  version: 1;
  kind: "historical-pickup-time-correction";
  generatedAt: string;
  sourceReportGeneratedAt: string;
  databaseWrites: false;
  records: HistoricalPickupTimeCorrectionCandidate[];
}

const sourceKeySchema = z.string().regex(/^legacy:[^:]+:[^:]+:[1-9]\d*$/);
const candidateSchema = z.object({
  sourceKey: sourceKeySchema,
  oldPickupTime: z.string(),
  newPickupTime: z.string().regex(CANONICAL_PICKUP_TIME),
  contentFingerprintBefore: z.string().regex(SHA256),
  contentFingerprintAfter: z.string().regex(SHA256),
  payloadSha256Before: z.string().regex(SHA256),
  payloadSha256After: z.string().regex(SHA256),
}).strict().superRefine((candidate, context) => {
  const target = canonicalPickupTimeFromSentinel(candidate.oldPickupTime);
  if (target === null) {
    context.addIssue({ code: "custom", message: "oldPickupTime proven Excel sentinel formunda degil" });
  } else if (candidate.newPickupTime !== target) {
    context.addIssue({ code: "custom", message: "newPickupTime oldPickupTime degerinden deterministik turemiyor" });
  }
  if (candidate.payloadSha256Before === candidate.payloadSha256After) {
    context.addIssue({ code: "custom", message: "Pickup-time correction payload hash degistirmelidir" });
  }
  if (candidate.contentFingerprintBefore === candidate.contentFingerprintAfter) {
    context.addIssue({ code: "custom", message: "Pickup-time correction contentFingerprint degismelidir" });
  }
});

const correctionPackageSchema = z.object({
  mode: z.literal("historical-pickup-time-correction"),
  version: z.literal(1),
  kind: z.literal("historical-pickup-time-correction"),
  generatedAt: z.string().min(1),
  sourceReportGeneratedAt: z.string().min(1),
  databaseWrites: z.literal(false),
  records: z.array(candidateSchema).min(1).max(5_000),
}).strict().superRefine((value, context) => {
  const sourceKeys = value.records.map(record => record.sourceKey);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    context.addIssue({ code: "custom", message: "Correction package tekrar eden sourceKey iceremez" });
  }
});

export interface HistoricalImportCorrectionState {
  id: number;
  sourceKey: string;
  sourceFileId: string;
  worksheetName: string;
  sourceRow: number;
  status: string;
  payload: unknown;
  payloadSha256: string;
  importedOperationId: number | null;
  promotedContentSha256: string | null;
  // CAS token for this row's content, same convention as
  // historical-remediation-mutation.ts - every field correction bumps it,
  // not only approve/reject.
  approvalVersion: number;
}

export interface ImportedOperationCorrectionState {
  id: number;
  sourceHistoricalKey: string | null;
  pickupTime: string | null;
  // CAS token for this operation row, same convention as routes/field.ts
  // (status/assignment updates) - every mutation bumps it.
  version: number;
}

export interface PickupTimeCorrectionAssessment {
  classification: PickupTimeCorrectionClassification;
  sourceKey: string;
  historicalImportId: number | null;
  operationId: number | null;
  oldPickupTime: string;
  newPickupTime: string;
  correctedPayload: HistoricalStagingRecord | null;
  correctedPayloadSha256: string | null;
  correctedPromotedContentSha256: string | null;
}

export function canonicalPickupTimeFromSentinel(value: string): string | null {
  const match = HISTORICAL_PICKUP_TIME_SENTINEL.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${match[1]}:${match[2]}`;
}

export function parseHistoricalPickupTimeCorrectionPackage(input: unknown): HistoricalPickupTimeCorrectionPackage {
  return correctionPackageSchema.parse(input);
}

export function correctionPackageBySourceKey(
  input: HistoricalPickupTimeCorrectionPackage,
): Map<string, HistoricalPickupTimeCorrectionCandidate> {
  return new Map(input.records.map(record => [record.sourceKey, record]));
}

function exactSourceIdentityMatches(
  row: HistoricalImportCorrectionState,
  payload: HistoricalStagingRecord,
): boolean {
  const expected = `legacy:${row.sourceFileId}:${row.worksheetName}:${row.sourceRow}`;
  return row.sourceKey === expected
    && payload.idempotencyKey === expected
    && payload.provenance.sourceFileId === row.sourceFileId
    && payload.provenance.worksheetName === row.worksheetName
    && payload.provenance.sourceRow === row.sourceRow;
}

function correctedPayload(payload: HistoricalStagingRecord, pickupTime: string): HistoricalStagingRecord {
  return {
    ...payload,
    operation: {
      ...payload.operation,
      pickupTime,
    },
  };
}

function assessmentBase(candidate: HistoricalPickupTimeCorrectionCandidate, row: HistoricalImportCorrectionState | null) {
  return {
    sourceKey: candidate.sourceKey,
    historicalImportId: row?.id ?? null,
    operationId: row?.importedOperationId ?? null,
    oldPickupTime: candidate.oldPickupTime,
    newPickupTime: candidate.newPickupTime,
    correctedPayload: null,
    correctedPayloadSha256: null,
    correctedPromotedContentSha256: null,
  };
}

/**
 * Pure decision table used by PLAN and re-run under the APPLY row locks.
 * The package contains both pre/post payload hashes, so a package cannot
 * silently correct a row whose unrelated content changed since dry-run.
 */
export function assessHistoricalPickupTimeCorrection(params: {
  candidate: HistoricalPickupTimeCorrectionCandidate;
  historicalImport: HistoricalImportCorrectionState | null;
  operation: ImportedOperationCorrectionState | null;
}): PickupTimeCorrectionAssessment {
  const base = assessmentBase(params.candidate, params.historicalImport);
  const row = params.historicalImport;
  if (row === null) return { ...base, classification: "source_not_found" };

  let payload: HistoricalStagingRecord;
  try {
    payload = parseHistoricalStagingRecord(row.payload);
  } catch {
    return { ...base, classification: "payload_integrity_failed" };
  }
  if (!exactSourceIdentityMatches(row, payload)) {
    return { ...base, classification: "payload_integrity_failed" };
  }
  if (sha256OfHistoricalStagingRecord(payload) !== row.payloadSha256) {
    return { ...base, classification: "payload_integrity_failed" };
  }

  const actualPickupTime = payload.operation.pickupTime;
  const isBefore = actualPickupTime === params.candidate.oldPickupTime
    && row.payloadSha256 === params.candidate.payloadSha256Before;
  const isAfter = actualPickupTime === params.candidate.newPickupTime
    && row.payloadSha256 === params.candidate.payloadSha256After;
  if (!isBefore && !isAfter) {
    return { ...base, classification: "malformed_or_unsupported" };
  }

  const nextPayload = correctedPayload(payload, params.candidate.newPickupTime);
  const nextPayloadSha256 = sha256OfHistoricalStagingRecord(nextPayload);
  if (nextPayloadSha256 !== params.candidate.payloadSha256After) {
    return { ...base, classification: "payload_integrity_failed" };
  }
  if (row.status !== "pending" && row.status !== "imported") {
    return { ...base, classification: "unsupported_status" };
  }

  const nextProjectionHash = sha256OfProjection(
    buildPromotionProjectionFromStaging(row.sourceKey, nextPayload),
  );
  if (row.status === "pending") {
    return {
      ...base,
      classification: isAfter ? "already_canonical" : "eligible_pending",
      correctedPayload: nextPayload,
      correctedPayloadSha256: nextPayloadSha256,
      correctedPromotedContentSha256: null,
    };
  }

  if (row.importedOperationId === null || params.operation === null) {
    return { ...base, classification: "missing_imported_operation" };
  }
  if (params.operation.id !== row.importedOperationId || params.operation.sourceHistoricalKey !== row.sourceKey) {
    return { ...base, classification: "operation_pickup_conflict" };
  }
  const expectedPromotedHash = sha256OfProjection(buildPromotionProjectionFromStaging(row.sourceKey, payload));
  if (row.promotedContentSha256 !== expectedPromotedHash) {
    return { ...base, classification: "payload_integrity_failed" };
  }
  if (isAfter && params.operation.pickupTime === params.candidate.newPickupTime) {
    return {
      ...base,
      classification: "already_canonical",
      correctedPayload: nextPayload,
      correctedPayloadSha256: nextPayloadSha256,
      correctedPromotedContentSha256: nextProjectionHash,
    };
  }
  if (!isBefore || params.operation.pickupTime !== params.candidate.oldPickupTime) {
    return { ...base, classification: "operation_pickup_conflict" };
  }
  return {
    ...base,
    classification: "eligible_imported",
    correctedPayload: nextPayload,
    correctedPayloadSha256: nextPayloadSha256,
    correctedPromotedContentSha256: nextProjectionHash,
  };
}

/** Staging-only guard shared by PLAN and APPLY; never logs the URL. */
export function validateHistoricalPickupTimeCorrectionTarget(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "production") {
    throw new Error("Production ortaminda historical pickup-time correction calistirilamaz");
  }
  const connectionString = env.HISTORICAL_STAGING_DATABASE_URL;
  const allowedHost = env.HISTORICAL_STAGING_DATABASE_HOST;
  if (!connectionString || !allowedHost) {
    throw new Error("HISTORICAL_STAGING_DATABASE_URL ve HISTORICAL_STAGING_DATABASE_HOST gerekli");
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Historical pickup-time correction baglanti URL'i gecersiz");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("Historical pickup-time correction baglantisi PostgreSQL olmali");
  }
  if (url.hostname !== allowedHost || !allowedHost.endsWith(".neon.tech")) {
    throw new Error("Historical pickup-time correction host allowlist veya Neon kontrolu basarisiz");
  }
  return connectionString;
}
