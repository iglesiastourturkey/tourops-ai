import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';
import { API_BASE } from '@/lib/api-base';
import {
  OPERATION_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
} from '@/lib/labels';

// ── Types (mirror the daily-operations-model.ts response shape) ────────────

interface DailyReservation {
  id: number;
  leadGuestName: string;
  status: string;
  sourceType: string | null;
  sourceBookingReference: string | null;
  reservationType: string | null;
  adultCount: number | null;
  childCount: number | null;
  totalPax: number | null;
  passengerLanguage: string | null;
  pickupPoint: string | null;
  externalSource: string | null;
  externalOperator: string | null;
  specialRequirements: string | null;
}

interface DailyOperation {
  sequence: number;
  operation: {
    id: number; status: string; startDate: string | null; endDate: string | null;
    operationType: 'CRUISE' | 'SEJOUR' | null; pickupTime: string | null; notes: string | null;
  };
  context: {
    tourName: string | null; programName: string | null; programCode: string | null;
    shipName: string | null; cruiseLine: string | null; portName: string | null;
    arrivalTime: string | null; departureTime: string | null;
  };
  resources: {
    guideName: string | null; guidePhone: string | null;
    driverName: string | null; driverPhone: string | null;
    vehiclePlate: string | null; vehicleType: string | null; vehicleCapacity: number | null;
  };
  summary: { reservationCount: number; incompleteReservationCount: number; totalPax: number | null };
  reservations: DailyReservation[];
  legacy: boolean;
  warnings: string[];
}

interface DailyBoard {
  date: string;
  summary: {
    operationCount: number; reservationCount: number; knownTotalPax: number;
    incompleteOperationPaxCount: number; missingGuideCount: number; missingVehicleCount: number;
  };
  operations: DailyOperation[];
}

const missing = 'Belirtilmemiş';
const domainDetailHref = (operation: DailyOperation['operation']) => operation.operationType === 'CRUISE'
  ? `/operations/gemi/${operation.id}` : operation.operationType === 'SEJOUR'
    ? `/operations/sejour/${operation.id}` : `/operations/${operation.id}`;

const WARNING_LABELS: Record<string, string> = {
  missing_guide: 'Rehber atanmadı',
  missing_vehicle: 'Araç atanmadı',
  missing_pickup_time: 'Alış saati girilmemiş',
  missing_pickup_point: 'Alış noktası eksik',
  incomplete_pax: 'Yolcu sayısı eksik',
  no_reservations: 'Rezervasyon yok',
  legacy_only: 'Eski veri (salt okunur)',
  vehicle_capacity_exceeded: 'Araç kapasitesi yetersiz',
};

function source(value: string | null) {
  return value ? SOURCE_TYPE_LABELS[value] ?? value : missing;
}

