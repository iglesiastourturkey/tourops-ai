import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { API_BASE } from '@/lib/api-base';
import {
  OPERATION_STATUS_LABELS,
  RESERVATION_STATUS_LABELS as reservationStatuses,
  SOURCE_TYPE_LABELS as sourceNames,
} from '@/lib/labels';

/**
 * Phase 3H.2 — genuinely shared operation-detail building blocks.
 *
 * These render the operation concepts common to BOTH the GEMI and SEJOUR
 * subdomains: reservation/customer relationship, PAX, guide/driver/vehicle
 * assignment state, notes, legacy read-only data and audit history. The
 * cruise-specific and sejour-specific sections live in their own components
 * (`CruiseOperationDetail`, `SejourOperationDetail`) and are NOT here.
 */

export type Value = string | number | null;

export interface Party {
  adultCount: number | null; childCount: number | null; totalPax: number | null;
  passengerLanguage: string | null; pickupPoint: string | null;
  externalSource: string | null; externalOperator: string | null;
  netAmount: Value; advanceAmount: Value; currency: string | null; collectionStatusRaw: string | null;
  mealIncluded: string | null; entranceIncluded: string | null; specialRequirements: string | null;
  itineraryRaw: string | null; tourCodeRaw: string | null; shipScheduleRaw: string | null;
  guests?: { id: number; name: string; age: number | null }[];
}

export interface OperationDetail {
  operation: {
    id: number; status: string; startDate: string | null; endDate: string | null;
    operationType: 'CRUISE' | 'SEJOUR' | null; pickupTime: string | null; notes: string | null; sourceType: string | null;
    guideName: string | null; guidePhone: string | null; driverName: string | null; driverPhone: string | null;
    vehiclePlate: string | null; createdAt: string; updatedAt: string;
  };
  context: Record<string, Value>;
  summary: { totalPax: number | null; reservationCount: number; incompleteReservationCount: number };
  reservations: {
    id: number; leadGuestName: string; status: string; sourceType: string | null;
    sourceBookingReference: string | null; reservationType: string | null;
    rebookedIntoReservationId: number | null; customer: { id: number; name: string } | null;
    createdAt: string; updatedAt: string; bookingParty: Party | null;
  }[];
  legacy: (Party & { readOnly: true }) | null;
  history: { activity: { id: number; eventType: string; actorName: string | null; createdAt: string }[] };
}

export const missing = 'Belirtilmemiş';
export const sourceLabel = (value: string | null) => value ? sourceNames[value] ?? value : missing;

/**
 * Phase 2C display-state classification (CANONICAL / LEGACY_ONLY / UNASSIGNED —
 * see operation-assignment.ts's classifyAssignmentState on the backend,
 * mirrored here rather than shared across packages for one three-line rule).
 * `resourceName` is the joined resources.name from the /detail context: it is
 * non-null only when the operation's guideResourceId/driverResourceId FK
 * actually resolved, so its presence is equivalent evidence to the FK itself.
 */
export function assignmentStateLabel(resourceName: Value | undefined, legacyName: string | null): string {
  if (resourceName) return `${resourceName} · Personel kaydıyla eşleşti`;
  if (legacyName) return `${legacyName} · Personel kaydıyla henüz eşleştirilmedi`;
  return 'Atanmadı';
}

export function Fields({ entries }: { entries: [string, Value | undefined][] }) {
  return <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-2 text-sm">
    {entries.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{value == null || value === '' ? missing : value}</dd></div>)}
  </dl>;
}

