import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, sql } from "drizzle-orm";

const MAX_BATCH = 25;
const CONFIRMATION = "TOURPILOT_2026_HISTORICAL_LOW_RISK_APPROVAL";
export const LOW_RISK_WARNINGS = ["missing_agency", "missing_child_count"] as const;

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function validateTarget(): string {
  if (process.env.NODE_ENV === "production") throw new Error("Production ortaminda low-risk batch review calistirilamaz");
  const connectionString = process.env.HISTORICAL_STAGING_DATABASE_URL;
  const allowedHost = process.env.HISTORICAL_STAGING_DATABASE_HOST;
  if (!connectionString || !allowedHost) throw new Error("HISTORICAL_STAGING_DATABASE_URL ve HISTORICAL_STAGING_DATABASE_HOST gerekli");
  const url = new URL(connectionString);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) throw new Error("Historical batch baglantisi PostgreSQL olmali");
  if (url.hostname !== allowedHost || !url.hostname.endsWith(".neon.tech")) throw new Error("Historical batch host allowlist veya Neon kontrolu basarisiz");
  return connectionString;
}

function parseLimit(args: string[]): number {
  const raw = option(args, "--limit");
  if (!raw) throw new Error("--limit zorunludur");
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_BATCH) throw new Error(`--limit 1-${MAX_BATCH} arasinda tam sayi olmalidir`);
  return limit;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--approve-batch");
  const limit = parseLimit(args);
  const operatorRaw = option(args, "--operator-profile-id");
  const operatorProfileId = operatorRaw ? Number(operatorRaw) : null;
  const confirmed = option(args, "--confirm-batch") === CONFIRMATION;

  if (apply) {
    if (!Number.isInteger(operatorProfileId) || (operatorProfileId as number) <= 0) throw new Error("--approve-batch icin --operator-profile-id zorunludur");
    if (!confirmed) throw new Error(`--approve-batch icin --confirm-batch ${CONFIRMATION} zorunludur`);
  }

  // Validate the dedicated staging target before importing any module that
  // initializes @workspace/db. Never fall back to a generic DATABASE_URL.
  const connectionString = validateTarget();
  process.env.DATABASE_URL = connectionString;

  const [{ db, pool }, { historicalOperationImportsTable }] = await Promise.all([
    import("@workspace/db"),
    import("@workspace/db/schema"),
  ]);

  try {
    const allowedJson = JSON.stringify(LOW_RISK_WARNINGS);
    const candidates = await db
      .select({
        id: historicalOperationImportsTable.id,
        sourceKey: historicalOperationImportsTable.sourceKey,
        operationDate: historicalOperationImportsTable.operationDate,
        customerName: historicalOperationImportsTable.customerName,
        warnings: historicalOperationImportsTable.warnings,
        approvalVersion: historicalOperationImportsTable.approvalVersion,
      })
      .from(historicalOperationImportsTable)
      .where(and(
        eq(historicalOperationImportsTable.status, "pending"),
        sql`${historicalOperationImportsTable.warnings} <@ ${allowedJson}::jsonb`,
      ))
      .orderBy(asc(historicalOperationImportsTable.id))
      .limit(limit);

    const invalid = candidates.filter(row =>
      !row.customerName.trim()
      || !Array.isArray(row.warnings)
      || row.warnings.some(warning => !LOW_RISK_WARNINGS.includes(warning as typeof LOW_RISK_WARNINGS[number]))
    );
    if (invalid.length > 0) throw new Error(`Low-risk preflight basarisiz; ${invalid.length} aday allowlist/integrity disinda`);

    if (!apply) {
      console.log(JSON.stringify({
        mode: "historical-low-risk-batch-plan",
        databaseWrites: false,
        requestedLimit: limit,
        selected: candidates.length,
        allowedWarnings: LOW_RISK_WARNINGS,
        selectedSourceKeys: candidates.map(row => row.sourceKey),
        requiresApplyConfirmation: true,
      }, null, 2));
      return;
    }

    const [{ approveHistoricalImport }, { verifyOperatorPermission }] = await Promise.all([
      import("./lib/historical-migration-approval"),
      import("./lib/historical-migration-operator"),
    ]);

    const verification = await verifyOperatorPermission(operatorProfileId as number, "historical_migration", "approve");
    if (!verification.ok) throw new Error(verification.message);

    let approved = 0;
    const failed: Array<{ sourceKey: string; code: string; message: string }> = [];
    for (const candidate of candidates) {
      const result = await approveHistoricalImport({
        sourceKey: candidate.sourceKey,
        actorProfileId: operatorProfileId as number,
        allowedWarnings: LOW_RISK_WARNINGS,
        reviewNotes: "controlled_low_risk_batch",
      });
      if (!result.ok) {
        failed.push({ sourceKey: candidate.sourceKey, code: result.code, message: result.message });
        break;
      }
      approved += 1;
    }

    console.log(JSON.stringify({
      mode: "historical-low-risk-batch-approve",
      databaseWrites: approved > 0,
      requestedLimit: limit,
      selected: candidates.length,
      approved,
      failed,
    }, null, 2));

    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Historical low-risk batch basarisiz");
    process.exit(1);
  });
}
