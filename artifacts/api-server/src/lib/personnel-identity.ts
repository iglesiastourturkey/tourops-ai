/**
 * Canonical Personnel/Guide identity — normalization and deterministic
 * matching (Phase 2D.1). See
 * docs/architecture/canonical-data-dictionary-v1-final.md (Sections B/C/F)
 * and docs/architecture/phase2d1-personnel-identity-foundation.md.
 *
 * Pure, dependency-free, no DB access. The matching function takes
 * already-fetched candidate rows so it stays directly unit-testable, the
 * same separation reservation-record-write.ts uses for
 * canTransitionReservationStatus/diffChangedFields.
 *
 * Core rule this module exists to enforce: identical or near-identical
 * names never auto-merge. This module only ever classifies; it never
 * writes, never creates a Resource, and never merges two identities.
 */

// ── Normalization ────────────────────────────────────────────────────────
//
// Turkish letters are hand-mapped to a plain-ASCII equivalent BEFORE any
// case folding, rather than relying on String.prototype.toLowerCase()'s
// locale-dependent behavior — the default (root-locale) lowercasing of
// "İ" (U+0130, LATIN CAPITAL LETTER I WITH DOT ABOVE) produces "i̇" (a
// combining-mark sequence), not a plain "i", which would silently break
// matching for exactly the kind of name this module exists to normalize.
// This map MUST stay in exact lock-step with the SQL backfill expression
// in lib/db/migrations/0025_resource_identity_foundation.sql.
const TURKISH_CHAR_MAP: Record<string, string> = {
  "İ": "i", "I": "i", "ı": "i", "i": "i",
  "Ş": "s", "ş": "s",
  "Ç": "c", "ç": "c",
  "Ğ": "g", "ğ": "g",
  "Ö": "o", "ö": "o",
  "Ü": "u", "ü": "u",
};

/**
 * Deterministic, whitespace/punctuation-insensitive normalized form of a
 * person's display name or an alias string. "KADIR SAHIN", "KADIRSAHIN",
 * and "Kadir Şahin" all normalize to "kadirsahin" by design — that is what
 * makes exact/alias matching useful at all. It does NOT mean two different
 * people who normalize identically are the same person; see
 * matchResourceIdentity() below, which always treats that case as
 * AMBIGUOUS, never as a match to pick automatically.
 */
export function normalizePersonName(raw: string | null | undefined): string {
  if (!raw) return "";
  let folded = "";
  for (const ch of raw) {
    folded += TURKISH_CHAR_MAP[ch] ?? ch.toLowerCase();
  }
  return folded.replace(/[^a-z0-9]/g, "");
}

// ── Matching ──────────────────────────────────────────────────────────────

export type IdentityMatchStatus = "EXACT_MATCH" | "ALIAS_MATCH" | "AMBIGUOUS" | "UNMATCHED";

export interface ResourceCandidateRow {
  id: number;
  normalizedName: string;
}

export interface AliasCandidateRow {
  resourceId: number;
  normalizedAlias: string;
}

export interface IdentityMatchCandidate {
  resourceId: number;
  via: "name" | "alias";
}

export interface IdentitySuggestion {
  resourceId: number;
  /** 0..1, higher is more similar. Informational only — never used to pick a match. */
  score: number;
}

export interface IdentityMatchResult {
  status: IdentityMatchStatus;
  normalizedInput: string;
  /** Set only when status is EXACT_MATCH or ALIAS_MATCH. */
  resourceId?: number;
  /** Set only when status is AMBIGUOUS — every candidate resource, never auto-picked. */
  candidates?: IdentityMatchCandidate[];
  /**
   * Set only when status is UNMATCHED and fuzzy suggestions were requested.
   * Suggestion metadata only — rule 4 (Section F of the architecture
   * document): fuzzy similarity may never produce MATCHED, ALIAS_MATCH, or
   * resolve an AMBIGUOUS case. No caller may treat a suggestion as a match.
   */
  suggestions?: IdentitySuggestion[];
}

