import {
  Fields, LegacyReadOnlySection, OperationHistorySection, OperationStatusLine,
  ReservationsSection, SharedOperationSummary,
  type OperationDetail, type Value,
} from './operation-shared-sections';

/**
 * SEJOUR (land / travel) operation detail — its own domain structure.
 *
 * SEJOUR is not "cruise without a ship": it is a multi-service land operation
 * (flights, airport transfers, hotels, day tours, intercity transfers). No
 * authoritative structured source exists for those yet (see
 * docs/architecture/phase3h2-operation-subdomains.md §K), so this component
 * shows only the data that genuinely exists today and lays out an explicit,
 * empty service structure for the future `operation_services` child model.
 * It deliberately renders NO ship / port / cruise-schedule fields and
 * fabricates nothing.
 */

interface SejourServiceSlot { key: string; label: string }

// Structure only — NOT data. Each slot is filled from `operation_services`
// once that model and its authoritative source are approved. Until then every
// slot is shown as explicitly pending so the operator is never misled.
const SEJOUR_SERVICE_STRUCTURE: SejourServiceSlot[] = [
  { key: 'arrival_flight', label: 'Varış uçuşu' },
  { key: 'arrival_transfer', label: 'Havalimanı karşılama transferi' },
  { key: 'accommodation', label: 'Konaklama (giriş / çıkış)' },
  { key: 'daily_services', label: 'Günlük turlar / servisler' },
  { key: 'intercity_transfer', label: 'Şehirlerarası transfer' },
  { key: 'departure_transfer', label: 'Ayrılış transferi' },
  { key: 'departure_flight', label: 'Ayrılış uçuşu' },
];

export function SejourOperationDetail({ detail }: { detail: OperationDetail }) {
  const { operation: op, context: c, reservations, legacy, history } = detail;

  const itinerary = [...new Set(reservations.map(r => r.bookingParty?.itineraryRaw).filter(Boolean))].join(' / ');
  const operators = [...new Set(reservations.map(r => r.bookingParty?.externalOperator).filter(Boolean))].join(' / ');

  // Only fields the shared /detail read model genuinely provides today.
  const programFields: [string, Value | undefined][] = [
    ['Süre', [op.startDate, op.endDate].filter(Boolean).join(' – ')],
    ['Program / güzergah', itinerary || (c.tourName as Value) || undefined],
    ['Operatör / acente', operators || undefined],
  ];

  return <section aria-label="Sejour operasyonu çalışma alanı" className="min-w-0 max-w-full space-y-4 mb-5 break-words">
    <div className="border rounded-lg bg-card p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-semibold">{c.programName ?? c.tourName ?? `OP-${op.id}`}</h2>
        <OperationStatusLine operation={op} typeLabel="Sejour operasyonu" />
      </div>

      <section aria-label="Sejour programı" className="rounded-md border border-dashed p-3">
        <h3 className="text-sm font-semibold mb-2">Sejour programı</h3>
        <Fields entries={programFields} />
      </section>

      <section aria-label="Sejour servis yapısı" className="rounded-md border border-dashed p-3">
        <h3 className="text-sm font-semibold">Sejour servisleri</h3>
        <p className="text-xs text-muted-foreground my-2">
          Uçuş, transfer, konaklama ve günlük servis kayıtları için yetkili yapılandırılmış
          kaynak henüz yok. Aşağıdaki yapı, <code>operation_services</code> modeli
          eklendiğinde doldurulacak — değerler tahmin edilmez.
        </p>
        <ul className="divide-y text-sm">
          {SEJOUR_SERVICE_STRUCTURE.map(slot => (
            <li key={slot.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{slot.label}</span>
              <span className="text-xs text-muted-foreground">Yetkili kaynak verisi bekleniyor</span>
            </li>
          ))}
        </ul>
      </section>

      <SharedOperationSummary detail={detail} />
    </div>

    <ReservationsSection reservations={reservations} />
    <LegacyReadOnlySection legacy={legacy} />
    <OperationHistorySection operation={op} history={history} />
  </section>;
}
