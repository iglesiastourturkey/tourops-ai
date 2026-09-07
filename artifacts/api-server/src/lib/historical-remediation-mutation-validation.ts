import type { HistoricalStagingRecord } from "./historical-migration-stage-validation";

export const REMEDIATION_FIELDS = [
  "pickupTime",
  "passengerLanguage",
  "pickupPoint",
  "adultCount",
  "externalOperator",
] as const;

export type HistoricalRemediationField = typeof REMEDIATION_FIELDS[number];

export function isHistoricalRemediationField(value: unknown): value is HistoricalRemediationField {
  return typeof value === "string" && (REMEDIATION_FIELDS as readonly string[]).includes(value);
}

export const REMEDIATION_WARNING_BY_FIELD: Record<HistoricalRemediationField, string> = {
  pickupTime: "missing_pickup_time",
  passengerLanguage: "missing_language",
  pickupPoint: "missing_pickup_point",
  adultCount: "missing_adult_count",
  externalOperator: "missing_operator",
};

export type RemediationValue = string | number;

export function validateRemediationValue(
  field: HistoricalRemediationField,
  value: unknown,
): RemediationValue {
  if (field === "adultCount") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 99) {
      throw new Error("adultCount must be an integer from 1 through 99");
    }
    return value;
  }

  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be blank`);

  if (field === "pickupTime" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
    throw new Error("pickupTime must use canonical HH:mm format");
  }
  if (field === "pickupPoint" && trimmed.length > 120) {
    throw new Error("pickupPoint must be at most 120 characters");
  }
  return trimmed;
}

export function getHistoricalRemediationValue(
  payload: HistoricalStagingRecord,
  field: HistoricalRemediationField,
): string | number | null {
  switch (field) {
    case "pickupTime": return payload.operation.pickupTime;
    case "passengerLanguage": return payload.reservationDetails.passengerLanguage;
    case "pickupPoint": return payload.reservationDetails.pickupPoint;
    case "adultCount": return payload.reservationDetails.adultCount;
    case "externalOperator": return payload.reservationDetails.externalOperator;
  }
}

export function applyHistoricalRemediationValue(
  payload: HistoricalStagingRecord,
  field: HistoricalRemediationField,
  value: RemediationValue,
): HistoricalStagingRecord {
  if (field === "pickupTime") {
    return { ...payload, operation: { ...payload.operation, pickupTime: value as string } };
  }
  return {
    ...payload,
    reservationDetails: {
      ...payload.reservationDetails,
      [field]: value,
    },
  };
}
