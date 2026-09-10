import { partyPax, summarizePax } from "./operation-detail-model";

/**
 * Pure composition for the Daily Operations Center. Reuses partyPax /
 * summarizePax from operation-detail-model.ts rather than recomputing PAX a
 * second way - Operation Detail (Phase 1C) and the daily board must never
 * be able to disagree on what a total means.
 *
 * Deliberately leaner than composeReservations(): the daily board is an
 * overview, not deep inspection, so Guests, financial fields, and long-form
 * itinerary/ship-schedule text are never fetched or returned here. Operation
 * Detail remains the place for that.
 */

export interface DailyBookingPartyInput {
  adultCount: number | null;
  childCount: number | null;
  passengerLanguage: string | null;
  pickupPoint: string | null;
  externalSource: string | null;
  externalOperator: string | null;
  specialRequirements: string | null;
}

export interface DailyReservationInput {
  id: number;
  leadGuestName: string;
  status: string;
  sourceType: string | null;
  sourceBookingReference: string | null;
  reservationType: string | null;
  bookingParty: DailyBookingPartyInput | null;
}

/**
 * One row per Operation, already flattened: guideName/driverName/vehiclePlate
 * are the SAME resolved value OperationDomainWorkspace.tsx (Phase 1C) shows
 * (operation's own text field first, falling back to the linked resource),
 * resolved once in daily-operations-read.ts rather than duplicated here.
 */
export interface DailyOperationInput {
  id: number;
  operationType: "CRUISE" | "SEJOUR" | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  pickupTime: string | null;
  notes: string | null;
  tourName: string | null;
  programName: string | null;
  programCode: string | null;
  shipName: string | null;
  cruiseLine: string | null;
  portName: string | null;
  arrivalTime: string | null;
  departureTime: string | null;
  guideName: string | null;
  guidePhone: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  vehicleType: string | null;
  vehicleCapacity: number | null;
}

export type DailyWarning =
  | "missing_guide"
  | "missing_vehicle"
  | "missing_pickup_time"
  | "missing_pickup_point"
  | "incomplete_pax"
  | "no_reservations"
  | "legacy_only"
  | "vehicle_capacity_exceeded";

/**
 * Deterministic "TUR 1 / TUR 2 / ..." display order: pickupTime ascending
 * ("HH:MM" text sorts correctly lexicographically), operations with no
 * recorded pickup time sort last, ties broken by the operation's own id.
 * `sequence` (assigned by the caller, 1-based, after this sort) is a DISPLAY
 * position only - recomputed fresh on every read, never persisted, never
 * limiting how many Operations/Reservations/Guests can exist, and never
 * mutating source data.
 */
function sortForDisplay<T extends { pickupTime: string | null; id: number }>(operations: T[]): T[] {
  return [...operations].sort((a, b) => {
    const aTime = a.pickupTime ?? "99:99";
    const bTime = b.pickupTime ?? "99:99";
    if (aTime !== bTime) return aTime < bTime ? -1 : 1;
    return a.id - b.id;
  });
}

/**
 * Deterministic, non-noisy warnings only - each fires on one concrete,
 * operationally meaningful condition. No AI-generated or heuristic warnings.
 */
function computeWarnings(
  op: DailyOperationInput,
  reservations: { bookingParty: DailyBookingPartyInput | null }[],
  summary: ReturnType<typeof summarizePax>,
  isLegacyOnly: boolean,
): DailyWarning[] {
  const warnings: DailyWarning[] = [];
  if (!op.guideName) warnings.push("missing_guide");
  if (!op.vehiclePlate) warnings.push("missing_vehicle");
  if (!op.pickupTime) warnings.push("missing_pickup_time");
  if (summary.incompleteReservationCount > 0) warnings.push("incomplete_pax");
  if (reservations.length > 0 && reservations.some(r => !r.bookingParty?.pickupPoint)) {
    warnings.push("missing_pickup_point");
  }
  if (reservations.length === 0) warnings.push(isLegacyOnly ? "legacy_only" : "no_reservations");
  // Only computed when BOTH sides are trusted, known values - never a guess.
  if (op.vehicleCapacity != null && summary.totalPax != null && summary.totalPax > op.vehicleCapacity) {
    warnings.push("vehicle_capacity_exceeded");
  }
  return warnings;
}

