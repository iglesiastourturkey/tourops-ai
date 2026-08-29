import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inArray } from "drizzle-orm";
import {
  classifyHistoricalCustomerResolution,
  normalizeHistoricalCustomerName,
  type CustomerCandidate,
} from "./lib/historical-customer-resolution";

const MAX_PLAN_LIMIT = 100;

function optionAll(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1] as string);
  }
  return values;
}

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

export function parseCustomerResolutionPlanArgs(args: string[]) {
  const sourceKeys = [...new Set(optionAll(args, "--source-key"))];
  const limitRaw = option(args, "--limit");
  const limit = limitRaw === null ? null : Number(limitRaw);
  if (limitRaw !== null && (!Number.isInteger(limit) || (limit as number) <= 0 || (limit as number) > MAX_PLAN_LIMIT)) {
    throw new Error(`--limit 1-${MAX_PLAN_LIMIT} arasinda bir tam sayi olmalidir`);
  }
  if (sourceKeys.length > MAX_PLAN_LIMIT) {
    throw new Error(`Tek PLAN calistirmasinda en fazla ${MAX_PLAN_LIMIT} source key secilebilir`);
  }
  return { sourceKeys, limit };
}

function validateReadOnlyTarget(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production ortaminda historical customer resolution calistirilamaz");
  }
  const connectionString = process.env.HISTORICAL_STAGING_DATABASE_URL;
  const allowedHost = process.env.HISTORICAL_STAGING_DATABASE_HOST;
  if (!connectionString || !allowedHost) {
    throw new Error("HISTORICAL_STAGING_DATABASE_URL ve HISTORICAL_STAGING_DATABASE_HOST gerekli");
  }
  const url = new URL(connectionString);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("Historical customer resolution baglantisi PostgreSQL olmali");
  }
  if (url.hostname !== allowedHost || !url.hostname.endsWith(".neon.tech")) {
    throw new Error("Historical customer resolution host allowlist veya Neon kontrolu basarisiz");
  }
  return connectionString;
}

function historicalNameFromPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return null;
  const customer = (payload as { customer?: unknown }).customer;
  if (!customer || typeof customer !== "object") return null;
  return (customer as { fullName?: unknown }).fullName ?? null;
}

async function buildPlan(sourceKeys: string[], limit: number | null) {
  const { db, historicalOperationImportsTable, operationsTable, customersTable } = await import("@workspace/db");

  let stagingQuery = db
    .select({
      sourceKey: historicalOperationImportsTable.sourceKey,
      payload: historicalOperationImportsTable.payload,
      importedOperationId: historicalOperationImportsTable.importedOperationId,
    })
    .from(historicalOperationImportsTable)
    .where(
      sourceKeys.length > 0
        ? inArray(historicalOperationImportsTable.sourceKey, sourceKeys)
        : inArray(historicalOperationImportsTable.status, ["imported"]),
    )
    .orderBy(historicalOperationImportsTable.id)
    .$dynamic();

  if (limit !== null) stagingQuery = stagingQuery.limit(limit);
  const stagedRows = await stagingQuery;

  const operationIds = stagedRows
    .map(row => row.importedOperationId)
    .filter((id): id is number => id !== null);
  const operationRows = operationIds.length > 0
    ? await db
        .select({ id: operationsTable.id, customerId: operationsTable.customerId })
        .from(operationsTable)
        .where(inArray(operationsTable.id, operationIds))
    : [];
  const operationById = new Map(operationRows.map(row => [row.id, row]));

  const customerRows = await db
    .select({ id: customersTable.id, name: customersTable.name })
    .from(customersTable)
    .where(inArray(customersTable.archivedAt, [null]));

  const candidatesByNormalizedName = new Map<string, CustomerCandidate[]>();
  for (const customer of customerRows) {
    const normalized = normalizeHistoricalCustomerName(customer.name);
    if (normalized === null) continue;
    const bucket = candidatesByNormalizedName.get(normalized) ?? [];
    bucket.push({ id: customer.id, name: customer.name });
    candidatesByNormalizedName.set(normalized, bucket);
  }

  const summary = {
    mode: "historical-customer-resolution-plan",
    databaseWrites: false,
    customerWrites: false,
    operationWrites: false,
    scanned: 0,
    alreadyLinked: 0,
    exactUniqueCandidates: 0,
    ambiguousExactNames: 0,
    noExactCandidate: 0,
    invalidOrBlankName: 0,
    selectedSourceKeys: [] as string[],
    details: [] as Array<Record<string, unknown>>,
  };

  for (const row of stagedRows) {
    const operation = row.importedOperationId === null ? undefined : operationById.get(row.importedOperationId);
    const resolution = classifyHistoricalCustomerResolution({
      historicalName: historicalNameFromPayload(row.payload),
      operationCustomerId: operation?.customerId ?? null,
      candidatesByNormalizedName,
    });
    summary.scanned += 1;
    summary.selectedSourceKeys.push(row.sourceKey);
    if (resolution.kind === "already_linked") summary.alreadyLinked += 1;
    else if (resolution.kind === "exact_unique_name_candidate") summary.exactUniqueCandidates += 1;
    else if (resolution.kind === "ambiguous_exact_name") summary.ambiguousExactNames += 1;
    else if (resolution.kind === "no_exact_name_candidate") summary.noExactCandidate += 1;
    else summary.invalidOrBlankName += 1;

    summary.details.push({
      sourceKey: row.sourceKey,
      historicalName: historicalNameFromPayload(row.payload),
      normalizedHistoricalName: resolution.normalizedHistoricalName,
      classification: resolution.kind,
      candidates: resolution.candidates,
    });
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--apply") || args.some(arg => arg.startsWith("--confirm")) || args.includes("--operator-profile-id")) {
    throw new Error("Faz 3D-B.1 yalnizca PLAN/read-only modudur; write/actor bayraklari desteklenmez");
  }
  const { sourceKeys, limit } = parseCustomerResolutionPlanArgs(args);
  process.env.DATABASE_URL = validateReadOnlyTarget();
  const { pool } = await import("@workspace/db");
  try {
    const plan = await buildPlan(sourceKeys, limit);
    console.log(JSON.stringify(plan, null, 2));
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Historical customer resolution PLAN basarisiz");
    process.exit(1);
  });
}
