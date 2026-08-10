import { customFetch } from '@workspace/api-client-react';

export type ReservationData = Record<string, string | number | boolean | null>;
export type ReservationImport = {
  id: number; sender: string | null; recipients: string | null; subject: string | null;
  receivedAt: string | null; status: string; processingError: string | null; operationId: number | null;
  plainTextBody?: string | null; sanitizedHtmlBody?: string | null;
  attachments?: Array<{ name: string; mimeType: string; size: number }>;
  extraction?: {
    extractedData: ReservationData | null; approvedData: ReservationData | null;
    confidenceScore: number | null; missingFields: string[]; uncertainFields: string[];
    summaryTr: string | null; evidence: Record<string, string> | null;
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

export const reservationApi = {
  list: (search = '', status = '') => customFetch<ReservationImport[]>(`/api/reservations?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  get: (id: number) => customFetch<ReservationImport>(`/api/reservations/${id}`),
  scan: () => customFetch<{ scanned: number; imported: number }>('/api/reservations/scan', { method: 'POST' }),
  analyze: (id: number) => customFetch(`/api/reservations/${id}/analyze`, { method: 'POST' }),
  review: (id: number, data: ReservationData) => customFetch(`/api/reservations/${id}/review`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }),
  reject: (id: number) => customFetch(`/api/reservations/${id}/reject`, { method: 'POST' }),
  createDraft: (id: number) => customFetch<{ operation: { id: number }; duplicate: boolean }>(`/api/reservations/${id}/create-draft`, { method: 'POST' }),
  googleStatus: (integration: GoogleIntegration) => customFetch<GoogleConnectionStatus>(`/api/reservations/google-connection?provider=${integration}`),
  authorize: (integration: GoogleIntegration) => customFetch<{ authorizationUrl: string }>(`/api/reservations/google-connection/${integration}/authorize`, { method: 'POST' }),
  disconnect: (integration: GoogleIntegration) => customFetch(`/api/reservations/google-connection/${integration}`, { method: 'DELETE' }),
};