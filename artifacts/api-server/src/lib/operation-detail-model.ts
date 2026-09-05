/** Pure composition: no inferred passengers or synthetic domain records. */
export function partyPax(party: { adultCount: number | null; childCount: number | null } | null) {
  return party?.adultCount != null && party.childCount != null
    ? party.adultCount + party.childCount : null;
}

export function composeReservations<
  R extends { id: number },
  P extends { id: number; reservationId: number; adultCount: number | null; childCount: number | null },
  G extends { bookingPartyId: number },
>(rows: { reservation: R; bookingParty: P | null }[], guests: G[]) {
  const byParty = new Map<number, G[]>();
  for (const guest of guests) {
    const group = byParty.get(guest.bookingPartyId) ?? [];
    group.push(guest);
    byParty.set(guest.bookingPartyId, group);
  }
  const reservations = rows.map(({ reservation, bookingParty }) => ({
    ...reservation,
    bookingParty: bookingParty ? {
      ...bookingParty, totalPax: partyPax(bookingParty), guests: byParty.get(bookingParty.id) ?? [],
    } : null,
  }));
  return { reservations, summary: summarizePax(reservations.map(r => r.bookingParty?.totalPax ?? null)) };
}

/**
 * Shared by composeReservations (Operation Detail) and the Daily Operations
 * Center read model: a PAX total is only ever a plain sum or an explicit
 * `null` (some reservation's count is missing) — never a partial sum that
 * silently drops the unknown one. Reused rather than reimplemented so both
 * screens can never drift into computing "total PAX" two different ways.
 */
export function summarizePax(paxValues: (number | null | undefined)[]) {
  const reservationCount = paxValues.length;
  const incompleteReservationCount = paxValues.filter(p => p == null).length;
  const totalPax = reservationCount && !incompleteReservationCount
    ? paxValues.reduce((sum: number, p) => sum + (p as number), 0)
    : null;
  return { reservationCount, incompleteReservationCount, totalPax };
}
