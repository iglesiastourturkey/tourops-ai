import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";

export const DEFAULT_PENDING_INSPECT_LIMIT = 20;
export const MAX_PENDING_INSPECT_LIMIT = 100;

export interface PendingInspectArgs {
  limit: number;
}

export interface PendingImportReviewRow {
  id: number;
  sourceKey: string;
  sourceFileId: string;
  sourceKind: string;
  worksheetName: string;
  sourceRow: number;
  operationDate: string;
  customerName: string;
  warnings: string[];
  status: string;
  payload: unknown;
}

function invalidLimit(): never {
  throw new Error(`--limit 1-${MAX_PENDING_INSPECT_LIMIT} arasinda bir tam sayi olmalidir`);
}

/** Pure argument parsing. This CLI deliberately offers no target-selection mode. */
export function parsePendingInspectArgs(args: string[]): PendingInspectArgs {
  if (args.length === 0) return { limit: DEFAULT_PENDING_INSPECT_LIMIT };

  if (args.length !== 2 || args[0] !== "--limit") {
    throw new Error("Yalnizca sinirli --limit bayragi desteklenir");
  }

  const rawLimit = args[1];
  if (!rawLimit) invalidLimit();
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PENDING_INSPECT_LIMIT) invalidLimit();
  return { limit };
}

/**
 * Verifies the dedicated historical staging target before the DB module is
 * imported. Errors intentionally contain no connection-string data.
 */
export function validatePendingInspectTarget(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "production") {
    throw new Error("Production ortaminda historical pending inspection calistirilamaz");
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
    throw new Error("Historical pending inspection baglanti URL'i gecersiz");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("Historical pending inspection baglantisi PostgreSQL olmali");
  }
  if (url.hostname !== allowedHost || !allowedHost.endsWith(".neon.tech")) {
    throw new Error("Historical pending inspection host allowlist veya Neon kontrolu basarisiz");
  }
  return connectionString;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Projects only review fields, never the complete staging payload. */
export function pendingImportReviewDetail(row: PendingImportReviewRow) {
  const payload = objectValue(row.payload);
  const operation = objectValue(payload?.operation);
  const reservationDetails = objectValue(payload?.reservationDetails);

  return {
    sourceKey: row.sourceKey,
    sourceFileId: row.sourceFileId,
    sourceKind: row.sourceKind,
    worksheetName: row.worksheetName,
    sourceRow: row.sourceRow,
    serviceDate: row.operationDate,
    historicalCustomerName: row.customerName,
    reservationType: stringOrNull(reservationDetails?.tourType),
    tourOrService: stringOrNull(reservationDetails?.itineraryRaw),
    agency: stringOrNull(reservationDetails?.externalSource),
    operator: stringOrNull(reservationDetails?.externalOperator),
    adultCount: numberOrNull(reservationDetails?.adultCount),
    childCount: numberOrNull(reservationDetails?.childCount),
    pickupPoint: stringOrNull(reservationDetails?.pickupPoint),
    pickupTime: stringOrNull(operation?.pickupTime),
    passengerLanguage: stringOrNull(reservationDetails?.passengerLanguage),
    collectionStatus: stringOrNull(reservationDetails?.collectionStatusRaw),
    warnings: row.warnings,
    status: row.status,
  };
}

export function buildPendingInspectReport(
  requestedLimit: number,
  pendingTotal: number,
  rows: PendingImportReviewRow[],
) {
  return {
    mode: "historical-pending-inspect",
    databaseWrites: false,
    customerWrites: false,
    operationWrites: false,
    requestedLimit,
    pendingTotal,
    selectedCount: rows.length,
    details: rows.map(pendingImportReviewDetail),
  };
}

async function inspectPendingImports(limit: number) {
  const { db, historicalOperationImportsTable } = await import("@workspace/db");
  const pendingOnly = eq(historicalOperationImportsTable.status, "pending");

  const [pendingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(historicalOperationImportsTable)
    .where(pendingOnly);

  const rows = await db
    .select({
      id: historicalOperationImportsTable.id,
      sourceKey: historicalOperationImportsTable.sourceKey,
      sourceFileId: historicalOperationImportsTable.sourceFileId,
      sourceKind: historicalOperationImportsTable.sourceKind,
      worksheetName: historicalOperationImportsTable.worksheetName,
      sourceRow: historicalOperationImportsTable.sourceRow,
      operationDate: historicalOperationImportsTable.operationDate,
      customerName: historicalOperationImportsTable.customerName,
      warnings: historicalOperationImportsTable.warnings,
      status: historicalOperationImportsTable.status,
      payload: historicalOperationImportsTable.payload,
    })
    .from(historicalOperationImportsTable)
    .where(pendingOnly)
    .orderBy(
      historicalOperationImportsTable.operationDate,
      historicalOperationImportsTable.sourceFileId,
      historicalOperationImportsTable.worksheetName,
      historicalOperationImportsTable.sourceRow,
      historicalOperationImportsTable.id,
    )
    .limit(limit);

  return buildPendingInspectReport(limit, pendingCount?.count ?? 0, rows);
}

async function main() {
  const parsed = parsePendingInspectArgs(process.argv.slice(2));
  process.env.DATABASE_URL = validatePendingInspectTarget();

  const { pool } = await import("@workspace/db");
  try {
    console.log(JSON.stringify(await inspectPendingImports(parsed.limit), null, 2));
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Historical pending inspection basarisiz");
    process.exit(1);
  });
}
