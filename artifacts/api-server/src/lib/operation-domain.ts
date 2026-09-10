export const OPERATION_TYPES = ["CRUISE", "SEJOUR"] as const;
export type OperationType = typeof OPERATION_TYPES[number];
export type HistoricalSourceKind = "gemi" | "sejour";
export type FieldState = "BLOCKING" | "WARNING" | "NOT_APPLICABLE" | "PRESENT";

/** Fail closed: no ship/null-field inference and no fallback classification. */
export function operationTypeFromHistoricalSourceKind(sourceKind: string): OperationType | null {
  if (sourceKind === "gemi") return "CRUISE";
  if (sourceKind === "sejour") return "SEJOUR";
  return null;
}

export function cruiseFieldState(operationType: OperationType | null, value: unknown): FieldState {
  if (operationType === "SEJOUR") return "NOT_APPLICABLE";
  if (value !== null && value !== undefined && value !== "") return "PRESENT";
  return "WARNING";
}

export function pickupTimeFieldState(value: string | null, futureOrActive: boolean): FieldState {
  if (value) return "PRESENT";
  return futureOrActive ? "BLOCKING" : "WARNING";
}

const EXCEL_EPOCH_TIME = /^1899-12-30T([01]\d|2[0-3]):([0-5]\d):00\.000Z$/;
const LOCAL_CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Local-clock normalization: deliberately does not construct a Date. */
export function normalizeHistoricalPickupTime(value: string | null): string | null {
  if (value === null || LOCAL_CLOCK_TIME.test(value)) return value;
  const match = EXCEL_EPOCH_TIME.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}
