export type HistoricalDuplicateClassification =
  | "REAL_DUPLICATE"
  | "SAME_BOOKING_SUPPLEMENTARY_ROW"
  | "SAME_BOOKING_DIFFERENT_SERVICE"
  | "AMBIGUOUS";

export interface HistoricalDuplicateCandidateContext {
  sourceKind: string;
  worksheetName: string;
  sourceRow: number;
  operationDate: string | null;
  tourType: string | null;
  customerName: string | null;
  agency: string | null;
  operator: string | null;
  adultCount: number | null;
  childCount: number | null;
  pickupTime: string | null;
  pickupPoint: string | null;
  language: string | null;
  tourSection: string | null;
  notes: string | null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sameNullableText(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalize(a) === normalize(b);
}

function normalizeChildCount(value: number | null | undefined): number {
  return value ?? 0;
}

function sameCore(
  a: HistoricalDuplicateCandidateContext,
  b: HistoricalDuplicateCandidateContext,
): boolean {
  return (
    sameNullableText(a.sourceKind, b.sourceKind) &&
    sameNullableText(a.worksheetName, b.worksheetName) &&
    sameNullableText(a.operationDate, b.operationDate) &&
    sameNullableText(a.tourType, b.tourType) &&
    sameNullableText(a.customerName, b.customerName) &&
    sameNullableText(a.agency, b.agency) &&
    sameNullableText(a.operator, b.operator) &&
    a.adultCount === b.adultCount &&
    normalizeChildCount(a.childCount) === normalizeChildCount(b.childCount) &&
    sameNullableText(a.pickupTime, b.pickupTime) &&
    sameNullableText(a.pickupPoint, b.pickupPoint)
  );
}

function looksLikeDistinctService(
  a: HistoricalDuplicateCandidateContext,
  b: HistoricalDuplicateCandidateContext,
): boolean {
  const sectionA = normalize(a.tourSection);
  const sectionB = normalize(b.tourSection);
  const notesA = normalize(a.notes);
  const notesB = normalize(b.notes);

  const serviceSignals = [
    "turk gecesi",
    "balon turu",
    "dervish show",
    "pamukkale",
    "pmk turu",
    "northern tour",
    "regular northern tour",
    "signature cave",
  ];

  const signalsFor = (section: string, notes: string): Set<string> => {
    const found = new Set<string>();

    for (const signal of serviceSignals) {
      if (section.includes(signal) || notes.includes(signal)) {
        found.add(signal);
      }
    }

    return found;
  };

  const signalsA = signalsFor(sectionA, notesA);
  const signalsB = signalsFor(sectionB, notesB);

  if (signalsA.size === 0 && signalsB.size === 0) {
    return false;
  }

  if (
    signalsA.size !== signalsB.size ||
    [...signalsA].some(signal => !signalsB.has(signal))
  ) {
    return true;
  }

  return false;
}

function looksLikeSupplementaryPair(
  a: HistoricalDuplicateCandidateContext,
  b: HistoricalDuplicateCandidateContext,
): boolean {
  if (!sameNullableText(a.tourSection, b.tourSection)) {
    return false;
  }

  if (!sameCore(a, b)) {
    return false;
  }

  const notesA = normalize(a.notes);
  const notesB = normalize(b.notes);

  if (notesA !== notesB) {
    return true;
  }

  return false;
}

function isExactRepeatedContent(
  a: HistoricalDuplicateCandidateContext,
  b: HistoricalDuplicateCandidateContext,
): boolean {
  return (
    sameCore(a, b) &&
    sameNullableText(a.language, b.language) &&
    sameNullableText(a.tourSection, b.tourSection) &&
    sameNullableText(a.notes, b.notes)
  );
}

export function classifyHistoricalDuplicateGroup(
  candidates: HistoricalDuplicateCandidateContext[],
): HistoricalDuplicateClassification {
  if (candidates.length !== 2) {
    return "AMBIGUOUS";
  }

  const [a, b] = candidates;

  if (!a || !b) {
    return "AMBIGUOUS";
  }

  if (!sameCore(a, b)) {
    return "AMBIGUOUS";
  }

  if (isExactRepeatedContent(a, b)) {
    return "REAL_DUPLICATE";
  }

  if (looksLikeDistinctService(a, b)) {
    return "SAME_BOOKING_DIFFERENT_SERVICE";
  }

  if (looksLikeSupplementaryPair(a, b)) {
    return "SAME_BOOKING_SUPPLEMENTARY_ROW";
  }

  return "AMBIGUOUS";
}
