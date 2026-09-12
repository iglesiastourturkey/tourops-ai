import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { validateProductionPickupTimeCorrectionTarget } from "./lib/historical-pickup-time-correction";
import { sha256Hex } from "./lib/customer-identity";
import { pickLaneCandidate } from "./lib/customer-identity";
import {
  assessCustomerProjection,
  parseCustomerProjectionPackage,
  resolveCreateReuseDowngrade,
  type CustomerProjectionPackage,
  type CustomerProjectionRecord,
} from "./lib/historical-customer-projection-package";

// Phase 3H.4B — production-only customer projection runner over the shared
// pure core (lib/historical-customer-projection-package.ts). No correction
// logic lives here: assessment, hashing and classification come from the
// shared core; this file owns only targeting, guards, transactions, audit.
//
// Phase status: PLAN is implemented and unit-tested. APPLY is implemented
// but MUST NOT be executed against production until a dedicated 3H.4C
// owner GO authorizes a canary.
//
// Fail closed:
//   - REQUIRES NODE_ENV=production (reuses the shared production guard;
//     staging variables are never consulted, URL never logged).
//   - PLAN is read-only; APPLY needs explicit targeting (<=25), the exact
//     production confirmation phrase, and dedicated permissions:
//     historical_migration.customer_link always, plus
//     historical_migration.customer_create when the batch contains CREATE.

const CONFIRMATION = "TOURPILOT_2026_PRODUCTION_CUSTOMER_PROJECTION";
export const MAX_APPLY_LIMIT = 25;