function WarningBadges({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="status">
      {warnings.map(code => (
        <span
          key={code}
          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
            code === 'legacy_only'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-orange-100 text-orange-700'
          }`}
        >
          {WARNING_LABELS[code] ?? code}
        </span>
      ))}
    </div>
  );
}

function ReservationRow({ reservation: r }: { reservation: DailyReservation }) {
  return (
    <li className="py-2 first:pt-0 last:pb-0" aria-label={`Rezervasyon: ${r.leadGuestName}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-medium text-sm">{r.leadGuestName}</span>
        <span className="text-xs text-muted-foreground">
          {RESERVATION_STATUS_LABELS[r.status] ?? r.status}
        </span>
      </div>
      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
        <span>{r.totalPax != null ? `${r.totalPax} PAX` : 'PAX eksik'}</span>
        <span>{source(r.sourceType ?? r.externalSource)}</span>
        {r.sourceBookingReference && <span>Ref: {r.sourceBookingReference}</span>}
        <span>{r.passengerLanguage ?? missing}</span>
        <span>{r.pickupPoint ?? missing}</span>
        {r.externalOperator && <span>{r.externalOperator}</span>}
      </div>
      {r.specialRequirements && (
        <p className="text-xs text-muted-foreground mt-0.5">{r.specialRequirements}</p>
      )}
    </li>
  );
}

function OperationCard({ op }: { op: DailyOperation }) {
  const { operation, context, resources, summary, reservations, legacy, warnings } = op;
  return (
    <article
      className="border rounded-lg bg-card p-4 space-y-3 min-w-0"
      aria-label={`TUR ${op.sequence}: ${context.programName ?? context.tourName ?? `OP-${operation.id}`}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-semibold text-muted-foreground shrink-0">
              TUR {op.sequence}
            </span>
            <h3 className="font-semibold truncate">
              {context.programName ?? context.tourName ?? `OP-${operation.id}`}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {operation.pickupTime ?? missing}
            {context.shipName ? ` · ${context.shipName}` : ''}
            {context.portName ? ` · ${context.portName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700">
            {OPERATION_STATUS_LABELS[operation.status] ?? operation.status}
          </span>
          <Link
            href={domainDetailHref(operation)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 focus-visible:outline"
          >
            {operation.operationType === 'CRUISE' ? 'GEMİ' : operation.operationType === 'SEJOUR' ? 'SEJOUR' : 'Tür belirlenmemiş'} · Detay
          </Link>
        </div>
      </div>

      <WarningBadges warnings={warnings} />

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
        <div><dt className="text-xs text-muted-foreground">Toplam PAX</dt><dd>{summary.totalPax ?? 'Belirlenemiyor'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Rezervasyon</dt><dd>{summary.reservationCount}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Rehber</dt><dd className="truncate">{resources.guideName ?? missing}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Sürücü</dt><dd className="truncate">{resources.driverName ?? missing}</dd></div>
        <div>
          <dt className="text-xs text-muted-foreground">Araç</dt>
          <dd className="truncate">
            {resources.vehiclePlate
              ? `${resources.vehiclePlate}${resources.vehicleCapacity != null ? ` (${resources.vehicleCapacity})` : ''}`
              : missing}
          </dd>
        </div>
        <div><dt className="text-xs text-muted-foreground">Cruise</dt><dd className="truncate">{context.cruiseLine ?? missing}</dd></div>
      </dl>

      {legacy && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Bu operasyon için Reservation kaydı yok — yalnızca eski, salt okunur veri gösteriliyor.
        </p>
      )}

      {reservations.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline">
            Rezervasyonlar ({reservations.length})
          </summary>
          <ul className="divide-y mt-2">
            {reservations.map(r => <ReservationRow key={r.id} reservation={r} />)}
          </ul>
        </details>
      )}

      {operation.notes && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap border-t pt-2">{operation.notes}</p>
      )}
    </article>
  );
}

function SummaryBar({ summary }: { summary: DailyBoard['summary'] }) {
  const items: [string, number][] = [
    ['Operasyon', summary.operationCount],
    ['Rezervasyon', summary.reservationCount],
    ['Bilinen PAX', summary.knownTotalPax],
    ['Eksik PAX', summary.incompleteOperationPaxCount],
    ['Rehbersiz', summary.missingGuideCount],
    ['Araçsız', summary.missingVehicleCount],
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border bg-card p-2.5 text-center">
          <div className="text-lg font-bold leading-none">{value}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{label}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Daily Operations Center board — one batched read per selected date
 * (GET /api/operations/daily), rendered as a "TUR 1 / TUR 2 / ..." sequence
 * of operation cards. `sequence` is display-only, recomputed by the server
 * on every request; nothing here persists or limits it, and the board
 * supports any number of Operations/Reservations/Guests with no
 * spreadsheet-style row cap.
 */
export function DailyOperationsBoard({ date }: { date: string }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['daily-operations', date],
    queryFn: () => customFetch<DailyBoard>(`${API_BASE}/operations/daily?date=${date}`),
  });

  if (isPending) return <p role="status" className="p-4 text-sm text-muted-foreground">Günlük operasyonlar yükleniyor…</p>;
  if (isError || !data) {
    return (
      <div role="alert" className="p-4 border rounded-lg text-sm">
        Günlük operasyon verisi yüklenemedi.{' '}
        <button className="underline focus-visible:outline" onClick={() => refetch()}>Tekrar dene</button>
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0">
      <SummaryBar summary={data.summary} />
      {data.operations.length === 0 ? (
        <div className="text-center text-muted-foreground py-10 text-sm border rounded-lg bg-card">
          Bu tarihte planlanmış operasyon yok
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.operations.map(op => <OperationCard key={op.operation.id} op={op} />)}
        </div>
      )}
    </div>
  );
}
