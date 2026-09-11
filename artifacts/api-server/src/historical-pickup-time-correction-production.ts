import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyHistoricalPickupTimeCorrection,
  pickupTimeCorrectionWriteFlags,
  planHistoricalPickupTimeCorrection,
  selectedCandidates,
  type HistoricalPickupTimeCorrectionArgs,
} from "./historical-pickup-time-correction";
import {
  parseHistoricalPickupTimeCorrectionPackage,
  validateProductionPickupTimeCorrectionTarget,
} from "./lib/historical-pickup-time-correction";

// Phase 3H.3B3 — production-only wrapper over the shared pickup-time
// correction core (historical-pickup-time-correction.ts). This file contains
// NO correction logic of its own: assessment, CAS, hashing, transactions,
// and audit behavior all come from the shared core and its lib helpers.
//
// Production-only and fail closed:
//   - REQUIRES NODE_ENV=production (refuses anything else).
//   - Uses ONLY PRODUCTION_DATABASE_URL/HOST; the staging variables are
//     never consulted and the connection string is never logged.
//   - PLAN is read-only; APPLY needs explicit targeting (<=25), the exact
//   - production confirmation phrase, and an operator holding
//     historical_migration.pickup_time_correct.

const CONFIRMATION = "TOURPILOT_2026_PRODUCTION_PICKUP_CORRECTION";
export const MAX_APPLY_LIMIT = 25;

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} pozitif bir tam sayi olmalidir`);
  }
  return parsed;
}

/** Strict parser mirroring the staging parser shape with production confirmation. */
export function parseProductionPickupTimeCorrectionArgs(args: string[]): HistoricalPickupTimeCorrectionArgs {
  let inputPath: string | null = null;
  const sourceKeys: string[] = [];
  let limit: number | null = null;
  let apply = false;
  let confirmation: string | null = null;
  let operatorProfileId: number | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") {
      if (inputPath !== null) throw new Error("Tam olarak bir --input gereklidir");
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--input bos olamaz");
      inputPath = value;
      continue;
    }
    if (arg === "--source-key") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--source-key bos olamaz");
      if (!/^legacy:[^:]+:[^:]+:[1-9]\d*$/.test(value)) throw new Error("--source-key canonical legacy kimligi olmalidir");
      if (sourceKeys.includes(value)) throw new Error("Tekrar eden --source-key kabul edilmez");
      sourceKeys.push(value);
      continue;
    }
    if (arg === "--limit") {
      if (limit !== null) throw new Error("--limit bir kez kullanilabilir");
      limit = positiveInteger(args[++index], "--limit");
      continue;
    }
    if (arg === "--apply") {
      if (apply) throw new Error("--apply bir kez kullanilabilir");
      apply = true;
      continue;
    }
    if (arg === "--confirm-production-pickup-correction") {
      if (confirmation !== null) throw new Error("--confirm-production-pickup-correction bir kez kullanilabilir");
      confirmation = args[++index] ?? null;
      continue;
    }
    if (arg === "--operator-profile-id") {
      if (operatorProfileId !== null) throw new Error("--operator-profile-id bir kez kullanilabilir");
      operatorProfileId = positiveInteger(args[++index], "--operator-profile-id");
      continue;
    }
    throw new Error(`Desteklenmeyen veya sinirsiz bayrak: ${arg}`);
  }

  if (inputPath === null) throw new Error("Tam olarak bir --input gereklidir");
  if (!apply && (sourceKeys.length > 0 || limit !== null || confirmation !== null || operatorProfileId !== null)) {
    throw new Error("--source-key, --limit, confirmation ve operator yalnizca --apply ile kullanilabilir");
  }
  if (apply) {
    if ((sourceKeys.length === 0) === (limit === null)) {
      throw new Error("Apply modu icin tam olarak --source-key veya --limit zorunludur");
    }
    if (sourceKeys.length > MAX_APPLY_LIMIT || (limit !== null && limit > MAX_APPLY_LIMIT)) {
      throw new Error(`Tek calistirmada en fazla ${MAX_APPLY_LIMIT} kayit hedeflenebilir`);
    }
    if (confirmation !== CONFIRMATION) throw new Error("Production pickup-time correction APPLY icin tam onay ifadesi gerekli");
    if (operatorProfileId === null) throw new Error("Apply modu icin --operator-profile-id zorunludur");
  }
  return { inputPath, sourceKeys, limit, apply, operatorProfileId };
}

async function main() {
  const args = parseProductionPickupTimeCorrectionArgs(process.argv.slice(2));
  const connectionString = validateProductionPickupTimeCorrectionTarget();
  const correctionPackage = parseHistoricalPickupTimeCorrectionPackage(JSON.parse(await readFile(resolve(args.inputPath), "utf8")));
  const candidates = selectedCandidates(correctionPackage, args);
  process.env.DATABASE_URL = connectionString;
  const { pool } = await import("@workspace/db");
  try {
    if (!args.apply) {
      const plan = await planHistoricalPickupTimeCorrection(candidates);
      console.log(JSON.stringify({
        mode: "historical-pickup-time-correction-production-plan",
        databaseWrites: false,
        operationWrites: false,
        customerWrites: false,
        recordsInPackage: correctionPackage.records.length,
        inspected: candidates.length,
        ...plan,
        requiresApplyConfirmation: true,
      }, null, 2));
      return;
    }
    // APPLY uses the same dedicated pickup_time_correct action as staging;
    // never the broader historical_migration.promote permission.
    const { verifyOperatorPermission } = await import("./lib/historical-migration-operator");
    const verification = await verifyOperatorPermission(
      args.operatorProfileId as number,
      "historical_migration",
      "pickup_time_correct",
    );
    if (!verification.ok) throw new Error(verification.message);
    const summary = await applyHistoricalPickupTimeCorrection(candidates, args.operatorProfileId as number);
    console.log(JSON.stringify({
      mode: "historical-pickup-time-correction-production-apply",
      ...pickupTimeCorrectionWriteFlags(summary),
      operatorProfileId: args.operatorProfileId,
      ...summary,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Production pickup-time correction basarisiz");
    process.exit(1);
  });
}
