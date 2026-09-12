import { z } from "zod";
import {
  buildCustomerIdentityKey,
  identityEvidenceHash,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  type IdentityEvidenceBinding,
} from "./customer-identity";

/**
 * Phase 3H.4B — deterministic customer projection package.
 *
 * Pure module: builds and validates the frozen projection artifact a future
 * Phase 3H.4C canary would execute, and classifies each record for PLAN and
 * for the transactional re-check under APPLY. Performs NO database access.
 */

export type CustomerProjectionAction = "REUSE" | "CREATE";

export type CustomerProjectionClassification =
  | "ALREADY_LINKED"
  | "SAFE_REUSE_EXISTING_CUSTOMER"
  | "SAFE_CREATE_NEW_CUSTOMER"
  | "CONFLICT_PHONE_EMAIL"
  | "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS"
  | "CONFLICT_EXISTING_LINK"
  | "INVALID_PHONE"
  | "INVALID_EMAIL"
  | "NAME_ONLY"
  | "MISSING_IDENTITY"
  | "STALE_EVIDENCE"
  | "SOURCE_MISMATCH"
  | "MANUAL_REVIEW";

const sourceKeySchema = z.string().regex(/^legacy:[^:]+:[^:]+:[1-9]\d*$/);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const projectionRecordSchema = z.object({
  sourceKey: sourceKeySchema,
  historicalImportId: z.number().int().positive(),
  reservationId: z.number().int().positive(),
  operationId: z.number().int().positive(),
  sourceFileId: z.string().min(1),
  worksheetName: z.string().min(1),
  sourceRow: z.number().int().positive(),
  normalizedPhone: z.string().nullable(),
  normalizedEmail: z.string().nullable(),
  identityKey: z.string().nullable(),
  identityEvidenceHash: sha256Schema,
  action: z.enum(["REUSE", "CREATE"]),
  expectedReservationCustomerId: z.number().int().positive().nullable(),
  expectedReservationVersion: z.number().int().min(1),
  expectedLeadGuestName: z.string().min(1),
}).strict().superRefine((record, context) => {
  const expectedKey = buildCustomerIdentityKey({ email: record.normalizedEmail, phone: record.normalizedPhone });
  if (expectedKey !== record.identityKey) {
    context.addIssue({ code: "custom", message: "identityKey normalized kimlikten deterministik turemiyor" });
  }
  if (record.action === "REUSE" && record.expectedReservationCustomerId === null) {
    context.addIssue({ code: "custom", message: "REUSE aksiyonu hedef musteri gerektirir" });
  }
  const recomputed = identityEvidenceHash({
    sourceKey: record.sourceKey,
    historicalImportId: record.historicalImportId,
    reservationId: record.reservationId,
    operationId: record.operationId,
    sourceFileId: record.sourceFileId,
    worksheetName: record.worksheetName,
    sourceRow: record.sourceRow,
    normalizedEmail: record.normalizedEmail,
    normalizedPhone: record.normalizedPhone,
    identityKey: record.identityKey,
    action: record.action,
  });
  if (recomputed !== record.identityEvidenceHash) {
    context.addIssue({ code: "custom", message: "identityEvidenceHash baglama degerleriyle uyusmuyor" });
  }
});

export type CustomerProjectionRecord = z.infer<typeof projectionRecordSchema>;

export const projectionPackageSchema = z.object({
  mode: z.literal("historical-customer-projection"),
  version: z.literal(1),
  kind: z.literal("historical-customer-projection"),
  generatedAt: z.string().min(1),
  databaseWrites: z.literal(false),
  records: z.array(projectionRecordSchema).min(1).max(5_000),
}).strict().superRefine((value, context) => {
  const sourceKeys = value.records.map(record => record.sourceKey);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    context.addIssue({ code: "custom", message: "Projection package tekrar eden sourceKey iceremez" });
  }
  const reservationIds = value.records.map(record => record.reservationId);
  if (new Set(reservationIds).size !== reservationIds.length) {
    context.addIssue({ code: "custom", message: "Projection package tekrar eden reservationId iceremez" });
  }
});

export type CustomerProjectionPackage = z.infer<typeof projectionPackageSchema>;

export function parseCustomerProjectionPackage(input: unknown): CustomerProjectionPackage {
  return projectionPackageSchema.parse(input);
}