export interface ProductionCustomerProjectionArgs {
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

/** Strict parser mirroring the pickup production runner shape. */
export function parseProductionCustomerProjectionArgs(args: string[]): ProductionCustomerProjectionArgs {
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
    if (arg === "--confirm-production-customer-projection") {
      if (confirmation !== null) throw new Error("--confirm-production-customer-projection bir kez kullanilabilir");
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
    if (confirmation !== CONFIRMATION) throw new Error("Production customer projection APPLY icin tam onay ifadesi gerekli");
    if (operatorProfileId === null) throw new Error("Apply modu icin --operator-profile-id zorunludur");
  }
  return { inputPath, sourceKeys, limit, apply, operatorProfileId };
}

export function selectedProjectionRecords(
  projectionPackage: CustomerProjectionPackage,
  args: ProductionCustomerProjectionArgs,
): CustomerProjectionRecord[] {
  if (!args.apply) return projectionPackage.records;
  const byKey = new Map(projectionPackage.records.map(record => [record.sourceKey, record]));
  if (args.sourceKeys.length > 0) {
    const missing = args.sourceKeys.filter(sourceKey => !byKey.has(sourceKey));
    if (missing.length > 0) throw new Error("Secilen sourceKey projection package icinde bulunamadi");
    return args.sourceKeys.map(sourceKey => byKey.get(sourceKey) as CustomerProjectionRecord);
  }
  return projectionPackage.records.slice(0, args.limit as number);
}

export type CustomerProjectionApplyOutcome =
  | "reused"
  | "created"
  | "existing"
  | "conflict"
  | "blocked"
  | "failed";

export interface IdentityLaneMaps {
  byIdentity: Map<string, number[]>;
  byEmail: Map<string, number[]>;
  byPhone: Map<string, number[]>;
}

export type IdentityLaneKind = "identity" | "email" | "phone";

/**
 * Lane query fan-in shared by PLAN (db executor) and APPLY (tx executor).
 * Each lane reports ACTIVE customer ids per lookup value; multiplicity is
 * preserved per value so callers fail closed via pickLaneCandidate.
 */
export async function queryIdentityLanes(
  fetchRows: (lane: IdentityLaneKind) => Promise<{ key: string; id: number }[]>,
): Promise<IdentityLaneMaps> {
  const maps: IdentityLaneMaps = { byIdentity: new Map(), byEmail: new Map(), byPhone: new Map() };
  const lanes: IdentityLaneKind[] = ["identity", "email", "phone"];
  for (const lane of lanes) {
    const target = lane === "identity" ? maps.byIdentity : lane === "email" ? maps.byEmail : maps.byPhone;
    for (const row of await fetchRows(lane)) {
      const list = target.get(row.key) ?? [];
      list.push(row.id);
      target.set(row.key, list);
    }
  }
  return maps;
}

export function laneResult(ids: number[], kind: IdentityLaneKind): {
  id: number | null;
  conflict: IdentityLaneKind | null;
} {
  const pick = pickLaneCandidate(ids);
  return { id: pick.id, conflict: pick.multiple ? kind : null };
}

export interface CustomerProjectionApplySummary {
  attempted: number;
  reused: number;
  created: number;
  existing: number;
  conflict: number;
  blocked: number;
  failed: number;
}

export function summarizeCustomerProjectionApply(outcomes: CustomerProjectionApplyOutcome[]): CustomerProjectionApplySummary {
  const summary: CustomerProjectionApplySummary = {
    attempted: outcomes.length, reused: 0, created: 0, existing: 0, conflict: 0, blocked: 0, failed: 0,
  };
  for (const outcome of outcomes) summary[outcome] += 1;
  return summary;
}

export function customerProjectionWriteFlags(summary: CustomerProjectionApplySummary) {
  return {
    databaseWrites: summary.reused + summary.created > 0,
    operationWrites: false,
    customerWrites: summary.created > 0,
    reservationWrites: summary.reused + summary.created > 0,
  };
}

class ProjectionRollback extends Error {
  constructor(public readonly kind: "conflict" | "blocked", message: string) {
    super(message);
  }
}

async function applyOne(record: CustomerProjectionRecord, actorProfileId: number): Promise<CustomerProjectionApplyOutcome> {
  const { db, customersTable, historicalOperationImportsTable, reservationsTable } = await import("@workspace/db");
  const { createAuditLog } = await import("./lib/audit");
  try {
    return await db.transaction(async tx => {
      // Serialize concurrent projections for one identity: at most one
      // customer per identityKey even under concurrent execution.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${record.identityKey ?? record.sourceKey}))`);
      const [reservation] = await tx.select({
        id: reservationsTable.id,
        customerId: reservationsTable.customerId,
        version: reservationsTable.version,
        leadGuestName: reservationsTable.leadGuestName,
        sourceHistoricalKey: reservationsTable.sourceHistoricalKey,
      }).from(reservationsTable).where(eq(reservationsTable.id, record.reservationId)).for("update");
      if (!reservation) throw new ProjectionRollback("blocked", "Rezervasyon bulunamadi");
      const [historicalImport] = await tx.select({
        status: historicalOperationImportsTable.status,
      }).from(historicalOperationImportsTable).where(eq(historicalOperationImportsTable.sourceKey, record.sourceKey));
      // Re-query every identity lane INSIDE the transaction, under the
      // advisory lock taken above: concurrent projections serialize here,
      // and each lane reports all active matches so multiplicity fails
      // closed via pickLaneCandidate (never a first-row pick).
      const txLaneColumn = (lane: IdentityLaneKind) =>
        lane === "identity" ? customersTable.identityKey
        : lane === "email" ? customersTable.normalizedEmail
        : customersTable.normalizedPhone;
      const txLaneValue = (lane: IdentityLaneKind): string | null =>
        lane === "identity" ? record.identityKey
        : lane === "email" ? record.normalizedEmail
        : record.normalizedPhone;
      const txLaneMaps = await queryIdentityLanes(async lane => {
        const value = txLaneValue(lane);
        if (value === null) return [];
        const column = txLaneColumn(lane);
        const rows = await tx.select({ key: column, id: customersTable.id })
          .from(customersTable)
          .where(and(eq(column, value), isNull(customersTable.archivedAt)));
        return rows
          .filter(row => row.key !== null)
          .map(row => ({ key: row.key as string, id: row.id }));
      });
      const txIdentityLane = laneResult(txLaneMaps.byIdentity.get(record.identityKey ?? "") ?? [], "identity");
      const txEmailLane = laneResult(
        record.normalizedEmail === null ? [] : txLaneMaps.byEmail.get(record.normalizedEmail) ?? [], "email",
      );
      const txPhoneLane = laneResult(
        record.normalizedPhone === null ? [] : txLaneMaps.byPhone.get(record.normalizedPhone) ?? [], "phone",
      );
      const txTargetRows = record.action === "REUSE" && record.expectedReservationCustomerId !== null
        ? await tx.select({
          id: customersTable.id,
          archivedAt: customersTable.archivedAt,
          identityKey: customersTable.identityKey,
        }).from(customersTable).where(eq(customersTable.id, record.expectedReservationCustomerId))
        : [];
      if (txTargetRows.length > 1) throw new ProjectionRollback("conflict", "Hedef musteri kimligi belirsiz");
      const txTarget = txTargetRows[0] ?? null;
      const revalidationState = {
        reservation,
        importStatus: historicalImport?.status ?? null,
        customerByIdentityKey: txIdentityLane.id,
        customerByEmail: txEmailLane.id,
        customerByPhone: txPhoneLane.id,
        laneConflict: txIdentityLane.conflict ?? txEmailLane.conflict ?? txPhoneLane.conflict,
        targetCustomer: txTarget ? { id: txTarget.id, archivedAt: txTarget.archivedAt, identityKey: txTarget.identityKey } : null,
      };
      const assessment = assessCustomerProjection({ record, state: revalidationState });
      if (assessment.classification === "ALREADY_LINKED") return "existing";
      // Phase 3H.4B1 — narrow CREATE→REUSE downgrade (see
      // resolveCreateReuseDowngrade): the concurrent/sequential loser finds
      // exactly one deterministic active customer under the held advisory
      // lock and links to it instead of reporting conflict. Every other
      // conflict still fails closed below.
      const downgradedReuseId = resolveCreateReuseDowngrade({
        record,
        state: revalidationState,
        classification: assessment.classification,
        reservationCustomerId: reservation.customerId,
      });
      if (downgradedReuseId === null) {
        if (assessment.classification === "CONFLICT_EXISTING_LINK"
          || assessment.classification === "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS"
          || assessment.classification === "CONFLICT_PHONE_EMAIL") {
          throw new ProjectionRollback("conflict", `Projection cakismasi: ${assessment.classification}`);
        }
        if (assessment.classification !== "SAFE_REUSE_EXISTING_CUSTOMER"
          && assessment.classification !== "SAFE_CREATE_NEW_CUSTOMER") {
          throw new ProjectionRollback("blocked", `Projection uygun degil: ${assessment.classification}`);
        }
      }

      let customerId = record.expectedReservationCustomerId;
      let created = false;
      if (downgradedReuseId !== null) {
        // Phase 3H.4B1 downgrade: link to the single deterministic active
        // customer proven above. Audits below record reused (not created);
        // the CAS link and outcome match the REUSE path exactly.
        customerId = downgradedReuseId;
      } else if (assessment.classification === "SAFE_CREATE_NEW_CUSTOMER") {
        if (record.identityKey === null) {
          throw new ProjectionRollback("blocked", "CREATE aksiyonu deterministik kimlik gerektirir");
        }
        const createKey: string = record.identityKey;
        // Re-check under the advisory lock: a concurrent projection may
        // have created the customer first — then reuse instead of double
        // create (second run of the same projection behaves identically).
        // Multiplicity is explicit: 0 creates, 1 reuses, >1 fails closed.
        const createLane = await tx.select({ id: customersTable.id })
          .from(customersTable)
          .where(and(eq(customersTable.identityKey, createKey), isNull(customersTable.archivedAt)));
        const createPick = pickLaneCandidate(createLane.map(row => row.id));
        if (createPick.multiple) {
          throw new ProjectionRollback("conflict", "Ayni kimlikte birden fazla aktif musteri var");
        }
        if (createPick.id !== null) {
          customerId = createPick.id;
        } else {
          const [inserted] = await tx.insert(customersTable).values({
            name: record.expectedLeadGuestName,
            phone: record.normalizedPhone,
            email: record.normalizedEmail,
            normalizedPhone: record.normalizedPhone,
            normalizedEmail: record.normalizedEmail,
            identityKey: record.identityKey,
          }).returning({ id: customersTable.id });
          if (!inserted) throw new Error("Musteri olusturulamadi");
          customerId = inserted.id;
          created = true;
        }
      } else {
        // SAFE_REUSE: assess already proved the target is the single
        // deterministic, active customer for this identity.
        customerId = record.expectedReservationCustomerId as number;
      }

      // CAS link: exactly one transition NULL -> customer + version bump.
      const [linked] = await tx.update(reservationsTable)
        .set({ customerId, version: sql`${reservationsTable.version} + 1` })
        .where(and(
          eq(reservationsTable.id, record.reservationId),
          isNull(reservationsTable.customerId),
          eq(reservationsTable.version, record.expectedReservationVersion),
        ))
        .returning({ id: reservationsTable.id, version: reservationsTable.version });
      if (!linked) throw new ProjectionRollback("conflict", "Rezervasyon link CAS kontrolu basarisiz");

      const identityKeyHash = sha256Hex(record.identityKey ?? "");
      const baseMetadata = {
        sourceKey: record.sourceKey,
        historicalImportId: record.historicalImportId,
        reservationId: record.reservationId,
        operationId: record.operationId,
        customerId,
        identityKeyHash,
        action: record.action,
        evidenceHash: record.identityEvidenceHash,
        oldReservationVersion: record.expectedReservationVersion,
        newReservationVersion: linked.version,
      };
      if (created) {
        await createAuditLog({
          eventType: "historical_customer_created",
          actorProfileId,
          module: "historical_migration",
          entityType: "customer",
          entityId: customerId as number,
          oldValue: null,
          newValue: { customerId, identityKeyHash },
          metadata: baseMetadata,
          description: "Historical projection ile deterministik musteri olusturuldu",
        }, tx);
      } else {
        await createAuditLog({
          eventType: "historical_customer_reused",
          actorProfileId,
          module: "historical_migration",
          entityType: "customer",
          entityId: customerId as number,
          oldValue: null,
          newValue: { customerId, identityKeyHash },
          metadata: baseMetadata,
          description: "Historical projection mevcut musteriyi yeniden kullandi",
        }, tx);
      }
      await createAuditLog({
        eventType: "historical_customer_linked",
        actorProfileId,
        module: "historical_migration",
        entityType: "reservation",
        entityId: record.reservationId,
        oldValue: { customerId: null },
        newValue: { customerId },
        metadata: baseMetadata,
        description: "Rezervasyon deterministik musteriye CAS ile baglandi",
      }, tx);
      return created ? "created" : "reused";
    });
  } catch (error) {
    if (error instanceof ProjectionRollback) return error.kind;
    return "failed";
  }
}

export async function applyCustomerProjection(records: CustomerProjectionRecord[], actorProfileId: number) {
  const outcomes: CustomerProjectionApplyOutcome[] = [];
  for (const record of records) {
    outcomes.push(await applyOne(record, actorProfileId));
  }
  return summarizeCustomerProjectionApply(outcomes);
}

export async function planCustomerProjection(records: CustomerProjectionRecord[]) {
  const { db, customersTable, historicalOperationImportsTable, reservationsTable } = await import("@workspace/db");
  const reservationRows = await db.select({
    id: reservationsTable.id,
    customerId: reservationsTable.customerId,
    version: reservationsTable.version,
    leadGuestName: reservationsTable.leadGuestName,
    sourceHistoricalKey: reservationsTable.sourceHistoricalKey,
  }).from(reservationsTable).where(inArray(
    reservationsTable.id,
    records.map(record => record.reservationId),
  ));
  const reservationById = new Map(reservationRows.map(row => [row.id, row]));
  const importRows = await db.select({
    sourceKey: historicalOperationImportsTable.sourceKey,
    status: historicalOperationImportsTable.status,
  }).from(historicalOperationImportsTable).where(inArray(
    historicalOperationImportsTable.sourceKey,
    records.map(record => record.sourceKey),
  ));
  const importByKey = new Map(importRows.map(row => [row.sourceKey, row.status]));
  // All three identity lanes are queried independently against ACTIVE
  // customers only; each lane resolves through pickLaneCandidate so a
  // multi-row lane fails closed instead of selecting a row.
  const laneColumn = (lane: IdentityLaneKind) =>
    lane === "identity" ? customersTable.identityKey
    : lane === "email" ? customersTable.normalizedEmail
    : customersTable.normalizedPhone;
  const laneValues = (lane: IdentityLaneKind): string[] => {
    const values = lane === "identity"
      ? records.map(record => record.identityKey)
      : lane === "email"
        ? records.map(record => record.normalizedEmail)
        : records.map(record => record.normalizedPhone);
    return [...new Set(values.filter((value): value is string => value !== null))];
  };
  const laneMaps = await queryIdentityLanes(async lane => {
    const values = laneValues(lane);
    if (values.length === 0) return [];
    const column = laneColumn(lane);
    const rows = await db.select({ key: column, id: customersTable.id })
      .from(customersTable)
      .where(and(inArray(column, values), isNull(customersTable.archivedAt)));
    return rows
      .filter(row => row.key !== null)
      .map(row => ({ key: row.key as string, id: row.id }));
  });
  const reuseTargets = records
    .filter(record => record.action === "REUSE" && record.expectedReservationCustomerId !== null)
    .map(record => record.expectedReservationCustomerId as number);
  const targetRows = reuseTargets.length === 0 ? [] : await db.select({
    id: customersTable.id,
    archivedAt: customersTable.archivedAt,
    identityKey: customersTable.identityKey,
  }).from(customersTable).where(inArray(customersTable.id, [...new Set(reuseTargets)]));
  const targetById = new Map(targetRows.map(row => [row.id, row]));
  const assessments = records.map(record => {
    const identityLane = record.identityKey === null
      ? { id: null as number | null, conflict: null as "identity" | null }
      : laneResult(laneMaps.byIdentity.get(record.identityKey) ?? [], "identity");
    const emailLane = record.normalizedEmail === null
      ? { id: null as number | null, conflict: null as "email" | null }
      : laneResult(laneMaps.byEmail.get(record.normalizedEmail) ?? [], "email");
    const phoneLane = record.normalizedPhone === null
      ? { id: null as number | null, conflict: null as "phone" | null }
      : laneResult(laneMaps.byPhone.get(record.normalizedPhone) ?? [], "phone");
    const laneConflict = identityLane.conflict ?? emailLane.conflict ?? phoneLane.conflict;
    const target = record.expectedReservationCustomerId === null
      ? null
      : targetById.get(record.expectedReservationCustomerId) ?? null;
    return assessCustomerProjection({
      record,
      state: {
        reservation: reservationById.get(record.reservationId) ?? null,
        importStatus: importByKey.get(record.sourceKey) ?? null,
        customerByIdentityKey: identityLane.id,
        customerByEmail: emailLane.id,
        customerByPhone: phoneLane.id,
        laneConflict,
        targetCustomer: target ? { id: target.id, archivedAt: target.archivedAt, identityKey: target.identityKey } : null,
      },
    });
  });
  const classifications: Record<string, number> = {};
  for (const assessment of assessments) {
    classifications[assessment.classification] = (classifications[assessment.classification] ?? 0) + 1;
  }
  return { classifications, assessments };
}

async function main() {
  const args = parseProductionCustomerProjectionArgs(process.argv.slice(2));
  const connectionString = validateProductionPickupTimeCorrectionTarget();
  const projectionPackage = parseCustomerProjectionPackage(JSON.parse(await readFile(resolve(args.inputPath), "utf8")));
  const records = selectedProjectionRecords(projectionPackage, args);
  process.env.DATABASE_URL = connectionString;
  const { pool } = await import("@workspace/db");
  try {
    if (!args.apply) {
      const plan = await planCustomerProjection(records);
      console.log(JSON.stringify({
        mode: "historical-customer-projection-production-plan",
        databaseWrites: false,
        operationWrites: false,
        customerWrites: false,
        reservationWrites: false,
        recordsInPackage: projectionPackage.records.length,
        inspected: records.length,
        ...plan,
        requiresApplyConfirmation: true,
      }, null, 2));
      return;
    }
    // APPLY needs the dedicated projection-link permission always, plus
    // the create permission whenever the batch can insert a customer.
    // Never the staging customer_link action nor the broad promote action.
    const { verifyOperatorPermission } = await import("./lib/historical-migration-operator");
    const link = await verifyOperatorPermission(
      args.operatorProfileId as number,
      "historical_migration",
      "customer_link_projection",
    );
    if (!link.ok) throw new Error(link.message);
    if (records.some(record => record.action === "CREATE")) {
      const create = await verifyOperatorPermission(
        args.operatorProfileId as number,
        "historical_migration",
        "customer_create",
      );
      if (!create.ok) throw new Error(create.message);
    }
    const summary = await applyCustomerProjection(records, args.operatorProfileId as number);
    console.log(JSON.stringify({
      mode: "historical-customer-projection-production-apply",
      ...customerProjectionWriteFlags(summary),
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
    console.error(error instanceof Error ? error.message : "Production customer projection basarisiz");
    process.exit(1);
  });
}
