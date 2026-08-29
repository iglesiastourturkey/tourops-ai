import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray, sql } from "drizzle-orm";
import {
  buildPromotionProjectionFromExisting,
  buildPromotionProjectionFromStaging,
  decidePromotionOutcome,
  historicalImportTransitionBlock,
  verifyStagedPayloadIntegrity,
} from "./lib/historical-migration-promote-validation";
import type { HistoricalStagingRecord } from "./lib/historical-migration-stage-validation";

const CONFIRMATION = "TOURPILOT_2026_HISTORICAL_PROMOTION";
// A single CLI invocation is deliberately capped well below "all pending
// approved rows": Phase 3D-A's whole point is controlled, human-reviewed
// batches, not a bulk re-run of Phase 3C at operation-creation scale. 25 is
// large enough to cover a realistic reviewed batch (the first staging
// acceptance step only ever asks for --limit 3) while staying far short of
// the 3519 total, so an operator mistyping a flag cannot accidentally
// promote the whole staged set in one command.
const MAX_APPLY_LIMIT = 25;

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
    "Kullanim: pnpm --filter @workspace/api-server historical:promote -- "
    + "[--source-key <key> ...] [--limit <n>] "
    + "[--apply --confirm-promotion TOURPILOT_2026_HISTORICAL_PROMOTION]",
  );
  process.exit(2);
}

function validatePromotionTarget(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production ortaminda historical promotion calistirilamaz");
  }
  const connectionString = process.env.HISTORICAL_STAGING_DATABASE_URL;
  const allowedHost = process.env.HISTORICAL_STAGING_DATABASE_HOST;
  if (!connectionString || !allowedHost) {
    throw new Error("HISTORICAL_STAGING_DATABASE_URL ve HISTORICAL_STAGING_DATABASE_HOST gerekli");
  }
  const url = new URL(connectionString);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("Historical promotion baglantisi PostgreSQL olmali");
  }
  if (url.hostname !== allowedHost || !url.hostname.endsWith(".neon.tech")) {
    throw new Error("Historical promotion host allowlist veya Neon kontrolu basarisiz");
  }
  return connectionString;
}

interface PromoteArgs {
  sourceKeys: string[];
  limit: number | null;
  apply: boolean;
  // PLAN reports on staged state without acting on anyone's behalf, so it
  // stays actor-free (null). APPLY performs a real, attributable write and
  // parseArgs refuses to return apply:true without one - see the apply-mode
  // block below.
  operatorProfileId: number | null;
}

function parseArgs(args: string[]): PromoteArgs {
  const sourceKeys = optionAll(args, "--source-key");
  const limitRaw = option(args, "--limit");
  const limit = limitRaw ? Number(limitRaw) : null;
  if (limitRaw && (!Number.isInteger(limit) || (limit as number) <= 0)) {
    throw new Error("--limit pozitif bir tam sayi olmalidir");
  }

  const operatorRaw = option(args, "--operator-profile-id");
  const operatorProfileId = operatorRaw ? Number(operatorRaw) : null;
  if (operatorRaw && (!Number.isInteger(operatorProfileId) || (operatorProfileId as number) <= 0)) {
    throw new Error("--operator-profile-id pozitif bir tam sayi olmalidir");
  }

  const apply = args.includes("--apply");
  if (apply) {
    if (sourceKeys.length === 0 && limit === null) {
      throw new Error("Apply modu icin --source-key veya --limit zorunludur (sinirsiz promotion yapilamaz)");
    }
    if (limit !== null && limit > MAX_APPLY_LIMIT) {
      throw new Error(`--limit en fazla ${MAX_APPLY_LIMIT} olabilir`);
    }
    if (sourceKeys.length > MAX_APPLY_LIMIT) {
      throw new Error(`Tek calistirmada en fazla ${MAX_APPLY_LIMIT} sourceKey hedeflenebilir`);
    }
    // Real promotion must be attributable to an authorized operator - a null
    // actor is never acceptable once writes are in play (PLAN mode, above,
    // is the only actor-free path).
    if (operatorProfileId === null) {
      throw new Error("Apply modu icin --operator-profile-id zorunludur");
    }
  }
  return { sourceKeys, limit, apply, operatorProfileId };
}