export function buildDailyBoard(params: {
  date: string;
  operations: DailyOperationInput[];
  reservationsByOperationId: Map<number, DailyReservationInput[]>;
  legacyOperationIds: Set<number>;
}) {
  const ordered = sortForDisplay(params.operations);

  const operations = ordered.map((op, index) => {
    const rawReservations = params.reservationsByOperationId.get(op.id) ?? [];
    // Reservation != Operation: every reservation the operation actually has
    // is kept as its own entry - never merged, never deduped, never capped.
    const reservations = rawReservations.map(r => ({ ...r, totalPax: partyPax(r.bookingParty) }));
    const summary = summarizePax(reservations.map(r => r.totalPax));
    const isLegacyOnly = reservations.length === 0 && params.legacyOperationIds.has(op.id);
    const warnings = computeWarnings(op, reservations, summary, isLegacyOnly);

    return {
      sequence: index + 1,
      operation: {
        id: op.id,
        operationType: op.operationType,
        status: op.status,
        startDate: op.startDate,
        endDate: op.endDate,
        pickupTime: op.pickupTime,
        notes: op.notes,
      },
      context: {
        tourName: op.tourName,
        programName: op.programName,
        programCode: op.programCode,
        shipName: op.shipName,
        cruiseLine: op.cruiseLine,
        portName: op.portName,
        arrivalTime: op.arrivalTime,
        departureTime: op.departureTime,
      },
      resources: {
        guideName: op.guideName,
        guidePhone: op.guidePhone,
        driverName: op.driverName,
        driverPhone: op.driverPhone,
        vehiclePlate: op.vehiclePlate,
        vehicleType: op.vehicleType,
        vehicleCapacity: op.vehicleCapacity,
      },
      summary,
      reservations: reservations.map(r => ({
        id: r.id,
        leadGuestName: r.leadGuestName,
        status: r.status,
        sourceType: r.sourceType,
        sourceBookingReference: r.sourceBookingReference,
        reservationType: r.reservationType,
        adultCount: r.bookingParty?.adultCount ?? null,
        childCount: r.bookingParty?.childCount ?? null,
        totalPax: r.totalPax,
        passengerLanguage: r.bookingParty?.passengerLanguage ?? null,
        pickupPoint: r.bookingParty?.pickupPoint ?? null,
        externalSource: r.bookingParty?.externalSource ?? null,
        externalOperator: r.bookingParty?.externalOperator ?? null,
        specialRequirements: r.bookingParty?.specialRequirements ?? null,
      })),
      // A legacy operation_reservation_details row may still exist (Phase 1C
      // read-only projection) even though it never counts toward
      // reservationCount/totalPax above - flagged so the UI can label it
      // clearly instead of silently mixing it into the Reservation domain.
      legacy: isLegacyOnly,
      warnings,
    };
  });

  const knownPax = operations
    .map(o => o.summary.totalPax)
    .filter((p): p is number => p != null);

  return {
    date: params.date,
    summary: {
      operationCount: operations.length,
      reservationCount: operations.reduce((sum, o) => sum + o.summary.reservationCount, 0),
      // Sum of only the operations whose PAX is fully known - an operation
      // with any incomplete Reservation contributes nothing here rather than
      // an under-count being mistaken for a complete one.
      knownTotalPax: knownPax.reduce((sum, p) => sum + p, 0),
      incompleteOperationPaxCount: operations.filter(o => o.summary.incompleteReservationCount > 0).length,
      missingGuideCount: operations.filter(o => o.warnings.includes("missing_guide")).length,
      missingVehicleCount: operations.filter(o => o.warnings.includes("missing_vehicle")).length,
    },
    operations,
  };
}
