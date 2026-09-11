import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  assessHistoricalPickupTimeCorrection,
  correctionPackageBySourceKey,
  parseHistoricalPickupTimeCorrectionPackage,
  validateHistoricalPickupTimeCorrectionTarget,
  type HistoricalImportCorrectionState,
  type HistoricalPickupTimeCorrectionCandidate,
  type HistoricalPickupTimeCorrectionPackage,
  type ImportedOperationCorrectionState,
} from "./lib/historical-pickup-time-correction";

const CONFIRMATION = "TOURPILOT_2026_HISTORICAL_PICKUP_CORRECTION";
export const MAX_APPLY_LIMIT = 25;

export interface HistoricalPickupTimeCorrectionArgs {
  inputPath: string;
  sourceKeys: string[];
  limit: number | null;
  apply: boolean;
  operatorProfileId: number | null;
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} pozitif bir tam sayi olmalidir`);
  }
  return parsed;
}

/** Strict parser: unknown/repeated flags and ambiguous targeting fail closed. */
export function parseHistoricalPickupTimeCorrectionArgs(args: string[]): HistoricalPickupTimeCorrectionArgs {
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
    if (arg === "--confirm-pickup-correction") {
      if (confirmation !== null) throw new Error("--confirm-pickup-correction bir kez kullanilabilir");
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
    if (confirmation !== CONFIRMATION) throw new Error("Pickup-time correction APPLY icin tam onay ifadesi gerekli");
    if (operatorProfileId === null) throw new Error("Apply modu icin --operator-profile-id zorunludur");
  }
  return { inputPath, sourceKeys, limit, apply, operatorProfileId };
}

export function selectedCandidates(
  correctionPackage: HistoricalPickupTimeCorrectionPackage,
  args: HistoricalPickupTimeCorrectionArgs,
): HistoricalPickupTimeCorrectionCandidate[] {
  if (!args.apply) return correctionPackage.records;
  const byKey = correctionPackageBySourceKey(correctionPackage);
  if (args.sourceKeys.length > 0) {
    const missing = args.sourceKeys.filter(sourceKey => !byKey.has(sourceKey));
    if (missing.length > 0) throw new Error("Secilen sourceKey correction package icinde bulunamadi");
    return args.sourceKeys.map(sourceKey => byKey.get(sourceKey) as HistoricalPickupTimeCorrectionCandidate);
  }
  return correctionPackage.records.slice(0, args.limit as number);
}

async function loadStates(sourceKeys: string[], lock = false) {
  const { db, historicalOperationImportsTable, operationsTable } = await import("@workspace/db");
  const importsQuery = db.select({
    id: historicalOperationImportsTable.id,
    sourceKey: historicalOperationImportsTable.sourceKey,
    sourceFileId: historicalOperationImportsTable.sourceFileId,
    worksheetName: historicalOperationImportsTable.worksheetName,
    sourceRow: historicalOperationImportsTable.sourceRow,
    status: historicalOperationImportsTable.status,
    payload: historicalOperationImportsTable.payload,
    payloadSha256: historicalOperationImportsTable.payloadSha256,
    importedOperationId: historicalOperationImportsTable.importedOperationId,
    promotedContentSha256: historicalOperationImportsTable.promotedContentSha256,
    approvalVersion: historicalOperationImportsTable.approvalVersion,
  }).from(historicalOperationImportsTable).where(inArray(historicalOperationImportsTable.sourceKey, sourceKeys));
  const importedRows = lock ? await importsQuery.for("update") : await importsQuery;
  const importedIds = importedRows.flatMap(row => row.importedOperationId === null ? [] : [row.importedOperationId]);
  const operationsQuery = importedIds.length === 0 ? null : db.select({
    id: operationsTable.id,
    sourceHistoricalKey: operationsTable.sourceHistoricalKey,
    pickupTime: operationsTable.pickupTime,
    version: operationsTable.version,
  }).from(operationsTable).where(inArray(operationsTable.id, importedIds));
  const operations = operationsQuery === null ? [] : lock ? await operationsQuery.for("update") : await operationsQuery;
  return {
    imports: new Map(importedRows.map(row => [row.sourceKey, row as HistoricalImportCorrectionState])),
    operations: new Map(operations.map(row => [row.id, row as ImportedOperationCorrectionState])),
  };
}

export async function planHistoricalPickupTimeCorrection(candidates: HistoricalPickupTimeCorrectionCandidate[]) {
  const states = await loadStates(candidates.map(candidate => candidate.sourceKey));
  const assessments = candidates.map(candidate => assessHistoricalPickupTimeCorrection({
    candidate,
    historicalImport: states.imports.get(candidate.sourceKey) ?? null,
    operation: states.operations.get(states.imports.get(candidate.sourceKey)?.importedOperationId ?? -1) ?? null,
  }));
  const classifications: Record<string, number> = Object.fromEntries([
    "eligible_pending", "eligible_imported", "already_canonical", "malformed_or_unsupported",
    "payload_integrity_failed", "missing_imported_operation", "operation_pickup_conflict",
    "unsupported_status", "source_not_found",
  ].map(key => [key, 0]));
  for (const assessment of assessments) classifications[assessment.classification] += 1;
  return { classifications, assessments };
}

export type PickupTimeCorrectionApplyOutcome =
  | "pending_corrected"
  | "imported_corrected"
  | "existing"
  | "conflict"
  | "blocked"
  | "failed";

export interface PickupTimeCorrectionApplySummary {
  attempted: number;
  pendingCorrected: number;
  importedCorrected: number;
  existing: number;
  conflict: number;
  blocked: number;
  failed: number;
}

/** Pure output contract: pending corrections never claim an operation write. */
export function summarizePickupTimeCorrectionApply(
  outcomes: PickupTimeCorrectionApplyOutcome[],
): PickupTimeCorrectionApplySummary {
  const summary: PickupTimeCorrectionApplySummary = {
    attempted: outcomes.length,
    pendingCorrected: 0,
    importedCorrected: 0,
    existing: 0,
    conflict: 0,
    blocked: 0,
    failed: 0,
  };
  for (const outcome of outcomes) {
    if (outcome === "pending_corrected") summary.pendingCorrected += 1;
    else if (outcome === "imported_corrected") summary.importedCorrected += 1;
    else summary[outcome] += 1;
  }
  return summary;
}

export function pickupTimeCorrectionWriteFlags(summary: PickupTimeCorrectionApplySummary) {
  return {
    databaseWrites: summary.pendingCorrected + summary.importedCorrected > 0,
    operationWrites: summary.importedCorrected > 0,
    customerWrites: false,
  };
}

class CorrectionRollback extends Error {
  constructor(public readonly kind: "conflict" | "blocked", message: string) {
    super(message);
  }
}

async function applyOne(candidate: HistoricalPickupTimeCorrectionCandidate, actorProfileId: number): Promise<PickupTimeCorrectionApplyOutcome> {
  const { db, historicalOperationImportsTable, operationsTable } = await import("@workspace/db");
  const { createAuditLog } = await import("./lib/audit");
  try {
    return await db.transaction(async tx => {
      // New namespace: Phase 3C uses (2026,3), promotion (2026,4), customer
      // linking (2026,5); this correction owns (2026,6).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(2026, 6)`);
      const [row] = await tx.select({
        id: historicalOperationImportsTable.id,
        sourceKey: historicalOperationImportsTable.sourceKey,
        sourceFileId: historicalOperationImportsTable.sourceFileId,
        worksheetName: historicalOperationImportsTable.worksheetName,
        sourceRow: historicalOperationImportsTable.sourceRow,
        status: historicalOperationImportsTable.status,
        payload: historicalOperationImportsTable.payload,
        payloadSha256: historicalOperationImportsTable.payloadSha256,
        approvalVersion: historicalOperationImportsTable.approvalVersion,
          importedOperationId: historicalOperationImportsTable.importedOperationId,
          promotedContentSha256: historicalOperationImportsTable.promotedContentSha256,
      }).from(historicalOperationImportsTable).where(eq(historicalOperationImportsTable.sourceKey, candidate.sourceKey)).for("update");
      if (!row) return "blocked";
      const operationQuery = row.importedOperationId === null ? null : tx.select({
        id: operationsTable.id,
        sourceHistoricalKey: operationsTable.sourceHistoricalKey,
        pickupTime: operationsTable.pickupTime,
        version: operationsTable.version,
      }).from(operationsTable).where(eq(operationsTable.id, row.importedOperationId));
      const [operation] = operationQuery === null ? [] : await operationQuery.for("update");
      const assessment = assessHistoricalPickupTimeCorrection({
        candidate,
        historicalImport: row as HistoricalImportCorrectionState,
        operation: operation ? operation as ImportedOperationCorrectionState : null,
      });
      if (assessment.classification === "already_canonical") return "existing";
      if (assessment.classification === "operation_pickup_conflict") throw new CorrectionRollback("conflict", "Operasyon pickup_time beklenen eski veya yeni degerle uyusmuyor");
      if (assessment.classification !== "eligible_pending" && assessment.classification !== "eligible_imported") {
        throw new CorrectionRollback("blocked", `Correction uygun degil: ${assessment.classification}`);
      }
      if (!assessment.correctedPayload || !assessment.correctedPayloadSha256) {
        throw new Error("Correction hedef payload'i olusturulamadi");
      }

      let newOperationVersion: number | null = null;
      if (assessment.classification === "eligible_imported") {
        // operations.version is this table's established CAS/audit-visibility
        // token (see routes/field.ts status/assignment updates) - bump it here
        // too so a pickup correction is not a silently version-invisible write.
        const operationVersion = (operation as ImportedOperationCorrectionState).version;
        const changedOperation = await tx.update(operationsTable)
          .set({ pickupTime: candidate.newPickupTime, version: sql`${operationsTable.version} + 1` })
          .where(and(
            eq(operationsTable.id, assessment.operationId as number),
            eq(operationsTable.sourceHistoricalKey, candidate.sourceKey),
            eq(operationsTable.pickupTime, candidate.oldPickupTime),
            eq(operationsTable.version, operationVersion),
          ))
          .returning({ id: operationsTable.id, version: operationsTable.version });
        if (!changedOperation[0]) throw new CorrectionRollback("conflict", "Operasyon pickup_time veya version CAS kontrolu basarisiz");
        newOperationVersion = changedOperation[0].version;
      }

      // The remediation/approval flows CAS on approvalVersion, so a pickup
      // correction must CAS + increment it too; otherwise a concurrent
      // remediation could silently overwrite this correction (or vice versa).
      // A version mismatch fails closed as a conflict.
      if (!Number.isInteger(row.approvalVersion) || row.approvalVersion < 1) {
        throw new CorrectionRollback("conflict", "Historical import surum bilgisi kilitli satirdan okunamadi");
      }
      const importCas = assessment.classification === "eligible_imported"
        ? and(
          eq(historicalOperationImportsTable.id, assessment.historicalImportId as number),
          eq(historicalOperationImportsTable.sourceKey, candidate.sourceKey),
          eq(historicalOperationImportsTable.status, "imported"),
          eq(historicalOperationImportsTable.payloadSha256, candidate.payloadSha256Before),
          eq(historicalOperationImportsTable.promotedContentSha256, row.promotedContentSha256 as string),
          eq(historicalOperationImportsTable.approvalVersion, row.approvalVersion),
        )
        : and(
          eq(historicalOperationImportsTable.id, assessment.historicalImportId as number),
          eq(historicalOperationImportsTable.sourceKey, candidate.sourceKey),
          eq(historicalOperationImportsTable.status, "pending"),
          eq(historicalOperationImportsTable.payloadSha256, candidate.payloadSha256Before),
          eq(historicalOperationImportsTable.approvalVersion, row.approvalVersion),
        );
      // approvalVersion is this table's established CAS/audit-visibility token
      // for any content correction (see historical-remediation-mutation.ts),
      // not only approve/reject - bump it here for the same reason.
      const changedImport = await tx.update(historicalOperationImportsTable).set({
        payload: assessment.correctedPayload,
        payloadSha256: assessment.correctedPayloadSha256,
        approvalVersion: sql`${historicalOperationImportsTable.approvalVersion} + 1`,
        ...(assessment.classification === "eligible_imported"
          ? { promotedContentSha256: assessment.correctedPromotedContentSha256 as string }
          : {}),
      }).where(importCas).returning({ id: historicalOperationImportsTable.id, approvalVersion: historicalOperationImportsTable.approvalVersion });
      if (!changedImport[0]) throw new CorrectionRollback("conflict", "Historical import payload CAS kontrolu basarisiz");

      await createAuditLog({
        eventType: "historical_pickup_time_corrected",
        actorProfileId,
        module: "historical_migration",
        entityType: assessment.classification === "eligible_imported" ? "operation" : "historical_operation_import",
        entityId: assessment.classification === "eligible_imported" ? assessment.operationId as number : assessment.historicalImportId as number,
        oldValue: { pickupTime: candidate.oldPickupTime },
        newValue: { pickupTime: candidate.newPickupTime },
        metadata: {
          sourceKey: candidate.sourceKey,
          historicalImportId: assessment.historicalImportId,
          operationId: assessment.operationId,
          oldPickupTime: candidate.oldPickupTime,
          newPickupTime: candidate.newPickupTime,
          path: assessment.classification === "eligible_imported" ? "imported" : "pending",
          oldApprovalVersion: row.approvalVersion,
          newApprovalVersion: changedImport[0].approvalVersion,
          oldOperationVersion: assessment.classification === "eligible_imported" ? (operation as ImportedOperationCorrectionState).version : null,
          newOperationVersion,
        },
        description: "Historical Excel pickup-time sentinel degeri canonical HH:mm degerine duzeltildi",
      }, tx);
      return assessment.classification === "eligible_pending" ? "pending_corrected" : "imported_corrected";
    });
  } catch (error) {
    if (error instanceof CorrectionRollback) return error.kind;
    return "failed";
  }
}

