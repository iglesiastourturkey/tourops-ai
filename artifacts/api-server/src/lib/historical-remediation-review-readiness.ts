/**
 * Faz 3E.4: pure review-readiness derivation for the historical remediation
 * queue. DB-free on purpose — safe to unit test without a connection.
 *
 * Derived states are NOT persisted and the historical_operation_imports
 * status enum/state machine is untouched:
 *   READY_FOR_REVIEW = status is pending AND none of the five blocking
 *                      warnings remain (residual missing_agency /
 *                      missing_child_count may remain).
 *   UNRESOLVED       = everything else (pending with >=1 blocking warning,
 *                      any unknown warning outside the closed warning
 *                      universe — fail closed — and any non-pending status,
 *                      which is never READY_FOR_REVIEW).
 *
 * The blocking set mirrors REMEDIATION_WARNING_BY_FIELD
 * (historical-remediation-mutation-validation.ts): exactly the warnings the
 * Phase 3E.2 mutation engine can clear, one field at a time. No inference,
 * no autofill, no canonical mapping, no evidence reads here.
 */

import type { HistoricalRemediationState } from "./historical-remediation-read";

export const HISTORICAL_REMEDIATION_BLOCKING_WARNINGS = [
  "missing_pickup_time",
  "missing_language",
  "missing_pickup_point",
  "missing_adult_count",
  "missing_operator",
] as const;

export type HistoricalRemediationBlockingWarning =
  typeof HISTORICAL_REMEDIATION_BLOCKING_WARNINGS[number];

const BLOCKING = new Set<string>(HISTORICAL_REMEDIATION_BLOCKING_WARNINGS);

const RESIDUAL = new Set(["missing_agency", "missing_child_count"]);

export function isHistoricalRemediationBlockingWarning(
  warning: string,
): warning is HistoricalRemediationBlockingWarning {
  return BLOCKING.has(warning);
}

export function blockingWarningsOf(warnings: readonly string[]): string[] {
  return warnings.filter(isHistoricalRemediationBlockingWarning);
}

export function deriveHistoricalReviewReadiness(
  status: string,
  warnings: readonly string[],
): HistoricalRemediationState {
  if (status !== "pending") return "UNRESOLVED";
  if (warnings.some(warning => BLOCKING.has(warning))) return "UNRESOLVED";
  // Closed warning universe is {blocking} ∪ {residual}. Anything else fails
  // closed instead of silently counting as review-ready.
  if (warnings.some(warning => !BLOCKING.has(warning) && !RESIDUAL.has(warning))) {
    return "UNRESOLVED";
  }
  return "READY_FOR_REVIEW";
}
