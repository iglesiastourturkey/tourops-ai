import { createHash } from "node:crypto";
import type { HistoricalStagingRecord } from "./historical-migration-stage-validation";

/**
 * Faz 3D-A: pure mapping/hashing/state-machine logic for promoting an
 * approved historical_operation_imports row into a real operation.
 *
 * Deliberately self-contained (does not import from
 * historical-migration-stage-validation.ts beyond the payload type, and does
 * not modify that file) so Phase 3C's already-verified staging behaviour is
 * untouched. Contains no DB access - see historical-migration-promote.ts for
 * the transactional side that uses these functions.
 */

// ── State machine ────────────────────────────────────────────────────────────

export type HistoricalImportStatus = "pending" | "approved" | "rejected" | "imported";
export type HistoricalImportAction = "approve" | "reject" | "promote";

const ALLOWED_FROM: Record<HistoricalImportAction, ReadonlySet<HistoricalImportStatus>> = {
  approve: new Set(["pending"]),
  reject: new Set(["pending"]),
  // First promotion requires approved. Imported is also allowed only so an
  // explicitly targeted replay can reach the existing-operation projection
  // comparison: identical content becomes an idempotent existing/no-op,
  // while changed content fails closed as a conflict. Pending/rejected remain
  // blocked and can never enter the promotion path.
  promote: new Set(["approved", "imported"]),
};

const STATUS_BLOCK_MESSAGE: Record<HistoricalImportStatus, string> = {
  pending: "Kayit henuz onaylanmadi.",
  approved: "Kayit zaten onaylanmis.",
  rejected: "Reddedilen kayit uzerinde bu islem yapilamaz.",
  imported: "Kayit zaten operasyona donusturulmus.",
};

/**
 * Turkish reason `action` is not allowed from `status`, or null when allowed.
 * Mirrors transitionBlock() in routes/reservations.ts - same shape, applied
 * to historical_operation_imports.status instead of reservation import
 * status. No reopen action exists yet (rejected -> pending is deliberately
 * not implemented in Faz 3D-A; see docs/HISTORICAL_MIGRATION_PHASE3D.md).
 */
export function historicalImportTransitionBlock(
  action: HistoricalImportAction,
  status: string,
): string | null {
  if (ALLOWED_FROM[action].has(status as HistoricalImportStatus)) return null;
  return STATUS_BLOCK_MESSAGE[status as HistoricalImportStatus]
    ?? `Kayit "${status}" durumundayken bu islem yapilamaz.`;
}

// ── Canonical JSON + SHA-256 ─────────────────────────────────────────────────
// Same algorithm as historical-migration-stage-validation.ts's canonicalJson
// (sorted object keys, JSON.stringify for scalars/arrays), duplicated
// deliberately rather than imported: Phase 3C's file is not touched by this
// phase, and both copies must independently produce the same digest for the
// same input for the payload-integrity check below to mean anything.
function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Deger canonical JSON'a cevrilemedi");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function sha256OfCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Recomputes the Phase 3C payload hash and compares it against the stored
 * payload_sha256. If a staged row's payload was ever modified after Phase 3C
 * (which nothing in this codebase does, but the DB does not prevent it),
 * promotion must fail closed rather than promote content nobody reviewed.
 */
export function verifyStagedPayloadIntegrity(row: { payload: unknown; payloadSha256: string }): boolean {
  return sha256OfCanonicalJson(row.payload) === row.payloadSha256;
}

// ── Canonical promotion projection ───────────────────────────────────────────
// Contains ONLY fields Phase 1B.2 writes to `operations`, `reservations`, and
// `booking_parties` (verified against their Drizzle schemas). Every master-data FK
// and customerId is a literal `null` here, not merely defaulted - so the
// projection changes, and promotion correctly conflicts, if a later phase
// ever starts writing one of them for the same sourceHistoricalKey outside
// this code path.

// FK/financial fields are typed `number | null` / `string | null` rather than
// a literal `null`, even though every value Phase 3D-A itself ever writes
// into them is null: buildPromotionProjectionFromExisting below must be able
// to carry through whatever an existing row actually contains, so that if
// something outside this code path ever set one of them, the reconstructed
// hash differs from the target hash and promotion reports a conflict instead
// of silently normalizing the difference away.
export interface PromotionOperationProjection {
  sourceHistoricalKey: string;
  sourceType: string;
  sourceBookingReference: string | null;
  startDate: string | null;
  endDate: string | null;
  pickupTime: string | null;
  notes: string | null;
  customerId: number | null;
  tourId: number | null;
  portCallId: number | null;
  tourProductId: number | null;
  guideResourceId: number | null;
  driverResourceId: number | null;
  vehicleId: number | null;
}

