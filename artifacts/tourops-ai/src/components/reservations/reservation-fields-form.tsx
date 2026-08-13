/**
 * The reservation field set, shared by the review screen and the manual-entry
 * dialog so the two can never drift apart.
 *
 * `evidence` is optional: the review screen passes the AI's source quotes, manual
 * entry has none and simply renders without the quote affordances.
 */
import type { ReservationData } from '@/lib/reservation-api';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Quote } from 'lucide-react';

export const RESERVATION_FIELDS: Array<[key: string, label: string, type?: string]> = [
  ['agencyName', 'Acente'], ['bookingReference', 'Rezervasyon Referansı'], ['customerName', 'Müşteri Adı'], ['customerEmail', 'Müşteri E-postası'], ['customerPhone', 'Müşteri Telefonu'],
  ['tourName', 'Tur Adı'], ['tourDate', 'Tur Tarihi', 'date'], ['guestCount', 'Toplam Misafir', 'number'], ['adultCount', 'Yetişkin', 'number'], ['childCount', 'Çocuk', 'number'],
  ['hotelName', 'Otel'], ['pickupLocation', 'Alış Noktası'], ['pickupTime', 'Alış Saati'], ['dropoffLocation', 'Bırakış Noktası'], ['flightNumber', 'Uçuş Numarası'],
  ['guideLanguage', 'Rehber Dili'], ['vehicleType', 'Araç Tipi'], ['amount', 'Tutar', 'number'], ['currency', 'Para Birimi'],
];

export const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(RESERVATION_FIELDS.map(([key, label]) => [key, label])),
  transferRequired: 'Transfer Gerekli', specialRequests: 'Özel İstekler', internalNotes: 'İç Notlar',
};

/** Fills every known key so controlled inputs never flip to uncontrolled. */
export function normalizeReservationData(data: ReservationData | null | undefined): ReservationData {
  return Object.fromEntries(
    RESERVATION_FIELDS.map(([key]) => [key, data?.[key] ?? null]).concat([
      ['transferRequired', data?.transferRequired ?? null],
      ['specialRequests', data?.specialRequests ?? null],
      ['internalNotes', data?.internalNotes ?? null],
    ]),
  );
}

/**
 * Source quote the AI attributed to one extracted field, shown on demand next to
 * that field's label.
 *
 * A popover rather than a tooltip: the reviewer works on tablet/mobile too, and a
 * hover-only affordance would be unreachable on touch. The quote is plain text
 * from an untrusted email body — rendered as a React text node, never as HTML.
 *
 * The trigger keeps a 28x28 hit area (project convention for icon-only actions)
 * pulled back vertically, so it stays tappable without changing the row height.
 */
function EvidenceHint({ fieldLabel, quote }: { fieldLabel: string; quote?: string | null }) {
  if (typeof quote !== 'string' || !quote.trim()) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${fieldLabel}: AI'ın dayandığı kaynak metni göster`}
          className="shrink-0 inline-flex h-7 w-7 -my-1.5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-primary"
        >
          <Quote className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] text-xs">
        <p className="font-medium mb-1.5">{fieldLabel} — kaynak metin</p>
        <p className="text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-auto">
          “{quote.trim()}”
        </p>
      </PopoverContent>
    </Popover>
  );
}

interface ReservationFieldsFormProps {
  value: ReservationData;
  onChange: (next: ReservationData) => void;
  /** AI source quotes keyed by field name. Omitted for manual entry. */
  evidence?: Record<string, string>;
  /** Prefix for input ids, so two instances on one page cannot collide. */
  idPrefix?: string;
  disabled?: boolean;
}

export function ReservationFieldsForm({
  value, onChange, evidence = {}, idPrefix = 'field', disabled = false,
}: ReservationFieldsFormProps) {
  const set = (key: string, next: string | number | boolean | null) => onChange({ ...value, [key]: next });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {RESERVATION_FIELDS.map(([key, label, type]) => (
        <div key={key} className="text-sm">
          <div className="flex items-center gap-1 mb-1">
            <label htmlFor={`${idPrefix}-${key}`} className="text-xs text-muted-foreground">{label}</label>
            <EvidenceHint fieldLabel={label} quote={evidence[key]} />
          </div>
          <Input
            id={`${idPrefix}-${key}`}
            type={type ?? 'text'}
            disabled={disabled}
            value={String(value[key] ?? '')}
            onChange={e => set(key, type === 'number'
              ? (e.target.value === '' ? null : Number(e.target.value))
              : (e.target.value || null))}
          />
        </div>
      ))}

      <div className="text-sm flex gap-2 items-center md:col-span-2">
        <label className="flex gap-2 items-center">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.transferRequired === true}
            onChange={e => set('transferRequired', e.target.checked)}
          />
          Transfer gerekli
        </label>
        <EvidenceHint fieldLabel="Transfer Gerekli" quote={evidence.transferRequired} />
      </div>

      {([['specialRequests', 'Özel İstekler'], ['internalNotes', 'İç Notlar']] as const).map(([key, label]) => (
        <div key={key} className="text-sm md:col-span-2">
          <div className="flex items-center gap-1 mb-1">
            <label htmlFor={`${idPrefix}-${key}`} className="text-xs text-muted-foreground">{label}</label>
            <EvidenceHint fieldLabel={label} quote={evidence[key]} />
          </div>
          <Textarea
            id={`${idPrefix}-${key}`}
            disabled={disabled}
            value={String(value[key] ?? '')}
            onChange={e => set(key, e.target.value || null)}
          />
        </div>
      ))}
    </div>
  );
}