export function PartyDetails({ party }: { party: Party }) {
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

/** Shared operation summary — the cross-domain core fields, no ship / no sejour. */
export function SharedOperationSummary({ detail }: { detail: OperationDetail }) {
  const { operation: op, context: c, reservations, summary } = detail;
  const languages = [...new Set(reservations.map(r => r.bookingParty?.passengerLanguage).filter(Boolean))].join(', ');
  const pickups = [...new Set(reservations.map(r => r.bookingParty?.pickupPoint).filter(Boolean))].join(' / ');
  return <>
    {summary.incompleteReservationCount > 0 && <p role="status" className="text-sm text-amber-700">{summary.incompleteReservationCount} rezervasyonda yolcu sayısı eksik. Toplam PAX belirlenemiyor.</p>}
    <Fields entries={[
      ['Tarih', op.startDate], ['Bitiş', op.endDate], ['Alış saati', op.pickupTime],
      ['Toplam PAX', summary.totalPax ?? 'Belirlenemiyor'], ['Rezervasyon sayısı', summary.reservationCount],
      ['Alış noktaları', pickups], ['Diller', languages],
      ['Rehber', assignmentStateLabel(c.guideResourceName, op.guideName)], ['Rehber telefon', op.guidePhone ?? c.guideResourcePhone],
      ['Sürücü', assignmentStateLabel(c.driverResourceName, op.driverName)], ['Sürücü telefon', op.driverPhone ?? c.driverResourcePhone],
      ['Araç', op.vehiclePlate ?? c.vehiclePlate], ['Araç tipi / kapasite', [c.vehicleType, c.vehicleCapacity].filter(v => v != null).join(' / ')],
      ['Rehber firması', c.guideCompany], ['Sürücü firması', c.driverCompany], ['Araç firması', c.vehicleCompany], ['Operasyon kaynağı', sourceLabel(op.sourceType)],
    ]} />
    <div><h3 className="text-sm font-semibold">Operasyon notları</h3><p className="text-sm whitespace-pre-wrap">{op.notes || missing}</p></div>
  </>;
}

/** Shared reservations list — identical for both subdomains. */
export function ReservationsSection({ reservations }: { reservations: OperationDetail['reservations'] }) {
  return <div className="space-y-3"><h2 className="font-semibold">Rezervasyonlar ({reservations.length})</h2>
    {!reservations.length && <p className="text-sm text-muted-foreground">Bu operasyona bağlı Reservation kaydı yok.</p>}
    {reservations.map(r => <article key={r.id} className="border rounded-lg bg-card p-4 space-y-3" aria-label={`Rezervasyon: ${r.leadGuestName}`}>
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{r.leadGuestName}</h3><span className="text-sm">Rezervasyon: {reservationStatuses[r.status] ?? r.status}</span></div>
      <Fields entries={[
        ['Kaynak', sourceLabel(r.sourceType)], ['Rezervasyon referansı', r.sourceBookingReference], ['Müşteri', r.customer?.name],
        ['Rezervasyon türü', r.reservationType], ['Yeniden rezervasyon bağlantısı', r.rebookedIntoReservationId],
      ]} />
      {r.bookingParty ? <PartyDetails party={r.bookingParty} /> : <p role="status">BookingParty kaydı eksik; yolcu sayısı belirlenemiyor.</p>}
      <details className="text-xs"><summary className="cursor-pointer focus-visible:outline">Kayıt bilgileri</summary><p>Oluşturulma: {r.createdAt}</p><p>Güncelleme: {r.updatedAt}</p></details>
    </article>)}
  </div>;
}

/** Shared legacy read-only block — identical for both subdomains. */
export function LegacyReadOnlySection({ legacy }: { legacy: OperationDetail['legacy'] }) {
  if (!legacy) return null;
  return <section className="border border-amber-500 rounded-lg p-4 space-y-3" aria-label="Eski salt okunur veri">
    <h2 className="font-semibold">Eski rezervasyon verisi · Salt okunur</h2>
    <p className="text-sm">Bu veri Reservation / BookingParty kaydı değildir. Operasyon PAX toplamına dahil edilmez.</p>
    <PartyDetails party={legacy} />
  </section>;
}

/** Shared audit / history block — identical for both subdomains. */
export function OperationHistorySection({ operation, history }: { operation: OperationDetail['operation']; history: OperationDetail['history'] }) {
  return <details className="border rounded-lg p-4 text-sm"><summary className="cursor-pointer font-semibold focus-visible:outline">Geçmiş · Son 100 operasyon etkinliği</summary>
    <p className="my-2 text-muted-foreground">Rezervasyon / BookingParty değişiklik geçmişi henüz bağlantılı değil.</p>
    <p className="text-xs mb-2">Operasyon oluşturulma: {operation.createdAt} · Güncelleme: {operation.updatedAt}</p>
    {history.activity.length ? <ul className="space-y-2">{history.activity.map(a => <li key={a.id}><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString('tr-TR')}</time> · {a.eventType} · {a.actorName ?? missing}</li>)}</ul> : <p>Kayıtlı operasyon etkinliği yok.</p>}
  </details>;
}

export function OperationStatusLine({ operation, typeLabel }: { operation: OperationDetail['operation']; typeLabel: string }) {
  return <span className="text-sm">{typeLabel} · Operasyon: {OPERATION_STATUS_LABELS[operation.status] ?? operation.status}</span>;
}

/** Shared data hook — one fetch, three surfaces (operations / field / guide). */
export function useOperationDetail(operationId: number, surface: 'operations' | 'field' | 'guide') {
  const prefix = surface === 'field' ? 'field/operations' : surface === 'guide' ? 'guide/my-operations' : 'operations';
  return useQuery({
    queryKey: ['operation-domain-detail', surface, operationId],
    queryFn: () => customFetch<OperationDetail>(`${API_BASE}/${prefix}/${operationId}/detail`),
    enabled: Number.isSafeInteger(operationId) && operationId > 0,
  });
}
