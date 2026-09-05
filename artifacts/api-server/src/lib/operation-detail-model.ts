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
  const incompleteReservationCount = reservations.filter(r => r.bookingParty?.totalPax == null).length;
  return {
    reservations,
    summary: {
      reservationCount: reservations.length,
      incompleteReservationCount,
      totalPax: reservations.length && !incompleteReservationCount
        ? reservations.reduce((sum, r) => sum + r.bookingParty!.totalPax!, 0) : null,
    },
  };
}
