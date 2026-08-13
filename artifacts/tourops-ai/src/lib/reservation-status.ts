/**
 * Client-side mirror of the inbox state machine in
 * artifacts/api-server/src/routes/reservations.ts.
 *
 * Used only to hide or disable actions the server would reject anyway. The
 * server guard is the real one — never treat this as authorization.
 */
export type ReservationAction = 'analyze' | 'review' | 'create-draft' | 'reject' | 'reopen';

const ALLOWED_FROM: Record<ReservationAction, ReadonlySet<string>> = {
  analyze: new Set(['new', 'pending_review', 'missing_information', 'error']),
  review: new Set(['pending_review', 'missing_information']),
  'create-draft': new Set(['pending_review', 'missing_information']),
  reject: new Set(['new', 'analyzing', 'pending_review', 'missing_information', 'error']),
  reopen: new Set(['rejected']),
};

export function canRunAction(action: ReservationAction, status: string | undefined): boolean {
  return status ? ALLOWED_FROM[action].has(status) : false;
}

export const STATUS_LABELS: Record<string, string> = {
  new: 'Yeni', analyzing: 'Analiz Ediliyor', pending_review: 'Kontrol Bekliyor',
  missing_information: 'Eksik Bilgi', draft_created: 'Operasyon Taslağı Oluşturuldu',
  error: 'Hatalı', rejected: 'Reddedildi',
};
