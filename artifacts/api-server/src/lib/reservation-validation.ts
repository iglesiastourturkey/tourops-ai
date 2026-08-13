/**
 * Deterministic pre-flight checks for reservation → operation conversion (M3).
 *
 * Split from the route on purpose: these rules are pure functions over already
 * validated data, with no database and no express in sight, so they can be
 * reasoned about (and mirrored in the focused tests) without a live connection.
 *
 * The product rule they encode: AI extracts, code validates, humans approve.
 * Only a logically impossible state is a hard block; everything a real operator
 * might legitimately want to do stays a warning they can acknowledge.
 */

export type DraftWarningCode =
  | "duplicate_booking_reference"
  | "past_tour_date"
  | "guest_count_mismatch";

export interface DraftWarning {
  code: DraftWarningCode;
  /** Turkish, shown verbatim to the reviewer. */
  message: string;
  detail?: Record<string, unknown>;
}

/** An existing operation carrying the same booking reference. */
export interface DuplicateOperationMatch {
  id: number;
  status: string;
  startDate: string | null;
  sourceType: string;
  /**
   * Whether that operation came from the same source as the import being
   * converted. Informational for now — once Viator/GetYourGuide arrive, a match
   * across two platforms means something different from a match within one, and
   * this is where that distinction will be drawn.
   */
  sameSource: boolean;
}

const DRAFT_WARNING_CODES: readonly DraftWarningCode[] = [
  "duplicate_booking_reference",
  "past_tour_date",
  "guest_count_mismatch",
];

/**
 * The warning codes the reviewer explicitly acknowledged, read off the request
 * body.
 *
 * Deliberately a list rather than a boolean: between the 409 that showed the
 * warnings and the request that acts on them, a new duplicate can appear. A
 * bare "yes, proceed" would carry that unseen warning through and leave an
 * audit record claiming the reviewer accepted it. Filtering the known codes
 * against the body also means an unknown or malformed entry acknowledges
 * nothing instead of everything.
 */
export function parseAcknowledgedWarnings(body: unknown): DraftWarningCode[] {
  const raw = (body as { acknowledgedWarnings?: unknown } | null | undefined)?.acknowledgedWarnings;
  if (!Array.isArray(raw)) return [];
  return DRAFT_WARNING_CODES.filter(code => raw.includes(code));
}

export interface DraftWarningInput {
  tourDate: string | null;
  guestCount: number | null;
  adultCount: number | null;
  childCount: number | null;
}

// en-CA formats as YYYY-MM-DD, which compares correctly as a plain string.
const ISO_DATE_IN_ISTANBUL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Today's date in the timezone the business actually operates in.
 *
 * Render runs the API in UTC, so `new Date().toISOString().slice(0, 10)` would
 * roll over three hours early: between 00:00 and 03:00 Istanbul time it would
 * still report yesterday, and a tour booked for today would be flagged as past.
 */
export function todayInIstanbul(now: Date = new Date()): string {
  return ISO_DATE_IN_ISTANBUL.format(now);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD if the value is one, otherwise null. */
function asIsoDate(value: unknown): string | null {
  if (typeof value === "string" && ISO_DATE_RE.test(value.trim())) return value.trim();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
}

/** Display form for Turkish UI text: 2026-10-05 → 05.10.2026. */
function formatTr(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Booking reference in comparable form: trimmed and lowercased, with blanks
 * collapsed to null. Agencies write the same reference as "GYG-1234" and
 * "gyg-1234 ", and a whitespace-only value must never match another
 * whitespace-only value — that would flag every reference-less booking as a
 * duplicate of the last one.
 */
export function normalizeBookingReference(raw: string | null | undefined): string | null {
  const normalized = (raw ?? "").trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

/**
 * Hard block for a logically impossible date range.
 *
 * Returns a Turkish message when the end date precedes the start date, null
 * otherwise — including when either side is absent or not a plain ISO date, in
 * which case there is nothing to compare and the database's own typing decides.
 */
export function dateOrderBlock(startDate: unknown, endDate: unknown): string | null {
  const start = asIsoDate(startDate);
  const end = asIsoDate(endDate);
  if (!start || !end) return null;
  if (end < start) {
    return `Bitiş tarihi (${formatTr(end)}) başlangıç tarihinden (${formatTr(start)}) önce olamaz.`;
  }
  return null;
}

/**
 * Soft checks a reviewer must acknowledge before an operation is created.
 *
 * None of these block: each has a legitimate real-world case (a booking
 * reference reused after a cancellation, a tour entered into the system after
 * it ran, an infant counted in the total but not in the adult/child split).
 * They exist so the reviewer notices, not so the system decides.
 */
export function collectDraftWarnings(
  data: DraftWarningInput,
  context: {
    today: string;
    duplicates: readonly DuplicateOperationMatch[];
    /** True when the lookup was capped and further matches exist. */
    moreDuplicates?: boolean;
  },
): DraftWarning[] {
  const warnings: DraftWarning[] = [];

  if (context.duplicates.length > 0) {
    // No total is quoted: the lookup is capped, so a count here would be the
    // cap rather than the truth. The listed operations are what the reviewer
    // acts on either way.
    const labels = context.duplicates.map(match => `#${match.id}`).join(", ");
    warnings.push({
      code: "duplicate_booking_reference",
      message:
        `Bu rezervasyon numarası başka operasyonlarda kayıtlı (${labels}` +
        `${context.moreDuplicates ? " ve daha fazlası" : ""}). ` +
        "Aynı rezervasyonu ikinci kez işlemediğinizden emin olun.",
      detail: { operations: context.duplicates, moreDuplicates: context.moreDuplicates === true },
    });
  }

  const tourDate = asIsoDate(data.tourDate);
  if (tourDate && tourDate < context.today) {
    warnings.push({
      code: "past_tour_date",
      message:
        `Tur tarihi (${formatTr(tourDate)}) bugünden önce. ` +
        "Geçmiş tarihli bir operasyon oluşturmak üzeresiniz.",
      detail: { tourDate, today: context.today },
    });
  }

  // Only meaningful when the total and at least one part are known. A missing
  // part counts as 0 — that is exactly the case worth surfacing (3 adults and a
  // total of 4 means the child count was probably dropped).
  const hasSplit = data.adultCount !== null || data.childCount !== null;
  if (data.guestCount !== null && hasSplit) {
    const adults = data.adultCount ?? 0;
    const children = data.childCount ?? 0;
    if (adults + children !== data.guestCount) {
      warnings.push({
        code: "guest_count_mismatch",
        message:
          `Yolcu sayıları tutarsız: yetişkin (${adults}) + çocuk (${children}) = ${adults + children}, ` +
          `toplam yolcu ${data.guestCount} olarak girilmiş.`,
        detail: { adultCount: adults, childCount: children, guestCount: data.guestCount },
      });
    }
  }

  return warnings;
}
