import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inArray, sql } from "drizzle-orm";
import {
  buildHistoricalStageRows,
  parseHistoricalStagingPackage,
  type HistoricalStageRow,
} from "./lib/historical-migration-stage-validation";

const CONFIRMATION = "TOURPILOT_2026_HISTORICAL_STAGE";
const CHUNK_SIZE = 200;

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function usage(): never {
  console.error("Kullanim: pnpm --filter @workspace/api-server historical:stage -- --input <staging.json> [--apply --confirm-staging TOURPILOT_2026_HISTORICAL_STAGE]");
  process.exit(2);
}

function validateStagingTarget(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production ortaminda historical staging importu calistirilamaz");
  }
  const connectionString = process.env.HISTORICAL_STAGING_DATABASE_URL;
  const allowedHost = process.env.HISTORICAL_STAGING_DATABASE_HOST;
  if (!connectionString || !allowedHost) {
    throw new Error("HISTORICAL_STAGING_DATABASE_URL ve HISTORICAL_STAGING_DATABASE_HOST gerekli");
  }
  const url = new URL(connectionString);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("Historical staging baglantisi PostgreSQL olmali");
  }
  if (url.hostname !== allowedHost || !url.hostname.endsWith(".neon.tech")) {
    throw new Error("Historical staging host allowlist veya Neon kontrolu basarisiz");
  }
  return connectionString;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function applyToStaging(rows: HistoricalStageRow[], connectionString: string) {
  // @workspace/db deliberately reads DATABASE_URL at import time. The CLI is a
  // separate process and only assigns the already-validated dedicated staging
  // URL immediately before the dynamic import; the secret is never logged.
  process.env.DATABASE_URL = connectionString;
  const { db, pool, historicalOperationImportsTable } = await import("@workspace/db");

  try {
    const readiness = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.historical_operation_imports') AS table_name",
    );
    if (!readiness.rows[0]?.table_name) {
      throw new Error("Migration 0019 Neon staging uzerinde uygulanmamis");
    }

    return await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(2026, 3)`);
      let existing = 0;
      let inserted = 0;

      for (const batch of chunks(rows, CHUNK_SIZE)) {
        const stored = await tx
          .select({
            sourceKey: historicalOperationImportsTable.sourceKey,
            payloadSha256: historicalOperationImportsTable.payloadSha256,
          })
          .from(historicalOperationImportsTable)
          .where(inArray(historicalOperationImportsTable.sourceKey, batch.map(row => row.sourceKey)));
        const storedByKey = new Map(stored.map(row => [row.sourceKey, row.payloadSha256]));
        const conflicts = batch.filter(row => {
          const storedHash = storedByKey.get(row.sourceKey);
          return storedHash !== undefined && storedHash !== row.payloadSha256;
        });
        if (conflicts.length > 0) {
          throw new Error(`${conflicts.length} sourceKey farkli icerikle daha once staging'e alinmis`);
        }
        existing += stored.length;

        const insertedRows = await tx
          .insert(historicalOperationImportsTable)
          .values(batch)
          .onConflictDoNothing({ target: historicalOperationImportsTable.sourceKey })
          .returning({ id: historicalOperationImportsTable.id });
        inserted += insertedRows.length;
      }

      return { inserted, existing, total: rows.length };
    });
  } finally {
    await pool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const inputArg = option(args, "--input");
  if (!inputArg) usage();

  const parsed = parseHistoricalStagingPackage(JSON.parse(await readFile(resolve(inputArg), "utf8")));
  const rows = buildHistoricalStageRows(parsed);
  const apply = args.includes("--apply");

  if (!apply) {
    console.log(JSON.stringify({
      mode: "historical-staging-plan",
      databaseWrites: false,
      records: rows.length,
      uniqueSourceKeys: new Set(rows.map(row => row.sourceKey)).size,
      requiresApplyConfirmation: true,
    }, null, 2));
    return;
  }

  if (option(args, "--confirm-staging") !== CONFIRMATION) {
    throw new Error("Staging importu icin tam onay ifadesi gerekli");
  }
  const connectionString = validateStagingTarget();
  const result = await applyToStaging(rows, connectionString);
  console.log(JSON.stringify({
    mode: "historical-staging-apply",
    databaseWrites: true,
    operationsWrites: false,
    customersWrites: false,
    ...result,
  }, null, 2));
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Historical staging importu basarisiz");
    process.exit(1);
  });
}
