import { createHash } from "node:crypto";

/**
 * Phase 3H.4B — canonical customer identity substrate.
 *
 * Single source of truth for customer phone/email normalization and
 * deterministic identity-key derivation. The semantics below are exactly
 * the rules established by lib/historical-customer-projection.ts (which
 * now re-exports these functions, so existing behavior and tests are
 * unchanged); this module additionally owns the identity_key format and
 * the projection evidence hash used by the future 3H.4C canary.
 *
 * Identity rules (deliberate, no fuzzy matching, names never participate):
 * - email: trim + lowercase, must match a strict shape.
 * - phone: digits only, 7-15 digits, leading "+" preserved.
 * - identity_key: "email:<e>|phone:<p>" when both are valid,
 *   "email:<e>" for email-only, "phone:<p>" for phone-only, NULL otherwise.
 */

export const NORMALIZED_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeCustomerEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return NORMALIZED_EMAIL_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeCustomerPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

export function buildCustomerIdentityKey(params: {
  email: string | null | undefined;
  phone: string | null | undefined;
}): string | null {
  const email = normalizeCustomerEmail(params.email);
  const phone = normalizeCustomerPhone(params.phone);
  if (email && phone) return `email:${email}|phone:${phone}`;
  if (email) return `email:${email}`;
  if (phone) return `phone:${phone}`;
  return null;
}

/** Stable canonical JSON (sorted keys) for deterministic hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Lane multiplicity gate. Exactly one active row yields a deterministic
 * candidate; zero yields none; more than one is a conflict signal the
 * caller must surface, never a first-row pick.
 */
export function pickLaneCandidate(ids: number[]): { id: number | null; multiple: boolean } {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { id: null, multiple: false };
  if (unique.length === 1) return { id: unique[0], multiple: false };
  return { id: null, multiple: true };
}

export interface IdentityEvidenceBinding {
  sourceKey: string;
  historicalImportId: number;
  reservationId: number;
  operationId: number;
  sourceFileId: string;
  worksheetName: string;
  sourceRow: number;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  identityKey: string | null;
  action: "REUSE" | "CREATE";
}

/**
 * Deterministic hash binding source provenance + normalized identity +
 * target reservation + proposed action. A future APPLY revalidates this
 * hash under lock and fails closed (STALE_EVIDENCE) on any drift.
 */
export function identityEvidenceHash(binding: IdentityEvidenceBinding): string {
  return sha256Hex(canonicalJson({
    sourceKey: binding.sourceKey,
    historicalImportId: binding.historicalImportId,
    reservationId: binding.reservationId,
    operationId: binding.operationId,
    sourceFileId: binding.sourceFileId,
    worksheetName: binding.worksheetName,
    sourceRow: binding.sourceRow,
    normalizedEmail: binding.normalizedEmail,
    normalizedPhone: binding.normalizedPhone,
    identityKey: binding.identityKey,
    action: binding.action,
  }));
}
