/**
 * operation-assignment.ts — pure validation + conflict-detection logic for
 * Phase 2C canonical guide/driver resource assignment.
 *
 * No I/O: every function takes already-fetched rows and returns a plain
 * verdict, so this module is directly unit-testable the same way
 * lib/personnel-identity.ts is (see
 * scripts/canonical-operation-assignment-phase2c-focused-tests.mjs), and is
 * imported as-is by routes/field.ts's PATCH /operations/:id/assignments —
 * no logic is duplicated between the two.
 *
 * PERSON != LOGIN ACCOUNT (see resources.ts / personnel-identity.ts): this
 * module only ever validates/matches against `resources` rows (the
 * canonical GUIDE/DRIVER identity). It never reads or writes
 * assignedGuideUserId — that remains a completely separate login-access
 * fact, untouched by this phase (see docs/architecture note in
 * routes/field.ts for why the two must never be conflated).
 */

export type ResourceRole = "GUIDE" | "DRIVER";

export interface AssignableResource {
  id: number;
  type: string;
  active: boolean;
}

export type AssignmentValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: "resource_not_found" | "resource_type_mismatch" | "resource_inactive";
      error: string;
    };

/**
 * Validates that `resource` can be assigned into the given role.
 *
 * `resource` is `undefined`/`null` when the id the caller sent does not
 * exist in the resources table — the caller looks the row up itself and
 * passes whatever it found (or didn't); this function does no DB access.
 */
export function validateAssignmentCandidate(
  resource: AssignableResource | undefined | null,
  role: ResourceRole,
): AssignmentValidationResult {
  if (!resource) {
    return { ok: false, code: "resource_not_found", error: "Personel kaydı bulunamadı." };
  }
  if (resource.type !== role) {
    const wantedLabel = role === "GUIDE" ? "rehber" : "şoför";
    const actualLabel = resource.type === "GUIDE" ? "rehber" : resource.type === "DRIVER" ? "şoför" : resource.type;
    return {
      ok: false,
      code: "resource_type_mismatch",
      error: `Seçilen personel ${actualLabel} olarak kayıtlı; ${wantedLabel} olarak atanamaz.`,
    };
  }
  if (!resource.active) {
    return { ok: false, code: "resource_inactive", error: "Seçilen personel pasif durumda; atama yapılamaz." };
  }
  return { ok: true };
}

export interface OperationDateRange {
  id: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

// Mirrors the exact terminal-status set already excluded by the pre-existing
// assignedGuideUserId/vehiclePlate conflict checks in routes/field.ts.
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "archived"]);

/**
 * True when [aStart,aEnd] and [bStart,bEnd] (inclusive, comparable ISO date
 * strings) overlap. Same inequality already used by the pre-existing
 * assignedGuideUserId/vehiclePlate conflict checks in routes/field.ts's
 * PATCH /operations/:id/assignments (lte(startDate, other.endDate) &&
 * gte(endDate, other.startDate)) — not a new scheduling model.
 */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

export interface ConflictScanResult {
  /** Other operations proven (both sides have dates) to overlap `candidate`. */
  conflicts: OperationDateRange[];
  /**
   * Other operations sharing the resource where an overlap cannot be proven
   * because a date is missing on either side. Per the Phase 2C instruction
   * to "fail conservatively and surface a warning rather than fabricating
   * precision", these are never silently treated as non-conflicting.
   */
  indeterminate: OperationDateRange[];
}

/**
 * Conservative resource-conflict scan: does `candidate` overlap any
 * `others` row (the same resource already assigned there), excluding
 * terminal-status operations and the candidate's own row?
 */
export function scanResourceConflicts(
  candidate: OperationDateRange,
  others: OperationDateRange[],
): ConflictScanResult {
  const conflicts: OperationDateRange[] = [];
  const indeterminate: OperationDateRange[] = [];
  for (const other of others) {
    if (other.id === candidate.id) continue;
    if (TERMINAL_STATUSES.has(other.status)) continue;
    if (!candidate.startDate || !candidate.endDate || !other.startDate || !other.endDate) {
      indeterminate.push(other);
      continue;
    }
    if (rangesOverlap(candidate.startDate, candidate.endDate, other.startDate, other.endDate)) {
      conflicts.push(other);
    }
  }
  return { conflicts, indeterminate };
}

/**
 * Section 18 display-state classification, shared by the frontend read
 * surfaces (OperationDomainWorkspace) and available here so backend/tests
 * can assert the same three states without re-deriving the rule twice.
 */
export type AssignmentDisplayState = "CANONICAL" | "LEGACY_ONLY" | "UNASSIGNED";

export function classifyAssignmentState(resourceId: number | null | undefined, legacyName: string | null | undefined): AssignmentDisplayState {
  if (resourceId != null) return "CANONICAL";
  if (legacyName && legacyName.trim()) return "LEGACY_ONLY";
  return "UNASSIGNED";
}
