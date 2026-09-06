import { z } from "zod/v4";

/**
 * Safe-edit surface for the Reservation Management Workspace (Phase 2A).
 *
 * Deliberately narrow. Everything NOT listed here — provenance/source ids
 * (sourceEmailImportId, sourceSheetImportId, sourceHistoricalKey,
 * sourceType), audit fields, customerId (no free-form customer reassignment
 * here — that is a distinct, unbuilt feature), tourOperationId (operation
 * association changes require the human-approval flow this phase
 * explicitly does not build — see OPERATION_ASSOCIATION_BEHAVIOR in the
 * final report), and every Guest row — is read-only through this endpoint.
 *
 * `pickupTime` was on the brief's candidate BookingParty field list, but
 * lives only on `operations.pickupTime` in the actual schema (booking_parties
 * has no pickup_time column — see lib/db/src/schema/reservations.ts /
 * operations.ts). Rather than invent a schema change to add one, this is
 * left read-only here; it is already editable through the existing
 * Operation edit path (routes/operations.ts PATCH /:id), and duplicating it
 * onto BookingParty would create two sources of truth for one physical
 * pickup time. Likewise `tourType` exists only on the legacy
 * operation_reservation_details table, not on booking_parties (which has
 * itineraryRaw/tourCodeRaw instead) — itineraryRaw is exposed here as the
 * closest real equivalent.
 */
export const reservationEditSchema = z.object({
  status: z.enum(["new", "confirmed", "completed", "canceled", "rebooked", "no_show"]).optional(),
  leadGuestName: z.string().trim().min(1).max(200).optional(),
  sourceBookingReference: z.string().trim().max(200).nullable().optional(),
}).strict();

export const bookingPartyEditSchema = z.object({
  adultCount: z.number().int().min(0).nullable().optional(),
  childCount: z.number().int().min(0).nullable().optional(),
  passengerLanguage: z.string().trim().max(100).nullable().optional(),
  pickupPoint: z.string().trim().max(300).nullable().optional(),
  itineraryRaw: z.string().trim().max(500).nullable().optional(),
}).strict();

export const reservationRecordEditSchema = z.object({
  reservation: reservationEditSchema.optional(),
  bookingParty: bookingPartyEditSchema.optional(),
}).strict();

export type ReservationRecordEdit = z.infer<typeof reservationRecordEditSchema>;

/**
 * Explicit reservation-status transition graph. Nothing in the schema
 * defines one today (the CHECK constraint only enumerates valid values —
 * see reservations_status_check), so this is Phase 2A's own addition,
 * applied only in application code, never as a DB constraint (a stricter
 * DB-level transition constraint would be a schema change requiring
 * separate approval per Section 14).
 *
 * Deliberately conservative: 'rebooked' is settable as a plain status flag
 * (matching what the schema already allows — rebookedIntoReservationId may
 * be null even when status = 'rebooked'), but this phase does NOT implement
 * creating the linked replacement reservation that a full rebooking flow
 * would need — that is out of scope here, same as automatic operation
 * matching. Operation status is never read or written by this function —
 * see OPERATION_ASSOCIATION_BEHAVIOR / the independence rule in the brief.
 */
const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  new: new Set(["confirmed", "canceled"]),
  confirmed: new Set(["completed", "canceled", "no_show", "rebooked"]),
  completed: new Set([]),
  canceled: new Set([]),
  no_show: new Set([]),
  rebooked: new Set([]),
};

export function canTransitionReservationStatus(from: string, to: string): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

/** Field-name diff only — never logs raw before/after values (Section 12: no unnecessary sensitive payloads in audit). */
export function diffChangedFields<T extends Record<string, unknown>>(before: T, patch: Partial<T>): string[] {
  return Object.keys(patch).filter(key => patch[key] !== undefined && patch[key] !== before[key]);
}
