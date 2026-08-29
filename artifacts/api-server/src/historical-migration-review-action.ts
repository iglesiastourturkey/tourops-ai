import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Faz 3D-A: the only entrypoint that can move a historical_operation_imports
 * row out of "pending". One source key, one action, no bulk path - approving
 * or rejecting 3519 rows in a loop from outside this file is not something
 * this CLI enables. The actual state change + audit is
 * approveHistoricalImport()/rejectHistoricalImport()
 * (lib/historical-migration-approval.ts), which independently re-verifies
 * the operator's permission before touching anything - this file does not
 * duplicate that policy, only the argument/env gating around it.
 */

const CONFIRMATION = "TOURPILOT_2026_HISTORICAL_REVIEW";

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

function usage(): never {
  console.error(
    "Kullanim: pnpm --filter @workspace/api-server historical:review -- "
    + "--source-key <key> (--approve | --reject --reason \"<gerekce>\") "
    + "--operator-profile-id <id> --confirm-review TOURPILOT_2026_HISTORICAL_REVIEW",
  );
  process.exit(2);
}

export interface ReviewArgs {
  sourceKey: string;
  action: "approve" | "reject";
  reason: string | null;
  operatorProfileId: number;
  confirmed: boolean;
}

/** Pure argument parsing/validation - no DB access, no env reads. */
export function parseReviewArgs(args: string[]): ReviewArgs {
  const sourceKeys = optionAll(args, "--source-key");
  if (sourceKeys.length !== 1) {
    throw new Error("Tam olarak bir --source-key gereklidir (toplu onay/red desteklenmez)");
  }

  const approve = args.includes("--approve");
  const reject = args.includes("--reject");
  if (approve === reject) {
    throw new Error("Tam olarak biri gerekli: --approve veya --reject");
  }

  const reason = option(args, "--reason");
  if (reject && !reason?.trim()) {
    throw new Error("Red icin bos olmayan --reason zorunludur");
  }

  const operatorRaw = option(args, "--operator-profile-id");
  if (!operatorRaw) {
    throw new Error("--operator-profile-id zorunludur");
  }
  const operatorProfileId = Number(operatorRaw);
  if (!Number.isInteger(operatorProfileId) || operatorProfileId <= 0) {
    throw new Error("--operator-profile-id pozitif bir tam sayi olmalidir");
  }

  const confirmed = option(args, "--confirm-review") === CONFIRMATION;

  return {
    sourceKey: sourceKeys[0] as string,
    action: approve ? "approve" : "reject",
    reason: reason?.trim() || null,
    operatorProfileId,
    confirmed,
  };
}

function validateReviewTarget(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production ortaminda historical review calistirilamaz");
  }
  const connectionString = process.env.HISTORICAL_STAGING_DATABASE_URL;
  const allowedHost = process.env.HISTORICAL_STAGING_DATABASE_HOST;
  if (!connectionString || !allowedHost) {
    throw new Error("HISTORICAL_STAGING_DATABASE_URL ve HISTORICAL_STAGING_DATABASE_HOST gerekli");
  }
  const url = new URL(connectionString);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("Historical review baglantisi PostgreSQL olmali");
  }
  if (url.hostname !== allowedHost || !url.hostname.endsWith(".neon.tech")) {
    throw new Error("Historical review host allowlist veya Neon kontrolu basarisiz");
  }
  return connectionString;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) usage();

  // Argument-shape errors (missing operator id, missing/empty reason, not
  // exactly one source key, ambiguous approve/reject) are pure and must
  // surface before anything touches the environment or a connection.
  const parsed = parseReviewArgs(args);

  if (!parsed.confirmed) {
    throw new Error("Review icin tam onay ifadesi gerekli (--confirm-review TOURPILOT_2026_HISTORICAL_REVIEW)");
  }

  // NODE_ENV/host/allowlist validation happens before any DB connection.
  const connectionString = validateReviewTarget();
  process.env.DATABASE_URL = connectionString;

  const { pool } = await import("@workspace/db");
  try {
    const { approveHistoricalImport, rejectHistoricalImport } = await import("./lib/historical-migration-approval");

    const result = parsed.action === "approve"
      ? await approveHistoricalImport({ sourceKey: parsed.sourceKey, actorProfileId: parsed.operatorProfileId })
      : await rejectHistoricalImport({
          sourceKey: parsed.sourceKey,
          actorProfileId: parsed.operatorProfileId,
          rejectionReason: parsed.reason as string,
        });

    console.log(JSON.stringify({
      mode: `historical-review-${parsed.action}`,
      databaseWrites: result.ok,
      sourceKey: parsed.sourceKey,
      ...result,
    }, null, 2));

    if (!result.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Historical review basarisiz");
    process.exit(1);
  });
}
