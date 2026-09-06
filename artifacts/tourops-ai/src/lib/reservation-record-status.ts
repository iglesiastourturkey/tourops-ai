/**
 * Client-side mirror of the transition graph in
 * artifacts/api-server/src/lib/reservation-record-write.ts. Used only to
 * hide statuses the server would reject anyway — the server guard is the
 * real one, never treat this as authorization.
 */
const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  new: new Set(['confirmed', 'canceled']),
  confirmed: new Set(['completed', 'canceled', 'no_show', 'rebooked']),
  completed: new Set([]),
  canceled: new Set([]),
  no_show: new Set([]),
  rebooked: new Set([]),
};

export function nextReservationStatuses(current: string): string[] {
  return [current, ...Array.from(ALLOWED_TRANSITIONS[current] ?? [])];
}
