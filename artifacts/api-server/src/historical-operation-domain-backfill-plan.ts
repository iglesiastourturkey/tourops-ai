import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { operationTypeFromHistoricalSourceKind, type OperationType } from "./lib/operation-domain";

/**
 * Phase 3H.2 — historical operation domain backfill REHEARSAL (read-only).
 *
 * Migration 0027 added `operations.operation_type` and left every existing row
 * NULL on purpose. This CLI projects — without writing anything — how a one-time
 * backfill would classify the already-promoted historical operations, so the
 * owner can confirm the expected split (2938 GEMI / CRUISE, 581 SEJOUR, 0
 * unclassified) before authorizing the production correction separately.
 *
 * It only ever runs against the dedicated historical staging Neon target and
 * refuses every write/apply flag. The exact UPDATE statement it would recommend
 * is emitted as text for owner review; this file never executes it.
 */

export const BACKFILL_UPDATE_SQL = `UPDATE operations o
SET operation_type = CASE h.source_kind
      WHEN 'gemi'   THEN 'CRUISE'
      WHEN 'sejour' THEN 'SEJOUR'
    END,
    version = o.version + 1,
    updated_at = now()
FROM historical_operation_imports h
WHERE h.imported_operation_id = o.id
  AND h.status = 'imported'
  AND h.source_kind IN ('gemi', 'sejour')
  AND o.operation_type IS NULL;`;

export interface BackfillPlanRow {
  operationId: number;
  sourceKind: string;
  currentOperationType: OperationType | null;
}

export interface BackfillPlanSummary {
  mode: "historical-operation-domain-backfill-plan";
  databaseWrites: false;
  promotedHistoricalOperations: number;
  projected: { CRUISE: number; SEJOUR: number };
  alreadyClassifiedMatching: number;
  wouldUpdate: number;
  conflicts: Array<{ operationId: number; sourceKind: string; currentOperationType: OperationType; projected: OperationType }>;
  unclassifiableSourceKinds: Array<{ operationId: number; sourceKind: string }>;
  orphanHistoricalOperations: number;
  recommendedSql: string;
}

/**
 * Pure projection over the promoted-history → operations join. Deterministic and
 * DB-free so it can be unit-tested. `conflicts` and `unclassifiableSourceKinds`
 * are both expected to be empty; a non-empty list blocks the backfill.
 */
export function classifyBackfillRows(
  rows: BackfillPlanRow[],
  orphanHistoricalOperations = 0,
): BackfillPlanSummary {
  const summary: BackfillPlanSummary = {
    mode: "historical-operation-domain-backfill-plan",
    databaseWrites: false,
    promotedHistoricalOperations: rows.length,
    projected: { CRUISE: 0, SEJOUR: 0 },
    alreadyClassifiedMatching: 0,
    wouldUpdate: 0,
    conflicts: [],
    unclassifiableSourceKinds: [],
    orphanHistoricalOperations,
    recommendedSql: BACKFILL_UPDATE_SQL,
  };

  for (const row of rows) {
    const projected = operationTypeFromHistoricalSourceKind(row.sourceKind);
    if (projected === null) {
      summary.unclassifiableSourceKinds.push({ operationId: row.operationId, sourceKind: row.sourceKind });
      continue;
    }
    summary.projected[projected] += 1;
    if (row.currentOperationType === null) {
      summary.wouldUpdate += 1;
    } else if (row.currentOperationType === projected) {
      summary.alreadyClassifiedMatching += 1;
    } else {
      summary.conflicts.push({
        operationId: row.operationId,
        sourceKind: row.sourceKind,
        currentOperationType: row.currentOperationType,
        projected,
      });
    }
  }

  return summary;
}

/**
 * Verifies the dedicated historical staging target before the DB module is
 * imported. Errors intentionally contain no connection-string data.
 */
export function validateBackfillPlanTarget(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "production") {
    throw new Error("Production ortaminda operation domain backfill rehearsal calistirilamaz");
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
    throw new Error("Operation domain backfill rehearsal baglanti URL'i gecersiz");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("Operation domain backfill rehearsal baglantisi PostgreSQL olmali");
  }
  if (url.hostname !== allowedHost || !allowedHost.endsWith(".neon.tech")) {
    throw new Error("Operation domain backfill rehearsal host allowlist veya Neon kontrolu basarisiz");
  }
  return connectionString;
}

export async function buildBackfillPlan(): Promise<BackfillPlanSummary> {
  const { db } = await import("@workspace/db");
  const { operationsTable } = await import("@workspace/db/schema");
  const { historicalOperationImportsTable } = await import("@workspace/db/schema");

  const rows = await db
    .select({
      operationId: operationsTable.id,
      sourceKind: historicalOperationImportsTable.sourceKind,
      currentOperationType: operationsTable.operationType,
    })
    .from(historicalOperationImportsTable)
    .innerJoin(operationsTable, eq(historicalOperationImportsTable.importedOperationId, operationsTable.id))
    .where(eq(historicalOperationImportsTable.status, "imported"));

  const [{ count: orphanHistoricalOperations }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(operationsTable)
    .where(
      and(
        isNotNull(operationsTable.sourceHistoricalKey),
        isNotNull(operationsTable.id),
        sql`NOT EXISTS (
          SELECT 1 FROM historical_operation_imports h
          WHERE h.imported_operation_id = ${operationsTable.id}
            AND h.status = 'imported'
        )`,
      ),
    );

  return classifyBackfillRows(
    rows.map(row => ({
      operationId: row.operationId,
      sourceKind: row.sourceKind,
      currentOperationType: row.currentOperationType,
    })),
    orphanHistoricalOperations ?? 0,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => /^--(apply|execute|confirm|write|run)/.test(arg))) {
    throw new Error("Faz 3H.2 yalnizca REHEARSAL/read-only modudur; write/apply bayraklari desteklenmez");
  }
  process.env.DATABASE_URL = validateBackfillPlanTarget();
  const { pool } = await import("@workspace/db");
  try {
    console.log(JSON.stringify(await buildBackfillPlan(), null, 2));
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Operation domain backfill rehearsal basarisiz");
    process.exit(1);
  });
}
