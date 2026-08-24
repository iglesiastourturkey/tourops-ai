import { customFetch } from '@workspace/api-client-react';

export type SheetImportStatus = 'pending' | 'approved' | 'rejected';
export type RowValue = string | number | boolean | null;
export type IncludedStatus = 'included' | 'excluded' | 'unspecified';
export type TourProductMatchStatus = 'matched' | 'alias_matched' | 'unmatched';
export type PortCallMatchStatus = 'matched' | 'new_port_call' | 'time_changed' | 'unmatched';

// Mirrors mappedFieldsSchema in artifacts/api-server/src/routes/sheet-import.ts.
// Always fully derivable from rowData server-side; a reviewer may override any
// field here via PATCH /:id/review before /approve runs.
export type MappedFields = {
    customerName: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
    nationality: string | null;
    startDate: string | null;
    sourceBookingReference: string | null;
    tourCodeRaw: string | null;
    tourType: string | null;
    externalSource: string | null;
    externalOperator: string | null;
    adultCount: number | null;
    childCount: number | null;
    passengerAges: number[] | null;
    passengerLanguage: string | null;
    shipRaw: string | null;
    portRaw: string | null;
    shipScheduleRaw: string | null;
    specialRequirements: string | null;
    opNotes: string | null;
    pickupPoint: string | null;
    pickupTime: string | null;
    itineraryRaw: string | null;
    mealIncluded: IncludedStatus;
    entranceIncluded: IncludedStatus;
    guideNameRaw: string | null;
    driverNameRaw: string | null;
    vehiclePlateRaw: string | null;
    netAmount: number | null;
    currency: string | null;
    advanceAmount: number | null;
    collectionStatusRaw: string | null;
};

export interface SheetReservationImport {
    id: number;
    sheetFileId: string;
    sheetName: string;
    rowNumber: number;
    rowData: Record<string, RowValue>;
    editedByEmail: string;
    editedAt: string;
    status: SheetImportStatus;
    matchedOperationId: number | null;
    matchedCustomerId: number | null;
    // Only ever populated once /approve has actually run (matching happens
  // inside that transaction, not at review time) - null beforehand.
  tourProductMatchStatus: TourProductMatchStatus | null;
    portCallMatchStatus: PortCallMatchStatus | null;
    approvedAt: string | null;
    approvedBy: number | null;
    rejectedAt: string | null;
    rejectedBy: number | null;
    // Present on GET /:id and PATCH /:id/review responses (stored mappedData,
  // or freshly derived from rowData if the row was never reviewed yet).
  // Absent on the plain list (GET /) response.
  mappedData?: MappedFields;
}

export const sheetImportApi = {
    list: (status: string = 'pending') =>
          customFetch<SheetReservationImport[]>(`/api/sheet-import?status=${encodeURIComponent(status)}`),
    get: (id: number) => customFetch<SheetReservationImport>(`/api/sheet-import/${id}`),
    review: (id: number, data: Partial<MappedFields>) =>
          customFetch<SheetReservationImport>(`/api/sheet-import/${id}/review`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
          }),
    approve: (id: number) => customFetch<SheetReservationImport>(`/api/sheet-import/${id}/approve`, { method: 'POST' }),
    reject: (id: number) => customFetch<SheetReservationImport>(`/api/sheet-import/${id}/reject`, { method: 'POST' }),
};