export interface MatchResourceIdentityOptions {
  /** Default true. Set false to skip the fuzzy suggestion pass entirely (e.g. bulk import previews). */
  fuzzySuggestions?: boolean;
  /** Minimum similarity (0..1) for a suggestion to be included. Default 0.6. */
  suggestionThreshold?: number;
  /** Max number of suggestions returned. Default 3. */
  maxSuggestions?: number;
}

/**
 * Classifies a raw candidate name against already-fetched canonical
 * Resource rows and their aliases (both should already be scoped to the
 * relevant `type` — GUIDE or DRIVER — and to active resources, by the
 * caller's query; this function does not know about `type` or `active`).
 *
 * Rules enforced here (Section F of the architecture document):
 *   1. Exact normalized name -> a candidate.
 *   2. Exact alias -> a candidate.
 *   3. More than one distinct candidate resource across (1) and (2) ->
 *      AMBIGUOUS, every candidate listed, none picked automatically —
 *      including when every candidate came from an identical normalized
 *      name (two real, distinct people who happen to share a name).
 *   4. Fuzzy similarity may only ever produce `suggestions` metadata on an
 *      otherwise UNMATCHED result. It can never upgrade a result to
 *      EXACT_MATCH/ALIAS_MATCH and never resolves an AMBIGUOUS case.
 *   5. This function never creates a Resource and never merges identities
 *      — it only classifies.
 */
export function matchResourceIdentity(
  rawName: string,
  resources: ResourceCandidateRow[],
  aliases: AliasCandidateRow[],
  options: MatchResourceIdentityOptions = {},
): IdentityMatchResult {
  const normalizedInput = normalizePersonName(rawName);
  if (!normalizedInput) {
    return { status: "UNMATCHED", normalizedInput };
  }

  const nameMatchIds = new Set(resources.filter(r => r.normalizedName === normalizedInput).map(r => r.id));
  const aliasMatchIds = new Set(aliases.filter(a => a.normalizedAlias === normalizedInput).map(a => a.resourceId));

  const allIds = new Set<number>([...nameMatchIds, ...aliasMatchIds]);

  if (allIds.size === 0) {
    const fuzzySuggestions = options.fuzzySuggestions === false
      ? undefined
      : computeFuzzySuggestions(normalizedInput, resources, options);
    return {
      status: "UNMATCHED",
      normalizedInput,
      ...(fuzzySuggestions && fuzzySuggestions.length > 0 ? { suggestions: fuzzySuggestions } : {}),
    };
  }

  if (allIds.size > 1) {
    const candidates: IdentityMatchCandidate[] = [...allIds].map(id => ({
      resourceId: id,
      via: nameMatchIds.has(id) ? "name" : "alias",
    }));
    return { status: "AMBIGUOUS", normalizedInput, candidates };
  }

  const onlyId = [...allIds][0]!;
  return {
    status: nameMatchIds.has(onlyId) ? "EXACT_MATCH" : "ALIAS_MATCH",
    normalizedInput,
    resourceId: onlyId,
  };
}

function computeFuzzySuggestions(
  normalizedInput: string,
  resources: ResourceCandidateRow[],
  options: MatchResourceIdentityOptions,
): IdentitySuggestion[] {
  const threshold = options.suggestionThreshold ?? 0.6;
  const max = options.maxSuggestions ?? 3;
  return resources
    .map(r => ({ resourceId: r.id, score: similarityRatio(normalizedInput, r.normalizedName) }))
    .filter(s => s.score >= threshold && s.score < 1) // score 1 would mean an exact match, already handled above
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

// ── Deterministic string similarity (no ML, no external service) ────────
//
// Same "deterministic, no heuristic/AI-generated" philosophy as
// lib/daily-operations-model.ts's warning computation — this is plain
// Levenshtein edit-distance turned into a 0..1 ratio, nothing more.

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow.push(Math.min(
        previousRow[j]! + 1,
        currentRow[j - 1]! + 1,
        previousRow[j - 1]! + cost,
      ));
    }
    previousRow = currentRow;
  }
  return previousRow[b.length]!;
}

export function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}
