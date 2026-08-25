// Faz 4: Günlük/Aylık takvim — pure date-grouping and month-grid helpers for
// the calendar page. No imports, no @/ or @workspace/ dependencies, so this
// stays trivially testable in isolation from the rest of the frontend.

export interface CalendarOperation {
  id: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
  guideName: string | null;
  driverName: string | null;
  vehiclePlate: string | null;
  pickupTime: string | null;
}

/**
 * Groups operations by their startDate ("YYYY-MM-DD"). Operations with no
 * startDate are omitted here — the calendar page lists those separately
 * instead of silently dropping them, so nothing scheduled is ever hidden.
 *
 * A multi-day operation (startDate !== endDate) is shown once, on its
 * startDate only. That is Faz 4's stated MVP scope, not a bug: showing it on
 * every day of its span is a natural follow-up once the calendar is in use,
 * not a blocker for the first version.
 */
export function groupOperationsByDate<T extends { startDate: string | null }>(
  operations: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const op of operations) {
    if (!op.startDate) continue;
    // Defensive slice: tolerates a full timestamp, not just a bare date.
    const key = op.startDate.slice(0, 10);
    const bucket = map.get(key);
    if (bucket) bucket.push(op);
    else map.set(key, [op]);
  }
  return map;
}

/** Local "YYYY-MM-DD" key for a Date — deliberately not toISOString(), which
 * would shift the date across a UTC day boundary for timezones behind UTC. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Monday-first 42-cell (6-week) grid for the month containing `monthDate`,
 * including the leading/trailing days from the adjacent months needed to
 * fill complete weeks.
 */
export function getMonthGrid(monthDate: Date): Date[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // Date#getDay(): 0=Sun..6=Sat. Convert to a Monday-first offset (0=Mon..6=Sun).
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - firstWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

/** Sorts a day's operations by pickupTime ("HH:MM"), nulls last. */
export function sortByPickupTime<T extends { pickupTime: string | null }>(operations: T[]): T[] {
  return [...operations].sort((a, b) => {
    if (a.pickupTime === b.pickupTime) return 0;
    if (a.pickupTime === null) return 1;
    if (b.pickupTime === null) return -1;
    return a.pickupTime < b.pickupTime ? -1 : 1;
  });
}
