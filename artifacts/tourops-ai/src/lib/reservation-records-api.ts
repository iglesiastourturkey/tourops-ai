import { customFetch } from '@workspace/api-client-react';

/**
 * Client for the Reservation Management Workspace (Phase 2A) —
 * GET/PATCH /api/reservation-records. Distinct from '@/lib/reservation-api',
 * which talks to the Gmail/Outlook/manual import queue at /api/reservations.
 */

export type ReservationRecordListItem = {
  reservation: {
    id: number; leadGuestName: string; status: string; sourceType: string | null;
    sourceBookingReference: string | null; createdAt: string;
  };
  bookingParty: {
    id: number; adultCount: number | null; childCount: number | null; totalPax: number | null;
    passengerLanguage: string | null; pickupPoint: string | null; externalOperator: string | null;
  } | null;
  customer: { id: number; name: string } | null;
  operation: { id: number; status: string; startDate: string | null } | null;
  warnings: string[];
};

export type ReservationRecordGuest = { id: number; name: string; age: number | null };

export type ReservationRecordDetail = {
  reservation: {
    id: number; tourOperationId: number; customerId: number | null; leadGuestName: string;
    reservationType: string | null; status: string; rebookedIntoReservationId: number | null;
    sourceType: string | null; sourceEmailImportId: number | null; sourceSheetImportId: number | null;
    sourceHistoricalKey: string | null; sourceBookingReference: string | null;
    createdAt: string; updatedAt: string;
  };
  bookingParty: {
    id: number; adultCount: number | null; childCount: number | null; totalPax: number | null;
    passengerLanguage: string | null; mealIncluded: string | null; entranceIncluded: string | null;
    specialRequirements: string | null; externalSource: string | null; externalOperator: string | null;
    netAmount: string | null; advanceAmount: string | null; currency: string | null;
    tourCodeRaw: string | null; itineraryRaw: string | null; shipScheduleRaw: string | null;
    pickupPoint: string | null; guests: ReservationRecordGuest[];
  } | null;
  customer: { id: number; name: string } | null;
  operation: Record<string, unknown> | null;
  siblingReservations: { id: number; leadGuestName: string; status: string }[];
  warnings: string[];
  activity: { activity: { id: number; eventType: string; actorName: string | null; createdAt: string }[]; limit: number };
};

export type ReservationRecordListFilters = Partial<{
  dateFrom: string; dateTo: string; reservationStatus: string; operationStatus: string;
  sourceType: string; operator: string; bookingReference: string; q: string;
  operationLinked: 'linked' | 'unlinked';
  incompletePax: boolean; missingPickup: boolean; missingLanguage: boolean; missingBookingReference: boolean;
}>;

export type ReservationRecordEdit = Partial<{
  reservation: Partial<{ status: string; leadGuestName: string; sourceBookingReference: string | null }>;
  bookingParty: Partial<{
    adultCount: number | null; childCount: number | null; passengerLanguage: string | null;
    pickupPoint: string | null; itineraryRaw: string | null;
  }>;
}>;

function toQueryString(filters: ReservationRecordListFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const reservationRecordsApi = {
  list: (filters: ReservationRecordListFilters = {}) =>
    customFetch<ReservationRecordListItem[]>(`/api/reservation-records${toQueryString(filters)}`),
  get: (id: number) => customFetch<ReservationRecordDetail>(`/api/reservation-records/${id}`),
  update: (id: number, edit: ReservationRecordEdit) =>
    customFetch<{ reservation: unknown; bookingParty: unknown; changedFields: string[] }>(
      `/api/reservation-records/${id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) },
    ),
};
