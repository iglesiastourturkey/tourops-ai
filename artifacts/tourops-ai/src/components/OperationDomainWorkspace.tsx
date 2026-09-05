import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { API_BASE } from '@/lib/api-base';
import {
  OPERATION_STATUS_LABELS,
  RESERVATION_STATUS_LABELS as reservationStatuses,
  SOURCE_TYPE_LABELS as sourceNames,
} from '@/lib/labels';

type Value = string | number | null;
interface Party {
  adultCount: number | null; childCount: number | null; totalPax: number | null;
  passengerLanguage: string | null; pickupPoint: string | null;
  externalSource: string | null; externalOperator: string | null;
  netAmount: Value; advanceAmount: Value; currency: string | null; collectionStatusRaw: string | null;
  mealIncluded: string | null; entranceIncluded: string | null; specialRequirements: string | null;
  itineraryRaw: string | null; tourCodeRaw: string | null; shipScheduleRaw: string | null;
  guests?: { id: number; name: string; age: number | null }[];
}
interface Detail {
  operation: { id: number; status: string; startDate: string | null; endDate: string | null;
    pickupTime: string | null; notes: string | null; sourceType: string | null;
    guideName: string | null; guidePhone: string | null; driverName: string | null; driverPhone: string | null;
    vehiclePlate: string | null; createdAt: string; updatedAt: string };
  context: Record<string, Value>;
  summary: { totalPax: number | null; reservationCount: number; incompleteReservationCount: number };
  reservations: { id: number; leadGuestName: string; status: string; sourceType: string | null;
    sourceBookingReference: string | null; reservationType: string | null;
    rebookedIntoReservationId: number | null; customer: { id: number; name: string } | null;
    createdAt: string; updatedAt: string; bookingParty: Party | null }[];
  legacy: (Party & { readOnly: true }) | null;
  history: { activity: { id: number; eventType: string; actorName: string | null; createdAt: string }[] };
}
const missing = 'Belirtilmemiş';
const source = (value: string | null) => value ? sourceNames[value] ?? value : missing;
function Fields({ entries }: { entries: [string, Value | undefined][] }) {
  return <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-2 text-sm">
    {entries.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{value == null || value === '' ? missing : value}</dd></div>)}
  </dl>;
}
function PartyDetails({ party }: { party: Party }) {
  return <>
    <Fields entries={[
      ['Yetişkin', party.adultCount], ['Çocuk', party.childCount], ['PAX', party.totalPax ?? 'Eksik yolcu sayısı'],
      ['Dil', party.passengerLanguage], ['Alış noktası', party.pickupPoint], ['Kanal', party.externalSource],
      ['Operatör / acente', party.externalOperator], ['Net tutar (kaynak verisi)', party.netAmount],
      ['Avans (kaynak verisi)', party.advanceAmount], ['Para birimi', party.currency], ['Tahsilat bilgisi', party.collectionStatusRaw],
      ['Yemek', party.mealIncluded], ['Giriş', party.entranceIncluded], ['Özel gereksinimler', party.specialRequirements],
      ['Program', party.itineraryRaw], ['Tur kodu', party.tourCodeRaw], ['Gemi programı', party.shipScheduleRaw],
    ]} />
    {party.guests && <details className="mt-3 text-sm"><summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Kayıtlı misafirler ({party.guests.length})</summary>
      <p className="text-xs text-muted-foreground my-2">Misafir kayıt sayısı PAX değildir.</p>
      {party.guests.length ? <ul className="space-y-1">{party.guests.map(g => <li key={g.id}>{g.name} · Yaş: {g.age ?? missing}</li>)}</ul> : <p>Kayıtlı misafir yok.</p>}
    </details>}
  </>;
}
/** One domain implementation across desktop, field/PWA and guide surfaces. */
export function OperationDomainWorkspace({ operationId, surface = 'operations' }: { operationId: number; surface?: 'operations' | 'field' | 'guide' }) {
  const prefix = surface === 'field' ? 'field/operations' : surface === 'guide' ? 'guide/my-operations' : 'operations';
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['operation-domain-detail', surface, operationId],
    queryFn: () => customFetch<Detail>(`${API_BASE}/${prefix}/${operationId}/detail`),
    enabled: Number.isSafeInteger(operationId) && operationId > 0,
  });
  if (isPending) return <p role="status" className="p-4">Rezervasyonlar yükleniyor…</p>;
  if (isError || !data) return <div role="alert" className="p-4 border rounded mb-4">Rezervasyon detayı yüklenemedi. <button className="underline focus-visible:outline" onClick={() => refetch()}>Tekrar dene</button></div>;
  const { operation: op, context: c, reservations, summary, legacy, history } = data;
  const languages = [...new Set(reservations.map(r => r.bookingParty?.passengerLanguage).filter(Boolean))].join(', ');
  const pickups = [...new Set(reservations.map(r => r.bookingParty?.pickupPoint).filter(Boolean))].join(' / ');
  return <section aria-label="Operasyon ve rezervasyon çalışma alanı" className="min-w-0 max-w-full space-y-4 mb-5 break-words">
    <div className="border rounded-lg bg-card p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{c.programName ?? c.tourName ?? `OP-${op.id}`}</h2><span className="text-sm">Operasyon: {OPERATION_STATUS_LABELS[op.status] ?? op.status}</span></div>
      {summary.incompleteReservationCount > 0 && <p role="status" className="text-sm text-amber-700">{summary.incompleteReservationCount} rezervasyonda yolcu sayısı eksik. Toplam PAX belirlenemiyor.</p>}
      <Fields entries={[
        ['Tarih', op.startDate], ['Bitiş', op.endDate], ['Alış saati', op.pickupTime],
        ['Toplam PAX', summary.totalPax ?? 'Belirlenemiyor'], ['Rezervasyon sayısı', summary.reservationCount],
        ['Alış noktaları', pickups], ['Diller', languages], ['Gemi', c.shipName ?? c.tourShipName], ['Liman', c.portName ?? c.tourPortName],
        ['Cruise', c.cruiseLine], ['Gemi varış', [c.arrivalDate, c.arrivalTime ?? c.tourArrivalTime].filter(Boolean).join(' ')],
        ['Gemi kalkış', [c.departureDate, c.departureTime ?? c.tourDepartureTime].filter(Boolean).join(' ')],
        ['Rehber', op.guideName ?? c.guideResourceName ?? c.assignedGuideName], ['Rehber telefon', op.guidePhone ?? c.guideResourcePhone],
        ['Sürücü', op.driverName ?? c.driverResourceName], ['Sürücü telefon', op.driverPhone ?? c.driverResourcePhone],
        ['Araç', op.vehiclePlate ?? c.vehiclePlate], ['Araç tipi / kapasite', [c.vehicleType, c.vehicleCapacity].filter(v => v != null).join(' / ')],
        ['Rehber firması', c.guideCompany], ['Sürücü firması', c.driverCompany], ['Araç firması', c.vehicleCompany], ['Operasyon kaynağı', source(op.sourceType)],
      ]} />
      <div><h3 className="text-sm font-semibold">Operasyon notları</h3><p className="text-sm whitespace-pre-wrap">{op.notes || missing}</p></div>
    </div>
    <div className="space-y-3"><h2 className="font-semibold">Rezervasyonlar ({reservations.length})</h2>
      {!reservations.length && <p className="text-sm text-muted-foreground">Bu operasyona bağlı Reservation kaydı yok.</p>}
      {reservations.map(r => <article key={r.id} className="border rounded-lg bg-card p-4 space-y-3" aria-label={`Rezervasyon: ${r.leadGuestName}`}>
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{r.leadGuestName}</h3><span className="text-sm">Rezervasyon: {reservationStatuses[r.status] ?? r.status}</span></div>
        <Fields entries={[
          ['Kaynak', source(r.sourceType)], ['Rezervasyon referansı', r.sourceBookingReference], ['Müşteri', r.customer?.name],
          ['Rezervasyon türü', r.reservationType], ['Yeniden rezervasyon bağlantısı', r.rebookedIntoReservationId],
        ]} />
        {r.bookingParty ? <PartyDetails party={r.bookingParty} /> : <p role="status">BookingParty kaydı eksik; yolcu sayısı belirlenemiyor.</p>}
        <details className="text-xs"><summary className="cursor-pointer focus-visible:outline">Kayıt bilgileri</summary><p>Oluşturulma: {r.createdAt}</p><p>Güncelleme: {r.updatedAt}</p></details>
      </article>)}
    </div>
    {legacy && <section className="border border-amber-500 rounded-lg p-4 space-y-3" aria-label="Eski salt okunur veri"><h2 className="font-semibold">Eski rezervasyon verisi · Salt okunur</h2><p className="text-sm">Bu veri Reservation / BookingParty kaydı değildir. Operasyon PAX toplamına dahil edilmez.</p><PartyDetails party={legacy} /></section>}
    <details className="border rounded-lg p-4 text-sm"><summary className="cursor-pointer font-semibold focus-visible:outline">Geçmiş · Son 100 operasyon etkinliği</summary>
      <p className="my-2 text-muted-foreground">Rezervasyon / BookingParty değişiklik geçmişi henüz bağlantılı değil.</p>
      <p className="text-xs mb-2">Operasyon oluşturulma: {op.createdAt} · Güncelleme: {op.updatedAt}</p>
      {history.activity.length ? <ul className="space-y-2">{history.activity.map(a => <li key={a.id}><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString('tr-TR')}</time> · {a.eventType} · {a.actorName ?? missing}</li>)}</ul> : <p>Kayıtlı operasyon etkinliği yok.</p>}
    </details>
  </section>;
}