export interface WorkbookEvidenceRow {
  sourceKey: string;
  sourceFileId: string;
  worksheetName: string;
  sourceRow: number;
  leadGuestName: string | null;
  emailRaw: string | null;
  phoneRaw: string | null;
}

export interface ReservationProjectionState {
  sourceKey: string;
  reservationId: number;
  operationId: number;
  leadGuestName: string;
  customerId: number | null;
  version: number;
  historicalImportId: number | null;
}

export interface GeneratorOutcome {
  record: CustomerProjectionRecord | null;
  classification: CustomerProjectionClassification;
  reason: string;
}

/**
 * Pure package generator: frozen workbook evidence + production PLAN state
 * (passed in, never fetched) -> deterministic per-reservation outcome.
 * Groups sharing one identityKey resolve to ONE action; multi-name phone
 * groups, dual-customer conflicts, name-only and missing identity never
 * become SAFE_*. Produces no DB writes.
 */
export function buildProjectionRecords(params: {
  evidence: WorkbookEvidenceRow[];
  reservations: ReservationProjectionState[];
  customerIdByIdentityKey: ReadonlyMap<string, number>;
  customerIdByEmail: ReadonlyMap<string, number>;
  customerIdByPhone: ReadonlyMap<string, number>;
}): GeneratorOutcome[] {
  const reservationByKey = new Map(params.reservations.map(r => [r.sourceKey, r]));
  const byIdentity = new Map<string, WorkbookEvidenceRow[]>();
  const outcomes: GeneratorOutcome[] = [];

  const classify = (row: WorkbookEvidenceRow): { identityKey: string | null; classification: CustomerProjectionClassification; reason: string } => {
    const email = normalizeCustomerEmail(row.emailRaw);
    const phone = normalizeCustomerPhone(row.phoneRaw);
    const emailRawPresent = (row.emailRaw ?? "").trim().length > 0;
    const phoneRawPresent = (row.phoneRaw ?? "").trim().length > 0;
    if (emailRawPresent && email === null) return { identityKey: null, classification: "INVALID_EMAIL", reason: "ham email normalize edilemedi" };
    if (phoneRawPresent && phone === null) return { identityKey: null, classification: "INVALID_PHONE", reason: "ham telefon normalize edilemedi" };
    const identityKey = buildCustomerIdentityKey({ email, phone });
    if (identityKey === null) {
      const hasName = (row.leadGuestName ?? "").trim().length > 0;
      return { identityKey, classification: hasName ? "NAME_ONLY" : "MISSING_IDENTITY", reason: hasName ? "yalnizca isim kimligi var" : "hic kimlik kaniti yok" };
    }
    return { identityKey, classification: "MANUAL_REVIEW", reason: "grup cozumu bekleniyor" };
  };

  const preclassified = params.evidence.map(row => ({ row, ...classify(row) }));
  for (const entry of preclassified) {
    if (entry.identityKey !== null) {
      const group = byIdentity.get(entry.identityKey) ?? [];
      group.push(entry.row);
      byIdentity.set(entry.identityKey, group);
    }
  }

  const normName = (v: string | null) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ") || null;

  const finish = (
    row: WorkbookEvidenceRow,
    identityKey: string,
    state: ReservationProjectionState | undefined,
  ): GeneratorOutcome => {
    if (!state) return { record: null, classification: "SOURCE_MISMATCH", reason: "uretim rezervasyonu bulunamadi" };
    if (state.historicalImportId === null) {
      return { record: null, classification: "SOURCE_MISMATCH", reason: "historical import baglantisi yok" };
    }
    if (state.customerId !== null) {
      return { record: null, classification: "CONFLICT_EXISTING_LINK", reason: "rezervasyon zaten bagli" };
    }
    const group = byIdentity.get(identityKey) ?? [];
    const names = new Set(group.map(g => normName(g.leadGuestName)).filter((n): n is string => n !== null));
    if (names.size > 1) {
      return { record: null, classification: "MANUAL_REVIEW", reason: "ayni kimlikte birden fazla isim" };
    }
    const emailId = state && row.emailRaw ? params.customerIdByEmail.get(normalizeCustomerEmail(row.emailRaw) as string) ?? null : null;
    const phoneId = state && row.phoneRaw ? params.customerIdByPhone.get(normalizeCustomerPhone(row.phoneRaw) as string) ?? null : null;
    if (emailId !== null && phoneId !== null && emailId !== phoneId) {
      return { record: null, classification: "CONFLICT_PHONE_EMAIL", reason: "email ve telefon farkli musterilere cozuluyor" };
    }
    const keyedId = params.customerIdByIdentityKey.get(identityKey) ?? null;
    const resolved = [emailId, phoneId, keyedId].filter((id): id is number => id !== null);
    if (new Set(resolved).size > 1) {
      return { record: null, classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS", reason: "kimlik birden fazla musteriye cozuluyor" };
    }
    const target = resolved[0] ?? null;
    const action: CustomerProjectionAction = target === null ? "CREATE" : "REUSE";
    const binding: IdentityEvidenceBinding = {
      sourceKey: row.sourceKey,
      historicalImportId: state.historicalImportId,
      reservationId: state.reservationId,
      operationId: state.operationId,
      sourceFileId: row.sourceFileId,
      worksheetName: row.worksheetName,
      sourceRow: row.sourceRow,
      normalizedEmail: normalizeCustomerEmail(row.emailRaw),
      normalizedPhone: normalizeCustomerPhone(row.phoneRaw),
      identityKey,
      action,
    };
    const record: CustomerProjectionRecord = {
      ...binding,
      identityEvidenceHash: identityEvidenceHash(binding),
      expectedReservationCustomerId: action === "REUSE" ? target : null,
      expectedReservationVersion: state.version,
      expectedLeadGuestName: state.leadGuestName,
    };
    const parsed = projectionRecordSchema.safeParse(record);
    if (!parsed.success) {
      return { record: null, classification: "MANUAL_REVIEW", reason: "uretilen kayit sema dogrulamayi gecemedi" };
    }
    return {
      record: parsed.data,
      classification: action === "REUSE" ? "SAFE_REUSE_EXISTING_CUSTOMER" : "SAFE_CREATE_NEW_CUSTOMER",
      reason: action === "REUSE" ? `musteri ${target} deterministik eslesti` : "yeni musteri icin yeterli deterministik kimlik",
    };
  };

  for (const entry of preclassified) {
    if (entry.identityKey === null) {
      outcomes.push({ record: null, classification: entry.classification, reason: entry.reason });
      continue;
    }
    outcomes.push(finish(entry.row, entry.identityKey, reservationByKey.get(entry.row.sourceKey)));
  }
  return outcomes;
}

export interface ProjectionPlanState {
  classification: CustomerProjectionClassification;
  sourceKey: string;
  reservationId: number | null;
  customerId: number | null;
  identityKey: string | null;
  action: CustomerProjectionAction | null;
  evidenceHash: string | null;
}

export interface ProjectionDbState {
  reservation: {
    id: number;
    customerId: number | null;
    version: number;
    leadGuestName: string;
    sourceHistoricalKey: string | null;
  } | null;
  importStatus: string | null;
  customerByIdentityKey: number | null;
  customerByEmail: number | null;
  customerByPhone: number | null;
  // Set when a lane matches MORE THAN ONE active customer. A single id in
  // the scalar lane fields above is only ever assigned when the lane
  // matched exactly one row (see pickLaneCandidate); multiplicity itself
  // always fails closed, never silently selects the first row.
  laneConflict: "identity" | "email" | "phone" | null;
  targetCustomer: { id: number; archivedAt: Date | null; identityKey: string | null } | null;
}

/**
 * Pure decision table shared by PLAN and the transactional APPLY re-check.
 *
 * Ordering is deliberate for replay safety: an already-linked reservation
 * is classified ALREADY_LINKED only when every invariant proves the link
 * is exactly this projection record's result (same customer, version
 * exactly expected+1, lanes agreeing, no multiplicity, evidence intact).
 * The version check therefore lives INSIDE the linked branch rather than
 * ahead of it, so a faithful replay resolves to `existing` while any
 * drift (wrong customer, version beyond +1, lane/identity change) fails
 * closed. Nothing uncertain resolves to SAFE_*.
 */
export function assessCustomerProjection(params: {
  record: CustomerProjectionRecord;
  state: ProjectionDbState;
}): ProjectionPlanState {
  const base = {
    sourceKey: params.record.sourceKey,
    reservationId: params.record.reservationId,
    customerId: params.record.expectedReservationCustomerId,
    identityKey: params.record.identityKey,
    action: params.record.action,
    evidenceHash: params.record.identityEvidenceHash,
  };
  const reservation = params.state.reservation;
  if (reservation === null || reservation.id !== params.record.reservationId) {
    return { ...base, classification: "SOURCE_MISMATCH" };
  }
  if (reservation.sourceHistoricalKey !== params.record.sourceKey) {
    return { ...base, classification: "SOURCE_MISMATCH" };
  }
  if (params.state.importStatus !== "imported") {
    return { ...base, classification: "SOURCE_MISMATCH" };
  }
  const recomputed = identityEvidenceHash({
    sourceKey: params.record.sourceKey,
    historicalImportId: params.record.historicalImportId,
    reservationId: params.record.reservationId,
    operationId: params.record.operationId,
    sourceFileId: params.record.sourceFileId,
    worksheetName: params.record.worksheetName,
    sourceRow: params.record.sourceRow,
    normalizedEmail: params.record.normalizedEmail,
    normalizedPhone: params.record.normalizedPhone,
    identityKey: params.record.identityKey,
    action: params.record.action,
  });
  if (recomputed !== params.record.identityEvidenceHash) {
    return { ...base, classification: "STALE_EVIDENCE" };
  }
  if (reservation.leadGuestName !== params.record.expectedLeadGuestName) {
    return { ...base, classification: "STALE_EVIDENCE" };
  }

  const laneIds = [params.state.customerByEmail, params.state.customerByPhone, params.state.customerByIdentityKey]
    .filter((id): id is number => id !== null);

  // ── Linked branch: prove the existing link IS this record's result. ──
  if (reservation.customerId !== null) {
    if (params.state.laneConflict !== null) {
      return { ...base, classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS" };
    }
    if (params.record.action === "REUSE") {
      const target = params.state.targetCustomer;
      if (reservation.customerId !== params.record.expectedReservationCustomerId) {
        return { ...base, classification: "CONFLICT_EXISTING_LINK" };
      }
      if (target === null || target.id !== reservation.customerId) {
        return { ...base, classification: "CONFLICT_EXISTING_LINK" };
      }
      if (target.archivedAt !== null) {
        return { ...base, classification: "MANUAL_REVIEW" };
      }
      if (target.identityKey !== params.record.identityKey) {
        return { ...base, classification: "STALE_EVIDENCE" };
      }
    } else if (params.state.customerByIdentityKey !== reservation.customerId) {
      // CREATE replay: the linked customer must be exactly the
      // deterministic identity-lane resolution, proving no duplicate was
      // created instead.
      return { ...base, classification: "CONFLICT_EXISTING_LINK" };
    }
    if (reservation.version !== params.record.expectedReservationVersion + 1) {
      return { ...base, classification: "STALE_EVIDENCE" };
    }
    if (laneIds.length > 0 && !laneIds.every(id => id === reservation.customerId)) {
      return { ...base, classification: "CONFLICT_PHONE_EMAIL" };
    }
    return { ...base, classification: "ALREADY_LINKED" };
  }

  // ── Unlinked branch: version must be exactly the frozen expectation. ──
  if (reservation.version !== params.record.expectedReservationVersion) {
    return { ...base, classification: "STALE_EVIDENCE" };
  }
  if (params.state.laneConflict !== null) {
    return { ...base, classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS" };
  }
  if (new Set(laneIds).size > 1) {
    return { ...base, classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS" };
  }
  if (params.record.action === "REUSE") {
    const target = params.record.expectedReservationCustomerId;
    if (target === null || params.state.targetCustomer === null || params.state.targetCustomer.id !== target) {
      return { ...base, classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS" };
    }
    if (params.state.targetCustomer.archivedAt !== null) {
      return { ...base, classification: "MANUAL_REVIEW" };
    }
    if (laneIds.length > 0 && !laneIds.includes(target)) {
      return { ...base, classification: "CONFLICT_PHONE_EMAIL" };
    }
    return { ...base, classification: "SAFE_REUSE_EXISTING_CUSTOMER" };
  }
  if (laneIds.length > 0) {
    return { ...base, classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS" };
  }
  return { ...base, classification: "SAFE_CREATE_NEW_CUSTOMER" };
}