interface PromoteBatchSummary {
  attempted: number;
  inserted: number;
  existing: number;
  conflicts: number;
  blocked: number;
  failed: number;
}

async function planPromotion(sourceKeys: string[], limit: number | null) {
  const { db, historicalOperationImportsTable, operationsTable, operationReservationDetailsTable } =
    await import("@workspace/db");

  const statusCounts = await db
    .select({ status: historicalOperationImportsTable.status, count: sql<number>`count(*)::int` })
    .from(historicalOperationImportsTable)
    .groupBy(historicalOperationImportsTable.status);
  const countOf = (status: string) => statusCounts.find(row => row.status === status)?.count ?? 0;

  let selectedSourceKeys: string[] = [];
  // Explicit --source-key selection may target an approved row for its first
  // promotion or an imported row for a deliberate idempotent replay/conflict
  // check. Pending/rejected/missing rows remain blocked. Limit-based discovery
  // intentionally stays approved-only so replay can never become an implicit
  // bulk operation.
  let requestedButNotPromotable = 0;
  if (sourceKeys.length > 0) {
    const rows = await db
      .select({ sourceKey: historicalOperationImportsTable.sourceKey, status: historicalOperationImportsTable.status })
      .from(historicalOperationImportsTable)
      .where(inArray(historicalOperationImportsTable.sourceKey, sourceKeys));
    const foundByKey = new Map(rows.map(row => [row.sourceKey, row.status]));
    selectedSourceKeys = sourceKeys.filter(key => {
      const status = foundByKey.get(key);
      return status === "approved" || status === "imported";
    });
    requestedButNotPromotable = sourceKeys.length - selectedSourceKeys.length;
  } else if (limit !== null) {
    const rows = await db
      .select({ sourceKey: historicalOperationImportsTable.sourceKey })
      .from(historicalOperationImportsTable)
      .where(eq(historicalOperationImportsTable.status, "approved"))
      .orderBy(historicalOperationImportsTable.id)
      .limit(limit);
    selectedSourceKeys = rows.map(row => row.sourceKey);
  }

  // Read-only walk of the same decision logic promoteOne uses, so the plan's
  // potentialConflicts/promotionBlocked numbers describe exactly what an
  // --apply run against this same selection would do. No writes anywhere in
  // this function.
  let potentialConflicts = 0;
  let payloadIntegrityBlocked = 0;
  if (selectedSourceKeys.length > 0) {
    const stagingRows = await db
      .select({
        sourceKey: historicalOperationImportsTable.sourceKey,
        payload: historicalOperationImportsTable.payload,
        payloadSha256: historicalOperationImportsTable.payloadSha256,
      })
      .from(historicalOperationImportsTable)
      .where(inArray(historicalOperationImportsTable.sourceKey, selectedSourceKeys));

    for (const stagingRow of stagingRows) {
      if (!verifyStagedPayloadIntegrity(stagingRow)) {
        payloadIntegrityBlocked += 1;
        continue;
      }
      const target = buildPromotionProjectionFromStaging(
        stagingRow.sourceKey,
        stagingRow.payload as HistoricalStagingRecord,
      );
      const [existingOperation] = await db
        .select()
        .from(operationsTable)
        .where(eq(operationsTable.sourceHistoricalKey, stagingRow.sourceKey));
      let existingProjection: ReturnType<typeof buildPromotionProjectionFromExisting> | null = null;
      if (existingOperation) {
        const [existingDetails] = await db
          .select()
          .from(operationReservationDetailsTable)
          .where(eq(operationReservationDetailsTable.operationId, existingOperation.id));
        existingProjection = buildPromotionProjectionFromExisting(existingOperation, existingDetails ?? null);
      }
      const { outcome } = decidePromotionOutcome(target, existingProjection);
      if (outcome === "conflict") potentialConflicts += 1;
    }
  }

  const [existingOperationsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(operationsTable)
    .where(sql`${operationsTable.sourceHistoricalKey} IS NOT NULL`);

  return {
    mode: "historical-promotion-plan",
    databaseWrites: false,
    eligibleApproved: countOf("approved"),
    pending: countOf("pending"),
    rejected: countOf("rejected"),
    alreadyImported: countOf("imported"),
    promotionBlocked: requestedButNotPromotable + payloadIntegrityBlocked,
    existingOperations: existingOperationsRow?.count ?? 0,
    potentialConflicts,
    requestedLimit: limit,
    selectedSourceKeys,
    requiresApplyConfirmation: true,
  };
}

/**
 * Thrown inside the per-record transaction for outcomes that must roll the
 * whole record back (payload tampering, content conflict): the transaction
 * commits nothing, and the caller records last_error + a best-effort audit
 * event afterwards, in its own short transaction - the rolled-back
 * transaction cannot retain one itself.
 */
class PromotionRollback extends Error {
  constructor(public readonly outcome: "conflict" | "blocked", message: string) {
    super(message);
  }
}

async function promoteOne(
  sourceKey: string,
  actorProfileId: number | null,
): Promise<"inserted" | "existing" | "conflict" | "blocked" | "failed"> {
  const { db, historicalOperationImportsTable, operationsTable, operationReservationDetailsTable } =
    await import("@workspace/db");
  const { createAuditLog } = await import("./lib/audit");

  try {
    return await db.transaction(async (tx) => {
      // 0. Serialize concurrent promotion runs against the same record. Key
      // (2026, 4) is deliberately distinct from Phase 3C staging's (2026, 3)
      // so a concurrent staging import and a concurrent promotion never
      // contend on the same lock.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(2026, 4)`);

      // 1. Lock the staging row.
      const [row] = await tx
        .select()
        .from(historicalOperationImportsTable)
        .where(eq(historicalOperationImportsTable.sourceKey, sourceKey))
        .for("update");
      if (!row) return "blocked";

      // 2. Promotion accepts an approved first-run or an imported explicit
      // idempotent replay. Pending/rejected remain blocked by the state machine.
      const blocked = historicalImportTransitionBlock("promote", row.status);
      if (blocked) return "blocked";

      // 3. Payload integrity: the staged payload must still hash to the
      // payload_sha256 recorded at Phase 3C staging time. A mismatch means
      // the row was modified after Phase 3C - fail closed, never promote it.
      if (!verifyStagedPayloadIntegrity({ payload: row.payload, payloadSha256: row.payloadSha256 })) {
        throw new PromotionRollback("blocked", "payload_sha256 uyusmuyor - staging payload Faz 3C sonrasi degismis olabilir");
      }

      // 4. Deterministic target projection + hash.
      const payload = row.payload as HistoricalStagingRecord;
      const target = buildPromotionProjectionFromStaging(sourceKey, payload);

      // 5. Idempotency/conflict check against any existing operation with
      // this sourceHistoricalKey.
      const [existingOperation] = await tx
        .select()
        .from(operationsTable)
        .where(eq(operationsTable.sourceHistoricalKey, sourceKey))
        .for("update");

      let existingProjection: ReturnType<typeof buildPromotionProjectionFromExisting> | null = null;
      if (existingOperation) {
        const [existingDetails] = await tx
          .select()
          .from(operationReservationDetailsTable)
          .where(eq(operationReservationDetailsTable.operationId, existingOperation.id));
        existingProjection = buildPromotionProjectionFromExisting(existingOperation, existingDetails ?? null);
      }

      const { outcome, targetHash } = decidePromotionOutcome(target, existingProjection);

      if (outcome === "conflict") {
        throw new PromotionRollback("conflict", "Ayni sourceHistoricalKey farkli promoted-icerikle zaten operasyona donusturulmus");
      }

      let operationId: number;
      if (outcome === "inserted") {
        // 6. Create operation (customerId/master-data FKs left NULL by design).
        const [created] = await tx.insert(operationsTable).values({
          sourceHistoricalKey: target.operation.sourceHistoricalKey,
          sourceType: target.operation.sourceType,
          sourceBookingReference: target.operation.sourceBookingReference,
          startDate: target.operation.startDate,
          endDate: target.operation.endDate,
          pickupTime: target.operation.pickupTime,
          notes: target.operation.notes,
          status: "draft",
        }).onConflictDoNothing({ target: operationsTable.sourceHistoricalKey }).returning();

        if (!created) {
          // Lost a race against a concurrent promotion of the same key between
          // steps 5 and 6 - re-read and treat as an idempotent replay instead
          // of failing the record outright.
          const [raced] = await tx.select().from(operationsTable).where(eq(operationsTable.sourceHistoricalKey, sourceKey));
          if (!raced) throw new Error("Operasyon eklenemedi ve yeniden okunamadi");
          operationId = raced.id;
        } else {
          operationId = created.id;
          // 7. Create the 1:1 reservation-details row.
          await tx.insert(operationReservationDetailsTable).values({
            operationId,
            adultCount: target.reservationDetails.adultCount,
            childCount: target.reservationDetails.childCount,
            passengerLanguage: target.reservationDetails.passengerLanguage,
            tourType: target.reservationDetails.tourType,
            itineraryRaw: target.reservationDetails.itineraryRaw,
            pickupPoint: target.reservationDetails.pickupPoint,
            externalSource: target.reservationDetails.externalSource,
            externalOperator: target.reservationDetails.externalOperator,
            collectionStatusRaw: target.reservationDetails.collectionStatusRaw,
          });
        }
      } else if (existingOperation) {
        operationId = existingOperation.id;
      } else {
        throw new Error("existing outcome without an existing operation - unreachable");
      }

      // 8. Update the staging row to imported + provenance back-link.
      await tx.update(historicalOperationImportsTable)
        .set({
          status: "imported",
          importedOperationId: operationId,
          importedAt: new Date(),
          promotedContentSha256: targetHash,
          lastError: null,
        })
        .where(eq(historicalOperationImportsTable.sourceKey, sourceKey));

      // 9. Audit row, atomic with everything above (strict mode: a failure
      // here throws and rolls the whole record back, per Phase 3D-A design).
      await createAuditLog({
        eventType: outcome === "existing" ? "historical_migration_promotion_replayed" : "historical_migration_promoted",
        actorProfileId: actorProfileId ?? undefined,
        module: "historical_migration",
        entityType: "operation",
        entityId: operationId,
        metadata: { sourceKey, imported_operation_id: operationId, outcome },
        description: outcome === "existing"
          ? "Historical staging kaydi zaten operasyona donusturulmustu (idempotent tekrar)"
          : "Historical staging kaydi operasyona donusturuldu",
      }, tx);

      return outcome;
    });
  } catch (error) {
    // The transaction above rolled back completely (including the audit
    // insert attempt, if the flow got that far). Record what happened on the
    // staging row in its own short transaction, and log a best-effort audit
    // event for the conflict/failure - the rolled-back transaction cannot
    // retain one itself, per Phase 3D-A design.
    const isConflict = error instanceof PromotionRollback && error.outcome === "conflict";
    const outcome: "conflict" | "blocked" | "failed" =
      error instanceof PromotionRollback ? error.outcome : "failed";
    const message = error instanceof Error ? error.message.slice(0, 500) : "Bilinmeyen hata";

    await db.update(historicalOperationImportsTable)
      .set({ lastError: message })
      .where(eq(historicalOperationImportsTable.sourceKey, sourceKey))
      .catch(() => undefined);
    await createAuditLog({
      eventType: isConflict ? "historical_migration_promotion_conflict" : "historical_migration_promotion_failed",
      actorProfileId: actorProfileId ?? undefined,
      module: "historical_migration",
      entityType: "historical_operation_import",
      entityId: sourceKey,
      metadata: { sourceKey, error: message },
      result: "failure",
      description: isConflict
        ? "Historical staging kaydi mevcut operasyonla celisiyor, promotion iptal edildi"
        : "Historical staging promotion basarisiz",
    }).catch(() => undefined);
    return outcome;
  }
}

async function applyPromotion(
  sourceKeys: string[],
  connectionString: string,
  operatorProfileId: number,
): Promise<PromoteBatchSummary> {
  process.env.DATABASE_URL = connectionString;
  const { pool } = await import("@workspace/db");

  const summary: PromoteBatchSummary = { attempted: 0, inserted: 0, existing: 0, conflicts: 0, blocked: 0, failed: 0 };
  try {
    // Each record gets its own transaction (see promoteOne) - a per-record
    // failure never rolls back a sibling record's successful promotion. The
    // pg_advisory_xact_lock(2026, 4) taken inside each of those transactions
    // (a key distinct from Phase 3C staging's (2026, 3)) is what actually
    // serializes concurrent runs; there is deliberately no batch-wide lock
    // or wrapping transaction here.
    for (const sourceKey of sourceKeys) {
      summary.attempted += 1;
      const outcome = await promoteOne(sourceKey, operatorProfileId);
      if (outcome === "inserted") summary.inserted += 1;
      else if (outcome === "existing") summary.existing += 1;
      else if (outcome === "conflict") summary.conflicts += 1;
      else if (outcome === "blocked") summary.blocked += 1;
      else summary.failed += 1;
    }
    return summary;
  } finally {
    await pool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) usage();

  const { sourceKeys, limit, apply, operatorProfileId } = parseArgs(args);

  if (!apply) {
    process.env.DATABASE_URL ??= validatePromotionTarget();
    const plan = await planPromotion(sourceKeys, limit);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (option(args, "--confirm-promotion") !== CONFIRMATION) {
    throw new Error("Promotion icin tam onay ifadesi gerekli");
  }
  // parseArgs already guarantees operatorProfileId is set whenever apply is
  // true - this is defense in depth, not the primary gate.
  if (operatorProfileId === null) {
    throw new Error("Apply modu icin --operator-profile-id zorunludur");
  }
  const connectionString = validatePromotionTarget();
  process.env.DATABASE_URL = connectionString;

  // Do NOT trust --operator-profile-id merely because it was supplied: load
  // the profile, require it active, and check historical_migration.promote
  // through the same hasPermission() policy every HTTP route uses.
  const { verifyOperatorPermission } = await import("./lib/historical-migration-operator");
  const verification = await verifyOperatorPermission(operatorProfileId, "historical_migration", "promote");
  if (!verification.ok) {
    throw new Error(verification.message);
  }

  let targetKeys = sourceKeys;
  if (targetKeys.length === 0 && limit !== null) {
    const { db, historicalOperationImportsTable } = await import("@workspace/db");
    const rows = await db
      .select({ sourceKey: historicalOperationImportsTable.sourceKey })
      .from(historicalOperationImportsTable)
      .where(eq(historicalOperationImportsTable.status, "approved"))
      .orderBy(historicalOperationImportsTable.id)
      .limit(limit);
    targetKeys = rows.map(row => row.sourceKey);
  }

  const summary = await applyPromotion(targetKeys, connectionString, operatorProfileId);
  console.log(JSON.stringify({
    mode: "historical-promotion-apply",
    databaseWrites: true,
    customersWrites: false,
    operatorProfileId,
    ...summary,
  }, null, 2));
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Historical promotion basarisiz");
    process.exit(1);
  });
}

// Exported for the self-test (pure arg-parsing, no DB access).
export { parseArgs, MAX_APPLY_LIMIT };