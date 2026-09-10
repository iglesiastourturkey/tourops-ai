import {
  Fields, LegacyReadOnlySection, OperationHistorySection, OperationStatusLine,
  ReservationsSection, SharedOperationSummary,
  type OperationDetail, type Value,
} from './operation-shared-sections';

/**
 * GEMI (cruise) operation detail — the cruise-oriented domain sections.
 *
 * Owns only the ship / port / cruise schedule presentation. Everything shared
 * with SEJOUR (reservation, customer, guide, driver, vehicle, notes, audit,
 * legacy) is delegated to the shared section components — no duplication.
 */
export function CruiseOperationDetail({ detail }: { detail: OperationDetail }) {
  const { operation: op, context: c, reservations, legacy, history } = detail;

  const cruiseFields: [string, Value | undefined][] = [
    ['Gemi', c.shipName ?? c.tourShipName],
    ['Liman', c.portName ?? c.tourPortName],
    ['Cruise hattı', c.cruiseLine],
    ['Gemi varış', [c.arrivalDate, c.arrivalTime ?? c.tourArrivalTime].filter(Boolean).join(' ')],
    ['Gemi kalkış', [c.departureDate, c.departureTime ?? c.tourDepartureTime].filter(Boolean).join(' ')],
  ];

  return <section aria-label="Gemi operasyonu çalışma alanı" className="min-w-0 max-w-full space-y-4 mb-5 break-words">
    <div className="border rounded-lg bg-card p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-semibold">{c.programName ?? c.tourName ?? `OP-${op.id}`}</h2>
        <OperationStatusLine operation={op} typeLabel="Gemi operasyonu" />
      </div>

      <section aria-label="Gemi bilgileri" className="rounded-md border border-dashed p-3">
        <h3 className="text-sm font-semibold mb-2">Gemi ve liman</h3>
        <Fields entries={cruiseFields} />
      </section>

      <SharedOperationSummary detail={detail} />
    </div>

    <ReservationsSection reservations={reservations} />
    <LegacyReadOnlySection legacy={legacy} />
    <OperationHistorySection operation={op} history={history} />
  </section>;
}
