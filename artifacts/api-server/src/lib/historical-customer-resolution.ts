export type HistoricalCustomerResolutionKind =
  | "already_linked"
  | "exact_unique_name_candidate"
  | "ambiguous_exact_name"
  | "no_exact_name_candidate"
  | "invalid_or_blank_name";

export interface CustomerCandidate {
  id: number;
  name: string;
}

export interface HistoricalCustomerResolution {
  kind: HistoricalCustomerResolutionKind;
  normalizedHistoricalName: string | null;
  candidates: CustomerCandidate[];
}

export function normalizeHistoricalCustomerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function classifyHistoricalCustomerResolution(params: {
  historicalName: unknown;
  operationCustomerId: number | null;
  candidatesByNormalizedName: ReadonlyMap<string, readonly CustomerCandidate[]>;
}): HistoricalCustomerResolution {
  if (params.operationCustomerId !== null) {
    return {
      kind: "already_linked",
      normalizedHistoricalName: normalizeHistoricalCustomerName(params.historicalName),
      candidates: [],
    };
  }

  const normalizedHistoricalName = normalizeHistoricalCustomerName(params.historicalName);
  if (normalizedHistoricalName === null) {
    return { kind: "invalid_or_blank_name", normalizedHistoricalName: null, candidates: [] };
  }

  const candidates = [...(params.candidatesByNormalizedName.get(normalizedHistoricalName) ?? [])];
  if (candidates.length === 1) {
    return { kind: "exact_unique_name_candidate", normalizedHistoricalName, candidates };
  }
  if (candidates.length > 1) {
    return { kind: "ambiguous_exact_name", normalizedHistoricalName, candidates };
  }
  return { kind: "no_exact_name_candidate", normalizedHistoricalName, candidates: [] };
}