export async function applyHistoricalPickupTimeCorrection(candidates: HistoricalPickupTimeCorrectionCandidate[], actorProfileId: number) {
  const outcomes: PickupTimeCorrectionApplyOutcome[] = [];
  for (const candidate of candidates) {
    outcomes.push(await applyOne(candidate, actorProfileId));
  }
  return summarizePickupTimeCorrectionApply(outcomes);
}

async function main() {
  const args = parseHistoricalPickupTimeCorrectionArgs(process.argv.slice(2));
  const connectionString = validateHistoricalPickupTimeCorrectionTarget();
  const correctionPackage = parseHistoricalPickupTimeCorrectionPackage(JSON.parse(await readFile(resolve(args.inputPath), "utf8")));
  const candidates = selectedCandidates(correctionPackage, args);
  process.env.DATABASE_URL = connectionString;
  const { pool } = await import("@workspace/db");
  try {
    if (!args.apply) {
      const plan = await planHistoricalPickupTimeCorrection(candidates);
      console.log(JSON.stringify({
        mode: "historical-pickup-time-correction-plan",
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
    // APPLY is intentionally authorized with its own dedicated action; do
    // not substitute the broader historical_migration.promote permission.
    const { verifyOperatorPermission } = await import("./lib/historical-migration-operator");
    const verification = await verifyOperatorPermission(
      args.operatorProfileId as number,
      "historical_migration",
      "pickup_time_correct",
    );
    if (!verification.ok) throw new Error(verification.message);
    const summary = await applyHistoricalPickupTimeCorrection(candidates, args.operatorProfileId as number);
    console.log(JSON.stringify({
      mode: "historical-pickup-time-correction-apply",
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
    console.error(error instanceof Error ? error.message : "Historical pickup-time correction basarisiz");
    process.exit(1);
  });
}
