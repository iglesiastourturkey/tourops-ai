import { createHash } from "node:crypto";
import { z } from "zod";

const warningSchema = z.enum([
  "missing_agency",
  "missing_operator",
  "missing_adult_count",
  "missing_child_count",
  "missing_pickup_point",
  "missing_language",
  "missing_pickup_time",
]);

const stagingRecordSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
  requiresHumanApproval: z.literal(true),
  provenance: z.object({
    sourceFileId: z.string().trim().min(1),
    sourceKind: z.enum(["gemi", "sejour"]),
    worksheetName: z.string().min(1),
    sourceRow: z.number().int().positive(),
  }).strict(),
  customer: z.object({ fullName: z.string().trim().min(1) }).strict(),
  operation: z.object({
    sourceType: z.literal("historical_legacy"),
    sourceBookingReference: z.null(),
    startDate: z.string().regex(/^2026-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^2026-\d{2}-\d{2}$/),
    pickupTime: z.string().nullable(),
    notes: z.string().nullable(),
  }).strict(),
  reservationDetails: z.object({
    adultCount: z.number().finite().nullable(),
    childCount: z.number().finite().nullable(),
    passengerLanguage: z.string().nullable(),
    tourType: z.enum(["PVT", "REG"]),
    itineraryRaw: z.string().nullable(),
    pickupPoint: z.string().nullable(),
    externalSource: z.string().nullable(),
    externalOperator: z.string().nullable(),
    collectionStatusRaw: z.string().nullable(),
  }).strict(),
  warnings: z.array(warningSchema),
}).strict().superRefine((record, context) => {
  const expectedKey = `legacy:${record.provenance.sourceFileId}:${record.provenance.worksheetName}:${record.provenance.sourceRow}`;
  if (record.idempotencyKey !== expectedKey) {
    context.addIssue({ code: "custom", message: "sourceKey provenance ile uyusmuyor" });
  }
  if (record.operation.startDate !== record.operation.endDate) {
    context.addIssue({ code: "custom", message: "Historical operasyon tek gunluk olmali" });
  }
});

const stagingPackageSchema = z.object({
  version: z.literal(1),
  policyVersion: z.literal("phase3b-2026-v1"),
  generatedAt: z.string().min(1),
  sourceReportGeneratedAt: z.string().min(1),
  databaseWrites: z.literal(false),
  driveWrites: z.literal(false),
  requiresImportApproval: z.literal(true),
  records: z.array(stagingRecordSchema).max(5_000),
}).strict().superRefine((value, context) => {
  const keys = value.records.map(record => record.idempotencyKey);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "Staging paketinde tekrar eden sourceKey var" });
  }
});

export type HistoricalStagingPackage = z.infer<typeof stagingPackageSchema>;
export type HistoricalStagingRecord = HistoricalStagingPackage["records"][number];

export interface HistoricalStageRow {
  sourceKey: string;
  payloadSha256: string;
  sourceFileId: string;
  sourceKind: "gemi" | "sejour";
  worksheetName: string;
  sourceRow: number;
  operationDate: string;
  customerName: string;
  policyVersion: "phase3b-2026-v1";
  payload: HistoricalStagingRecord;
  warnings: HistoricalStagingRecord["warnings"];
  status: "pending";
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Payload canonical JSON'a cevrilemedi");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function parseHistoricalStagingPackage(input: unknown): HistoricalStagingPackage {
  return stagingPackageSchema.parse(input);
}

/** Parses one persisted Phase 3C payload before a correction can touch it. */
export function parseHistoricalStagingRecord(input: unknown): HistoricalStagingRecord {
  return stagingRecordSchema.parse(input);
}

/**
 * The payload digest used by Phase 3C.  Correction code deliberately calls
 * this shared function rather than carrying a second, subtly different JSON
 * canonicalisation implementation.
 */
export function sha256OfHistoricalStagingRecord(record: HistoricalStagingRecord): string {
  return createHash("sha256").update(canonicalJson(record)).digest("hex");
}

export function buildHistoricalStageRows(stagingPackage: HistoricalStagingPackage): HistoricalStageRow[] {
  return stagingPackage.records.map(record => ({
    sourceKey: record.idempotencyKey,
    payloadSha256: sha256OfHistoricalStagingRecord(record),
    sourceFileId: record.provenance.sourceFileId,
    sourceKind: record.provenance.sourceKind,
    worksheetName: record.provenance.worksheetName,
    sourceRow: record.provenance.sourceRow,
    operationDate: record.operation.startDate,
    customerName: record.customer.fullName,
    policyVersion: stagingPackage.policyVersion,
    payload: record,
    warnings: record.warnings,
    status: "pending",
  }));
}
