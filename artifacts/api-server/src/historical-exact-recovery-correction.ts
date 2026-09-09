import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  EXACT_RECOVERY_CONFIRMATION,
  EXACT_RECOVERY_FIELD,
  EXACT_RECOVERY_WARNING,
  prepareHistoricalExactRecovery,
  validateHistoricalExactRecoveryTarget,
  type ExactRecoveryInput,
  type ExactRecoveryRow,
} from "./lib/historical-exact-recovery-correction";

export interface HistoricalExactRecoveryArgs extends ExactRecoveryInput { apply: boolean; }

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} degeri zorunludur`);
  return value;
}

export function parseHistoricalExactRecoveryArgs(args: string[]): HistoricalExactRecoveryArgs {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--apply") {
      if (apply) throw new Error("--apply bir kez kullanilabilir");
      apply = true;
      continue;
    }
    if (!["--source-key", "--expected-payload-sha256", "--field", "--value", "--remove-warning", "--operator-profile-id", "--confirm"].includes(flag)) {
      throw new Error(`Desteklenmeyen bayrak: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`${flag} bir kez kullanilabilir`);
    values.set(flag, requiredValue(args, ++index, flag));
  }
  const sourceKey = values.get("--source-key");
  const expectedPayloadSha256 = values.get("--expected-payload-sha256");
  const field = values.get("--field");
  const value = values.get("--value");
  const warningToRemove = values.get("--remove-warning");
  const operatorProfileId = Number(values.get("--operator-profile-id"));
  if (!sourceKey || !/^legacy:[^:]+:[^:]+:[1-9]\d*$/.test(sourceKey)) throw new Error("Tam bir canonical --source-key zorunludur");
  if (!expectedPayloadSha256) throw new Error("--expected-payload-sha256 zorunludur");
  if (field !== EXACT_RECOVERY_FIELD) throw new Error("Yalnizca --field pickupTime desteklenir");
  if (!value) throw new Error("--value zorunludur");
  if (warningToRemove !== EXACT_RECOVERY_WARNING) throw new Error("Yalnizca missing_pickup_time kaldirilabilir");
  if (!Number.isInteger(operatorProfileId) || operatorProfileId <= 0) throw new Error("--operator-profile-id pozitif tam sayi olmalidir");
  const confirmation = values.get("--confirm");
  if (apply && confirmation !== EXACT_RECOVERY_CONFIRMATION) throw new Error("APPLY icin exact recovery confirmation token gerekli");
  if (!apply && confirmation !== undefined) throw new Error("--confirm yalnizca --apply ile kullanilabilir");
  return { sourceKey, expectedPayloadSha256, field, value, warningToRemove, operatorProfileId, apply };
}

type HistoricalSelectExecutor = Pick<(typeof import("@workspace/db"))["db"], "select">;

async function selectExactRow(executor: HistoricalSelectExecutor, sourceKey: string, lock: boolean): Promise<ExactRecoveryRow | null> {
  const { historicalOperationImportsTable } = await import("@workspace/db");
  const query = executor.select({
    id: historicalOperationImportsTable.id, sourceKey: historicalOperationImportsTable.sourceKey,
    sourceFileId: historicalOperationImportsTable.sourceFileId, worksheetName: historicalOperationImportsTable.worksheetName,
    sourceRow: historicalOperationImportsTable.sourceRow, status: historicalOperationImportsTable.status,
    payload: historicalOperationImportsTable.payload, payloadSha256: historicalOperationImportsTable.payloadSha256,
    warnings: historicalOperationImportsTable.warnings,
  }).from(historicalOperationImportsTable).where(eq(historicalOperationImportsTable.sourceKey, sourceKey));
  const rows = lock ? await query.for("update") : await query;
  return rows[0] ?? null;
}

export async function planHistoricalExactRecovery(input: ExactRecoveryInput) {
  const { db } = await import("@workspace/db");
  const row = await selectExactRow(db, input.sourceKey, false);
  if (!row) throw new Error("Historical staging kaydi bulunamadi");
  const prepared = prepareHistoricalExactRecovery(row, input);
  return { mode: "historical-exact-recovery-plan", databaseWrites: false, sourceKey: input.sourceKey,
    field: input.field, oldValue: null, newValue: input.value, warningToRemove: input.warningToRemove,
    oldPayloadSha256: prepared.oldPayloadSha256, newPayloadSha256: prepared.newPayloadSha256 };
}

export async function applyHistoricalExactRecovery(input: ExactRecoveryInput) {
  const { db, historicalOperationImportsTable } = await import("@workspace/db");
  const { createAuditLog } = await import("./lib/audit");
  return db.transaction(async tx => {
    const row = await selectExactRow(tx, input.sourceKey, true);
    if (!row) throw new Error("Historical staging kaydi bulunamadi");
    const prepared = prepareHistoricalExactRecovery(row, input);
    const changed = await tx.update(historicalOperationImportsTable).set({
      payload: prepared.correctedPayload, warnings: prepared.correctedWarnings,
      payloadSha256: prepared.newPayloadSha256, updatedAt: new Date(),
    }).where(and(eq(historicalOperationImportsTable.id, prepared.rowId),
      eq(historicalOperationImportsTable.sourceKey, input.sourceKey),
      eq(historicalOperationImportsTable.status, "pending"),
      eq(historicalOperationImportsTable.payloadSha256, input.expectedPayloadSha256))).returning({ id: historicalOperationImportsTable.id });
    if (changed.length !== 1) throw new Error("Historical exact recovery CAS basarisiz");
    await createAuditLog({ eventType: "historical_migration_exact_recovery_corrected", actorProfileId: input.operatorProfileId,
      module: "historical_migration", entityType: "historical_operation_import", entityId: prepared.rowId,
      oldValue: { pickupTime: null }, newValue: { pickupTime: input.value },
      metadata: { sourceKey: input.sourceKey, field: input.field, oldPayloadSha256: prepared.oldPayloadSha256,
        newPayloadSha256: prepared.newPayloadSha256, warningRemoved: input.warningToRemove, operatorProfileId: input.operatorProfileId },
      description: "Historical staging exact recovery correction uygulandi" }, tx);
    return { mode: "historical-exact-recovery-apply", databaseWrites: true, operationWrites: false,
      reservationWrites: false, bookingPartyWrites: false, customerWrites: false, guestWrites: false,
      sourceKey: input.sourceKey, oldPayloadSha256: prepared.oldPayloadSha256, newPayloadSha256: prepared.newPayloadSha256 };
  });
}

async function main() {
  const args = parseHistoricalExactRecoveryArgs(process.argv.slice(2));
  process.env.DATABASE_URL = validateHistoricalExactRecoveryTarget();
  const { pool } = await import("@workspace/db");
  try {
    if (!args.apply) console.log(JSON.stringify(await planHistoricalExactRecovery(args), null, 2));
    else {
      const { verifyOperatorPermission } = await import("./lib/historical-migration-operator");
      const verification = await verifyOperatorPermission(args.operatorProfileId, "historical_migration", "approve");
      if (!verification.ok) throw new Error(verification.message);
      console.log(JSON.stringify(await applyHistoricalExactRecovery(args), null, 2));
    }
  } finally { await pool.end(); }
}

const isEntrypoint = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isEntrypoint) main().catch(error => { console.error(error instanceof Error ? error.message : "Historical exact recovery basarisiz"); process.exit(1); });
