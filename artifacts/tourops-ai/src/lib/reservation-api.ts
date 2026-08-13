import { customFetch } from '@workspace/api-client-react';

export type ReservationData = Record<string, string | number | boolean | null>;
export type ReservationImport = {
  id: number; sender: string | null; recipients: string | null; subject: string | null;
  receivedAt: string | null; status: string; processingError: string | null; operationId: number | null;
  /** "gmail" for scanned messages, "manual" for operator-entered reservations. */
  source?: string;
  plainTextBody?: string | null; sanitizedHtmlBody?: string | null;
  attachments?: Array<{ name: string; mimeType: string; size: number }>;
  extraction?: {
    extractedData: ReservationData | null; approvedData: ReservationData | null;
    confidenceScore: number | null; missingFields: string[]; uncertainFields: string[];
    summaryTr: string | null; evidence: Record<string, string> | null;
    /**
     * When a human last saved the fields. Survives a re-analysis (which nulls
     * approvedData), so `approvedData === null && editedAt !== null` means an
     * earlier approval was invalidated by fresh AI output.
     */
    editedAt: string | null;
  } | null;
};
export type GoogleIntegration = 'gmail' | 'drive';
export type GoogleConnectionStatus = {
  configured: boolean;
  missingConfiguration: string[];
  connection: {
    googleAccountEmail: string | null;
    status: string;
    lastError: string | null;
    grantedScopes: string[];
    lastSuccessfulAccessAt: string | null;
    driveAccessSummary: string | null;
  } | null;
};

/**
 * Structured 400 body returned by POST /api/reservations/:id/create-draft when a
 * pre-condition fails (missing approval, unfilled required fields, no tour date).
 * Read off ApiError.data — that class is not exported from the api client package,
 * so the shape is checked structurally rather than via instanceof.
 */
export type CreateDraftErrorCode =
  | 'approval_required' | 'invalid_approved_data' | 'missing_fields'
  | 'customer_name_required' | 'tour_date_required' | 'invalid_status_transition';
export type CreateDraftError = { error?: string; code?: CreateDraftErrorCode; missingFields?: string[] };

export function createDraftError(error: unknown): CreateDraftError | null {
  const data = (error as { data?: unknown } | null | undefined)?.data;
  if (!data || typeof data !== 'object') return null;
  const body = data as CreateDraftError;
  return typeof body.error === 'string' || typeof body.code === 'string' ? body : null;
}

export const reservationApi = {
  list: (search = '', status = '') => customFetch<ReservationImport[]>(`/api/reservations?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  get: (id: number) => customFetch<ReservationImport>(`/api/reservations/${id}`),
  scan: () => customFetch<{ scanned: number; imported: number }>('/api/reservations/scan', { method: 'POST' }),
  analyze: (id: number) => customFetch(`/api/reservations/${id}/analyze`, { method: 'POST' }),
  review: (id: number, data: ReservationData) => customFetch(`/api/reservations/${id}/review`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }),
  reject: (id: number) => customFetch(`/api/reservations/${id}/reject`, { method: 'POST' }),
  reopen: (id: number) => customFetch(`/api/reservations/${id}/reopen`, { method: 'POST' }),
  create: (data: ReservationData) => customFetch<ReservationImport>('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }),
  createDraft: (id: number) => customFetch<{ operation: { id: number }; duplicate: boolean }>(`/api/reservations/${id}/create-draft`, { method: 'POST' }),
  googleStatus: (integration: GoogleIntegration) => customFetch<GoogleConnectionStatus>(`/api/reservations/google-connection?provider=${integration}`),
  authorize: (integration: GoogleIntegration) => customFetch<{ authorizationUrl: string }>(`/api/reservations/google-connection/${integration}/authorize`, { method: 'POST' }),
  disconnect: (integration: GoogleIntegration) => customFetch(`/api/reservations/google-connection/${integration}`, { method: 'DELETE' }),
};