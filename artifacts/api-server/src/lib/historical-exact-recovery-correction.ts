import { parseHistoricalStagingRecord, sha256OfHistoricalStagingRecord, type HistoricalStagingRecord } from "./historical-migration-stage-validation";

export const EXACT_RECOVERY_CONFIRMATION = "TOURPILOT_2026_HISTORICAL_EXACT_RECOVERY";
export const EXACT_RECOVERY_FIELD = "pickupTime";
export const EXACT_RECOVERY_WARNING = "missing_pickup_time";
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const PICKUP_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface ExactRecoveryRow {
  id: number;
  sourceKey: string;
  sourceFileId: string;
  worksheetName: string;
  sourceRow: number;
  status: string;
  payload: unknown;
  payloadSha256: string;
  warnings: string[];
}

export interface ExactRecoveryInput {
  sourceKey: string;
  expectedPayloadSha256: string;
  field: typeof EXACT_RECOVERY_FIELD;
  value: string;
  warningToRemove: typeof EXACT_RECOVERY_WARNING;
  operatorProfileId: number;
}

export interface PreparedExactRecovery {
  rowId: number;
  oldPayloadSha256: string;
  newPayloadSha256: string;
  correctedPayload: HistoricalStagingRecord;
  correctedWarnings: string[];
}

function fail(message: string): never {
  throw new Error(`Historical exact recovery reddedildi: ${message}`);
}

export function validateHistoricalExactRecoveryTarget(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "production") fail("production ortaminda calistirilamaz");
  const connectionString = env.HISTORICAL_STAGING_DATABASE_URL;
  const allowedHost = env.HISTORICAL_STAGING_DATABASE_HOST;
  if (!connectionString || !allowedHost) fail("HISTORICAL_STAGING_DATABASE_URL ve HISTORICAL_STAGING_DATABASE_HOST gerekli");
  let url: URL;
  try { url = new URL(connectionString); } catch { fail("staging baglanti URL'i gecersiz"); }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) fail("baglanti PostgreSQL olmali");
  if (url.hostname !== allowedHost || !allowedHost.endsWith(".neon.tech")) fail("host eslesmesi veya Neon kontrolu basarisiz");
  return connectionString;
}

export function prepareHistoricalExactRecovery(row: ExactRecoveryRow, input: ExactRecoveryInput): PreparedExactRecovery {
  if (row.sourceKey !== input.sourceKey) fail("source_key eslesmiyor");
  if (row.status !== "pending") fail("kayit pending degil");
  if (!SHA256_PATTERN.test(input.expectedPayloadSha256)) fail("expected payload SHA256 gecersiz");
  if (row.payloadSha256 !== input.expectedPayloadSha256) fail("expected payload SHA256 CAS eslesmedi");
  if (input.field !== EXACT_RECOVERY_FIELD) fail("desteklenmeyen alan");
  if (input.warningToRemove !== EXACT_RECOVERY_WARNING) fail("desteklenmeyen warning");
  if (!PICKUP_TIME_PATTERN.test(input.value)) fail("pickupTime canonical HH:mm olmali");

  let payload: HistoricalStagingRecord;
  try { payload = parseHistoricalStagingRecord(row.payload); } catch { fail("payload semasi gecersiz"); }
  const expectedSourceKey = `legacy:${row.sourceFileId}:${row.worksheetName}:${row.sourceRow}`;
  if (row.sourceKey !== expectedSourceKey || payload.idempotencyKey !== expectedSourceKey) fail("provenance kimligi eslesmiyor");
  if (sha256OfHistoricalStagingRecord(payload) !== row.payloadSha256) fail("saklanan payload SHA256 dogrulanamadi");
  if (payload.operation.pickupTime !== null) fail("pickupTime zaten dolu");
  if (row.warnings.length !== payload.warnings.length || row.warnings.some((warning, index) => warning !== payload.warnings[index])) {
    fail("payload ve kolon warnings eslesmiyor");
  }
  if (row.warnings.filter(warning => warning === input.warningToRemove).length !== 1) fail("warning tam bir kez bulunmali");

  const correctedWarnings = payload.warnings.filter(warning => warning !== input.warningToRemove);
  const correctedPayload: HistoricalStagingRecord = {
    ...payload,
    operation: { ...payload.operation, pickupTime: input.value },
    warnings: correctedWarnings,
  };
  return {
    rowId: row.id,
    oldPayloadSha256: row.payloadSha256,
    newPayloadSha256: sha256OfHistoricalStagingRecord(correctedPayload),
    correctedPayload,
    correctedWarnings,
  };
}