export interface PromotionReservationProjection {
  customerId: number | null;
  leadGuestName: string;
  reservationType: string | null;
  status: "new";
  sourceType: string;
  sourceHistoricalKey: string;
  sourceBookingReference: string | null;
}

export interface PromotionBookingPartyProjection {
  adultCount: number | null;
  childCount: number | null;
  passengerLanguage: string | null;
  tourType: string | null;
  itineraryRaw: string | null;
  pickupPoint: string | null;
  externalSource: string | null;
  externalOperator: string | null;
  collectionStatusRaw: string | null;
  netAmount: number | null;
  advanceAmount: number | null;
  currency: string | null;
}

export interface PromotionProjection {
  operation: PromotionOperationProjection;
  reservation: PromotionReservationProjection;
  bookingParty: PromotionBookingPartyProjection;
}

/** Builds the target projection from an approved staging row's payload. */
export function buildPromotionProjectionFromStaging(
  sourceKey: string,
  payload: HistoricalStagingRecord,
): PromotionProjection {
  return {
    operation: {
      sourceHistoricalKey: sourceKey,
      sourceType: payload.operation.sourceType,
      sourceBookingReference: payload.operation.sourceBookingReference,
      startDate: payload.operation.startDate,
      endDate: payload.operation.endDate,
      pickupTime: payload.operation.pickupTime,
      notes: payload.operation.notes,
      customerId: null,
      tourId: null,
      portCallId: null,
      tourProductId: null,
      guideResourceId: null,
      driverResourceId: null,
      vehicleId: null,
    },
    reservation: {
      customerId: null,
      leadGuestName: payload.customer.fullName,
      reservationType: payload.reservationDetails.tourType,
      status: "new",
      sourceType: payload.operation.sourceType,
      sourceHistoricalKey: sourceKey,
      sourceBookingReference: payload.operation.sourceBookingReference,
    },
    bookingParty: {
      adultCount: payload.reservationDetails.adultCount,
      childCount: payload.reservationDetails.childCount,
      passengerLanguage: payload.reservationDetails.passengerLanguage,
      tourType: payload.reservationDetails.tourType,
      itineraryRaw: payload.reservationDetails.itineraryRaw,
      pickupPoint: payload.reservationDetails.pickupPoint,
      externalSource: payload.reservationDetails.externalSource,
      externalOperator: payload.reservationDetails.externalOperator,
      collectionStatusRaw: payload.reservationDetails.collectionStatusRaw,
      netAmount: null,
      advanceAmount: null,
      currency: null,
    },
  };
}

/** Minimal shape of an existing operations row, as read back for comparison. */
export interface ExistingOperationRow {
  sourceHistoricalKey: string | null;
  sourceType: string;
  sourceBookingReference: string | null;
  startDate: string | null;
  endDate: string | null;
  pickupTime: string | null;
  notes: string | null;
  customerId: number | null;
  tourId: number | null;
  portCallId: number | null;
  tourProductId: number | null;
  guideResourceId: number | null;
  driverResourceId: number | null;
  vehicleId: number | null;
}

/** Minimal shape of an existing Reservation row. */
export interface ExistingReservationRow {
  customerId: number | null;
  leadGuestName: string;
  reservationType: string | null;
  status: string;
  sourceType: string | null;
  sourceHistoricalKey: string | null;
  sourceBookingReference: string | null;
}

export interface ExistingBookingPartyRow {
  adultCount: number | null;
  childCount: number | null;
  passengerLanguage: string | null;
  // Present only for the legacy operation_reservation_details compatibility
  // reader; booking_parties stores this on Reservation instead.
  tourType?: string | null;
  itineraryRaw: string | null;
  pickupPoint: string | null;
  externalSource: string | null;
  externalOperator: string | null;
  collectionStatusRaw: string | null;
  netAmount: number | string | null;
  advanceAmount: number | string | null;
  currency: string | null;
}

/**
 * Reconstructs the same-shaped projection from an already-promoted operation
 * (+ its Reservation and BookingParty) so it can be hashed and
 * compared against the target projection on an idempotent replay.
 */
export function buildPromotionProjectionFromExisting(
  operation: ExistingOperationRow,
  reservation: ExistingReservationRow,
  bookingParty: ExistingBookingPartyRow | null,
): PromotionProjection {
  if (!operation.sourceHistoricalKey) {
    throw new Error("Var olan operasyon sourceHistoricalKey icermiyor, projeksiyon olusturulamaz");
  }
  return {
    operation: {
      sourceHistoricalKey: operation.sourceHistoricalKey,
      sourceType: operation.sourceType,
      sourceBookingReference: operation.sourceBookingReference,
      startDate: operation.startDate,
      endDate: operation.endDate,
      pickupTime: operation.pickupTime,
      notes: operation.notes,
      customerId: operation.customerId,
      tourId: operation.tourId,
      portCallId: operation.portCallId,
      tourProductId: operation.tourProductId,
      guideResourceId: operation.guideResourceId,
      driverResourceId: operation.driverResourceId,
      vehicleId: operation.vehicleId,
    },
    reservation: {
      customerId: reservation.customerId,
      leadGuestName: reservation.leadGuestName,
      reservationType: reservation.reservationType,
      status: reservation.status as "new",
      sourceType: reservation.sourceType ?? "",
      sourceHistoricalKey: reservation.sourceHistoricalKey ?? "",
      sourceBookingReference: reservation.sourceBookingReference,
    },
    bookingParty: {
      adultCount: bookingParty?.adultCount ?? null,
      childCount: bookingParty?.childCount ?? null,
      passengerLanguage: bookingParty?.passengerLanguage ?? null,
      tourType: reservation.reservationType,
      itineraryRaw: bookingParty?.itineraryRaw ?? null,
      pickupPoint: bookingParty?.pickupPoint ?? null,
      externalSource: bookingParty?.externalSource ?? null,
      externalOperator: bookingParty?.externalOperator ?? null,
      collectionStatusRaw: bookingParty?.collectionStatusRaw ?? null,
      netAmount: bookingParty?.netAmount === null || bookingParty?.netAmount === undefined ? null : Number(bookingParty.netAmount),
      advanceAmount: bookingParty?.advanceAmount === null || bookingParty?.advanceAmount === undefined ? null : Number(bookingParty.advanceAmount),
      currency: bookingParty?.currency ?? null,
    },
  };
}

/**
 * Read-only replay compatibility for a record promoted before Phase 1B.2.
 * It deliberately does not backfill a Reservation or write the legacy table;
 * it only preserves the prior Operation + details hash decision on an
 * explicit replay while the historical rows remain in place.
 */
export function buildPromotionProjectionFromLegacy(
  operation: ExistingOperationRow,
  details: ExistingBookingPartyRow | null,
  reservation: PromotionReservationProjection,
): PromotionProjection {
  return buildPromotionProjectionFromExisting(operation, {
    ...reservation,
    reservationType: details?.tourType ?? null,
  }, {
    adultCount: details?.adultCount ?? null,
    childCount: details?.childCount ?? null,
    passengerLanguage: details?.passengerLanguage ?? null,
    itineraryRaw: details?.itineraryRaw ?? null,
    pickupPoint: details?.pickupPoint ?? null,
    externalSource: details?.externalSource ?? null,
    externalOperator: details?.externalOperator ?? null,
    collectionStatusRaw: details?.collectionStatusRaw ?? null,
    netAmount: details?.netAmount ?? null,
    advanceAmount: details?.advanceAmount ?? null,
    currency: details?.currency ?? null,
  });
}

export function sha256OfProjection(projection: PromotionProjection): string {
  return sha256OfCanonicalJson(projection);
}

export type PromotionOutcome = "inserted" | "existing" | "conflict";

/**
 * Compares a freshly built target projection against an existing operation's
 * reconstructed projection (or its absence) and decides the Case 1/2/3
 * outcome from requirement D of the Phase 3D architecture report. Pure
 * decision function - callers perform the actual reads/writes.
 */
export function decidePromotionOutcome(
  target: PromotionProjection,
  existing: PromotionProjection | null,
): { outcome: PromotionOutcome; targetHash: string; existingHash: string | null } {
  const targetHash = sha256OfProjection(target);
  if (!existing) return { outcome: "inserted", targetHash, existingHash: null };
  const existingHash = sha256OfProjection(existing);
  return { outcome: existingHash === targetHash ? "existing" : "conflict", targetHash, existingHash };
}
