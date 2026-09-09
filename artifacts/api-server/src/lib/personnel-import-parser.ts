/**
 * Personnel Master Data Import / Matching Foundation (Phase 2D.3).
 *
 * Deterministic analyzer for PERFORMANS RAPORU-2026.xlsx.
 * Extracts sheet candidates, classifies against canonical resources/aliases
 * using Phase 2D.1 identity matching, flags ambiguities and special cases (ESMA),
 * and produces a replayable, human-reviewable approval package.
 *
 * Rules:
 * - Pure/auditable logic: zero live DB writes.
 * - Identity is resources.id, never a sheet name or fuzzy suggestion.
 * - ESMA is strictly REVIEW_REQUIRED, never auto-promoted.
 * - Cell/row contents are NEVER treated as personnel identities.
 * - Templates (ORNEK/TEMPLATE) are excluded from candidate proposals.
 * - Deterministic SHA-256 fingerprinting prevents silent source drift.
 */
import { createHash } from "node:crypto";
import type ExcelJS from "exceljs";
import {
  normalizePersonName,
  matchResourceIdentity,
  type ResourceCandidateRow,
  type AliasCandidateRow,
  type IdentityMatchStatus,
  type IdentityMatchCandidate,
  type IdentitySuggestion,
} from "./personnel-identity";

/**
 * Phase 2D.3 business-rule correction (operator-confirmed, see
 * docs/architecture/phase2d3-personnel-master-import.md Section 7):
 *
 *  - A sheet name being a single word (a mononym, surname-only, or a
 *    concatenated first+surname form) is NEVER by itself a reason to
 *    require review. Workbook names are intentional operational
 *    identifiers and must be preserved exactly as source identity
 *    evidence — there is deliberately no word-count-based rule anywhere
 *    in this module.
 *  - ESMA and TAYLAN are known, confirmed NON_GUIDE_PERSONNEL business
 *    roles (operations and accounting staff respectively), never guide
 *    identities — see isEsmaSpecialCase / isTaylanSpecialCase below.
 *  - Cross-sheet identity ambiguity is production-safe by construction:
 *    the ONLY things that can force REVIEW_TRUE_IDENTITY_AMBIGUITY are
 *    (a) matchResourceIdentity's own AMBIGUOUS status (a name/alias
 *    genuinely maps to >1 canonical resource) and (b) an explicit,
 *    caller-supplied "human review rule" (never a hard-coded list in
 *    this file). Mononym status and same-workbook substring/fuzzy
 *    similarity NEVER force review on their own — similarity is
 *    surfaced only as an informational note (see
 *    computeSameWorkbookSimilarityNotes) that a human can act on.
 */
export type BusinessBucket =
  | "CLEAN_GUIDE_CANDIDATE"
  | "REVIEW_TRUE_IDENTITY_AMBIGUITY"
  | "REVIEW_UNKNOWN_CODE_OR_IDENTITY"
  | "NON_GUIDE_PERSONNEL"
  | "GUIDE_NAME_DISPLAY_REVIEW";

export type BusinessRole = "OPERATIONS_PERSONNEL" | "ACCOUNTING_PERSONNEL";

/** Only reason today: resources.type supports GUIDE/DRIVER only (see lib/db/schema/resources.ts). */
export type CanonicalResourceStatus = "DEFER_TYPE_UNSUPPORTED";

export const KNOWN_TEMPLATE_NORMALIZED_NAMES = new Set([
  "ornek",
  "orneksablon",
  "sablon",
  "template",
]);

export interface DiscoveredSheetSummary {
  sheetIndex: number;
  rawSheetName: string;
  normalizedSheetName: string;
  isTemplate: boolean;
  isEsmaSpecialCase: boolean;
  isTaylanSpecialCase: boolean;
  totalRows: number;
  dataRowCount: number;
  esmaObservationCount: number;
  footerOrKpiRowsExcluded: number;
  sheetFingerprint: string;
  notes: string[];
}

export interface NormalizedNameCollision {
  normalizedName: string;
  rawNames: string[];
  sheetIndexes: number[];
}

export interface IdentityAmbiguityGroup {
  /** All normalized sheet names in this group (2 or more). */
  normalizedNames: string[];
  rawNames: string[];
  sheetIndexes: number[];
  /**
   * How this group was formed. This is ALWAYS "HUMAN_SUPPLIED_GROUP" —
   * there is no algorithmic/automatic path that can put a group here.
   * See discoverPersonnelWorkbook's `humanSuppliedAmbiguityGroups` option.
   */
  basis: "HUMAN_SUPPLIED_GROUP";
}

export interface SameWorkbookSimilarityNote {
  normalizedName: string;
  rawName: string;
  sheetIndex: number;
  /** Always informational — never used to change matchStatus, category, or businessBucket. */
  basis: "INFORMATIONAL_SUGGESTION";
}

export interface DiscoveredPersonnelWorkbook {
  sourceFilename: string;
  workbookFingerprint: string;
  workbookSha256: string;
  totalSheetCount: number;
  templateSheetCount: number;
  candidateSheetCount: number;
  totalHistoricalDataRows: number;
  sheetsWithZeroDataRows: number;
  invalidOrBlankSheetNames: number;
  totalRowLevelEsmaObservations: number;
  totalFooterOrKpiRowsExcluded: number;
  normalizedNameCollisions: NormalizedNameCollision[];
  /** Populated ONLY from the caller-supplied `humanSuppliedAmbiguityGroups` option — never inferred. */
  sheetIdentityAmbiguityGroups: IdentityAmbiguityGroup[];
  sheets: DiscoveredSheetSummary[];
}

export type ProposalCategory =
  | "SAFE_EXISTING_MATCH"
  | "REVIEW_REQUIRED"
  | "PROPOSED_NEW_RESOURCE";

export interface PersonnelImportProposal {
  sourceWorkbook: string;
  sourceWorkbookSha256: string;
  sourceSheet: string;
  sheetIndex: number;
  rawName: string;
  normalizedName: string;
  dataRowCount: number;
  proposedType: "GUIDE" | "REVIEW_REQUIRED";
  category: ProposalCategory;
  matchStatus: IdentityMatchStatus;
  matchedResourceId: number | null;
  candidates?: IdentityMatchCandidate[];
  suggestions: Array<{
    resourceId: number;
    displayName?: string;
    score: number;
    reason?: string;
  }>;
  /**
   * Same-workbook name-similarity hints (e.g. "gokbora" inside
   * "ermangokbora"). Purely INFORMATIONAL_SUGGESTION — never auto-match,
   * never auto-merge, never changes matchStatus/category/businessBucket.
   * Always present (empty array when there is nothing to note).
   */
  sameWorkbookSimilarityNotes: SameWorkbookSimilarityNote[];
  reason: string;
  sourceFingerprint: string;
  historicalRowCount: number;
  /** Human-facing business classification (Phase 2D.3 correction) — orthogonal to `category`, never changes matchedResourceId. */
  businessBucket: BusinessBucket;
  /** Set only when businessBucket is NON_GUIDE_PERSONNEL. */
  businessRole?: BusinessRole;
  /** Set only when a NON_GUIDE_PERSONNEL role can't yet become a canonical resource (resources.type is GUIDE/DRIVER only). */
  canonicalResourceStatus?: CanonicalResourceStatus;
}

export type HumanApprovalActionType =
  | "MATCH_EXISTING_RESOURCE"
  | "CREATE_NEW_RESOURCE"
  | "ADD_ALIAS"
  | "REJECT"
  | "DEFER";

export interface HumanApprovalDecision {
  sourceFingerprint: string;
  rawName: string;
  action: HumanApprovalActionType;
  targetResourceId?: number;
  newResourceData?: {
    name: string;
    type: "GUIDE" | "DRIVER";
    email?: string;
    phone?: string;
    licenseNumber?: string;
  };
  aliasData?: {
    targetResourceId: number;
    alias: string;
    source: "PERFORMANCE_2026";
  };
  reason?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface PersonnelImportPlan {
  version: 1;
  mode: "personnel-master-import-plan";
  sourceWorkbook: string;
  workbookFingerprint: string;
  workbookSha256: string;
  createdAt: string;
  summary: {
    totalSheets: number;
    templateSheets: number;
    candidateSheets: number;
    totalHistoricalDataRows: number;
    sheetsWithZeroDataRows: number;
    invalidOrBlankSheetNames: number;
    totalRowLevelEsmaObservations: number;
    safeExistingMatches: number;
    reviewRequired: number;
    proposedNewResources: number;
    ambiguousCount: number;
    unmatchedCount: number;
    esmaCount: number;
    taylanCount: number;
    cleanGuideCandidateCount: number;
    reviewTrueIdentityAmbiguityCount: number;
    reviewUnknownCodeOrIdentityCount: number;
    nonGuidePersonnelCount: number;
    guideNameDisplayReviewCount: number;
    totalFooterOrKpiRowsExcluded: number;
    normalizedNameCollisions: NormalizedNameCollision[];
    sheetIdentityAmbiguityGroups: IdentityAmbiguityGroup[];
  };
  proposals: PersonnelImportProposal[];
}

export function computeSha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function isTemplateSheetName(rawName: string): boolean {
  const norm = normalizePersonName(rawName);
  if (!norm) return true; // empty / invalid is not a valid candidate
  if (KNOWN_TEMPLATE_NORMALIZED_NAMES.has(norm)) return true;
  if (norm.startsWith("ornek") || norm.startsWith("sablon") || norm.startsWith("template")) return true;
  return false;
}

export function isEsmaSpecialCase(rawName: string): boolean {
  const norm = normalizePersonName(rawName);
  return norm === "esma" || norm.startsWith("esma") || norm.endsWith("esma");
}

/**
 * TAYLAN is a confirmed ACCOUNTING_PERSONNEL business role (operator
 * confirmation, Phase 2D.3), never a guide identity. Unlike ESMA this is
 * an exact-match check only — TAYLAN is one specific, known worksheet,
 * not a text pattern that can appear as a prefix/suffix of unrelated names.
 */
export function isTaylanSpecialCase(rawName: string): boolean {
  return normalizePersonName(rawName) === "taylan";
}

/**
 * A sheet name carrying a Turkish honorific (HANIM/BEY) or a trailing
 * single-letter surname abbreviation (e.g. "BAHAR K.") is still a valid
 * guide identity candidate — it must NOT be auto-rejected. This flag is
 * purely informational (businessBucket on the proposal) so a human
 * reviewer can optionally confirm the canonical display name; it never
 * changes the proposal's category or matchedResourceId.
 */
export function hasHonorificOrAbbreviation(rawName: string): boolean {
  const words = rawName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.some(w => {
    const n = normalizePersonName(w);
    return n === "hanim" || n === "bey";
  })) {
    return true;
  }
  if (words.length >= 2) {
    const last = words[words.length - 1]!.replace(/\.$/, "");
    if (/^[A-Za-zÇĞİIÖŞÜçğıiöşü]$/.test(last)) return true;
  }
  return false;
}

/**
 * Conservative, deliberately narrow heuristic for "genuinely unclear,
 * code-like identifier" (e.g. an unexplained "FF" — confirmed present as
 * a real worksheet name in PERFORMANS RAPORU-2026.xlsx). Real Turkish
 * given names/mononyms are essentially never this short, so a normalized
 * length of 1-2 characters is used as the sole signal. This is
 * intentionally NOT a word-count/mononym rule — a full one-word name
 * like "FATMA" or "ALI" normalizes to 3+ characters and is unaffected.
 * Every hit still requires human review rather than being rejected.
 */
export function looksLikeUnknownCodeIdentity(normalizedName: string): boolean {
  return normalizedName.length > 0 && normalizedName.length <= 2;
}

/**
 * Same-workbook substring-containment check (e.g. "gokbora" inside
 * "ermangokbora"). Phase 2D.3 safety correction: this is
 * INFORMATIONAL_SUGGESTION ONLY. It must NEVER be promoted to
 * REVIEW_REQUIRED / REVIEW_TRUE_IDENTITY_AMBIGUITY on its own — a short
 * name being a substring of a longer one (e.g. "ALI" inside
 * "MEHMET ALI") is common and not evidence of shared identity. A 4-
 * character floor avoids near-universal trivial matches on very short
 * names. The only way two sheets can be forced into REVIEW_REQUIRED for
 * identity ambiguity is matchResourceIdentity's own AMBIGUOUS status or
 * an explicit human-supplied review rule (see
 * discoverPersonnelWorkbook's `humanSuppliedAmbiguityGroups` option).
 */
export function computeSameWorkbookSimilarityNotes(
  sheet: { normalizedSheetName: string; sheetIndex: number },
  candidateSheets: Array<{ rawSheetName: string; normalizedSheetName: string; sheetIndex: number }>,
): SameWorkbookSimilarityNote[] {
  if (sheet.normalizedSheetName.length < 4) return [];
  const notes: SameWorkbookSimilarityNote[] = [];
  for (const other of candidateSheets) {
    if (other.sheetIndex === sheet.sheetIndex) continue;
    if (other.normalizedSheetName === sheet.normalizedSheetName) continue; // exact collisions are normalizedNameCollisions, not this
    if (other.normalizedSheetName.length < 4) continue;
    const contains =
      sheet.normalizedSheetName.includes(other.normalizedSheetName) ||
      other.normalizedSheetName.includes(sheet.normalizedSheetName);
    if (!contains) continue;
    notes.push({
      normalizedName: other.normalizedSheetName,
      rawName: other.rawSheetName,
      sheetIndex: other.sheetIndex,
      basis: "INFORMATIONAL_SUGGESTION",
    });
  }
  return notes;
}

/**
 * Builds IdentityAmbiguityGroup entries STRICTLY from operator/human-
 * supplied groups (see discoverPersonnelWorkbook's
 * `humanSuppliedAmbiguityGroups` option). There is deliberately no
 * hard-coded list and no algorithmic (substring/fuzzy) path into this
 * function's output — "GOKBORA"/"ERMAN GOKBORA" and
 * "NAZMICAN"/"NAZMI TARAKCI"/"NAZIM BAHADIR" are NOT confirmed the same
 * people; they are examples requiring human review, not production
 * truth, and are used only as explicit test fixtures (see
 * personnel-master-import-self-test.ts), never referenced from this
 * file. A caller (a human reviewer, a future approval UI, or a test)
 * must explicitly pass a group for it to ever appear here.
 */
export function detectSheetIdentityAmbiguityGroups(
  candidateSheets: Array<{ rawSheetName: string; normalizedSheetName: string; sheetIndex: number }>,
  humanSuppliedGroups: string[][] = [],
): IdentityAmbiguityGroup[] {
  const groups: IdentityAmbiguityGroup[] = [];

  for (const humanGroup of humanSuppliedGroups) {
    const normalizedTargets = new Set(humanGroup.map(n => normalizePersonName(n)).filter(Boolean));
    const present = candidateSheets.filter(s => normalizedTargets.has(s.normalizedSheetName));
    if (present.length >= 2) {
      groups.push({
        normalizedNames: [...new Set(present.map(s => s.normalizedSheetName))],
        rawNames: present.map(s => s.rawSheetName),
        sheetIndexes: present.map(s => s.sheetIndex),
        basis: "HUMAN_SUPPLIED_GROUP",
      });
    }
  }

  return groups;
}

/**
 * Checks cell value text for ESMA mentions purely for provenance/evidence counting.
 * NEVER extracts cell values as candidate personnel identities.
 */
function countEsmaOccurrencesInRow(row: ExcelJS.Row): number {
  let count = 0;
  row.eachCell({ includeEmpty: false }, cell => {
    const val = String(cell.value ?? "");
    if (/\besma\b/i.test(val)) {
      count += 1;
    }
  });
  return count;
}

/**
 * Footer/KPI/grand-total rows must never be counted as historical tour
 * rows. This ONLY affects the data-row counter — it never reads a row's
 * contents for any other purpose, never rewrites a cell, and never
 * removes a sheet. This vocabulary was verified directly against the
 * real PERFORMANS RAPORU-2026.xlsx footer block, which (after the
 * per-guide data rows) always ends with, in order: TOPLAM, TUR SAYISI,
 * PAX, YORUM %, BILET SATISI %, YEMEK SATISI %, TUR/HALI %, TUR/DERI %.
 * Matching is whole-cell (after Turkish-fold + alnum-only normalization,
 * which also strips "%" and "/"), so a normal data cell is never
 * mistaken for a footer label.
 */
const FOOTER_OR_KPI_ROW_KEYWORDS = new Set([
  "toplam",
  "geneltoplam",
  "aratoplam",
  "ozet",
  "kpi",
  "tursayisi",
  "pax",
  "yorum",
  "biletsatisi",
  "yemeksatisi",
  "turhali",
  "turderi",
]);

function isFooterOrKpiRow(row: ExcelJS.Row): boolean {
  let isFooter = false;
  row.eachCell({ includeEmpty: false }, cell => {
    const val = normalizePersonName(String(cell.value ?? ""));
    if (val && FOOTER_OR_KPI_ROW_KEYWORDS.has(val)) {
      isFooter = true;
    }
  });
  return isFooter;
}

/**
 * Parses an ExcelJS workbook and produces a deterministic discovery summary.
 */
export function discoverPersonnelWorkbook(
  workbook: ExcelJS.Workbook,
  options: {
    sourceFilename?: string;
    workbookFingerprint?: string;
    workbookSha256?: string;
    /**
     * Explicit, human-supplied groups of RAW sheet names that a reviewer
     * has confirmed may be the same person (e.g. `[["GOKBORA", "ERMAN
     * GOKBORA"]]`). Defaults to none. This is the ONLY way a
     * cross-sheet pairing can ever produce REVIEW_TRUE_IDENTITY_AMBIGUITY
     * — there is no built-in/hard-coded list and no algorithmic
     * (substring/fuzzy) promotion path.
     */
    humanSuppliedAmbiguityGroups?: string[][];
  } = {},
): DiscoveredPersonnelWorkbook {
  const sourceFilename = options.sourceFilename ?? "PERFORMANS RAPORU-2026.xlsx";
  const sheets: DiscoveredSheetSummary[] = [];

  let sheetIndex = 0;
  let totalHistoricalDataRows = 0;
  let sheetsWithZeroDataRows = 0;
  let invalidOrBlankSheetNames = 0;
  let totalRowLevelEsmaObservations = 0;
  let totalFooterOrKpiRowsExcluded = 0;

  for (const worksheet of workbook.worksheets) {
    sheetIndex += 1;
    // NEVER trimmed — the raw sheet name is source identity evidence and
    // must be preserved exactly as it appears in the workbook, incidental
    // leading/trailing whitespace included (e.g. the real workbook has a
    // sheet literally named "CEYLA " with a trailing space). Matching
    // still works correctly because normalizePersonName() strips all
    // whitespace anyway; only the *stored* rawSheetName is affected.
    const rawSheetName = worksheet.name ?? "";
    const normalizedSheetName = normalizePersonName(rawSheetName);
    const isTemplate = isTemplateSheetName(rawSheetName);
    const isEsma = isEsmaSpecialCase(rawSheetName);
    const isTaylan = isTaylanSpecialCase(rawSheetName);

    let totalRows = 0;
    let dataRowCount = 0;
    let esmaObservationCount = 0;
    let footerOrKpiRowsExcluded = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      totalRows += 1;
      // Heuristic row counting for evidence: skip row 1 if header-like,
      // and skip footer/KPI/summary rows (e.g. "TOPLAM" / grand-total
      // rows) so they are never counted as historical tour rows. This
      // ONLY affects the count — the row's own cell values are never
      // read for any other purpose, rewritten, or discarded; raw
      // workbook content is untouched.
      if (rowNumber > 1 && row.actualCellCount > 0) {
        if (isFooterOrKpiRow(row)) {
          footerOrKpiRowsExcluded += 1;
        } else {
          dataRowCount += 1;
        }
      }
      esmaObservationCount += countEsmaOccurrencesInRow(row);
    });

    totalHistoricalDataRows += dataRowCount;
    totalRowLevelEsmaObservations += esmaObservationCount;
    totalFooterOrKpiRowsExcluded += footerOrKpiRowsExcluded;

    if (dataRowCount === 0 && !isTemplate) {
      sheetsWithZeroDataRows += 1;
    }

    const notes: string[] = [];
    if (!rawSheetName.trim()) {
      invalidOrBlankSheetNames += 1;
      notes.push("BLANK_SHEET_NAME");
    }
    if (isTemplate) {
      notes.push("TEMPLATE_SHEET_EXCLUDED");
    }
    if (isEsma) {
      notes.push("ESMA_SPECIAL_CASE_REVIEW_REQUIRED");
    }
    if (isTaylan) {
      notes.push("TAYLAN_SPECIAL_CASE_ACCOUNTING_PERSONNEL");
    }
    if (esmaObservationCount > 0) {
      notes.push(`ROW_LEVEL_ESMA_OBSERVED_${esmaObservationCount}`);
    }
    if (footerOrKpiRowsExcluded > 0) {
      notes.push(`FOOTER_OR_KPI_ROWS_EXCLUDED_${footerOrKpiRowsExcluded}`);
    }

    const sheetFingerprint = computeSha256(
      `${sourceFilename}::${sheetIndex}::${rawSheetName}::${normalizedSheetName}::${dataRowCount}`,
    );

    sheets.push({
      sheetIndex,
      rawSheetName,
      normalizedSheetName,
      isTemplate,
      isEsmaSpecialCase: isEsma,
      isTaylanSpecialCase: isTaylan,
      totalRows,
      dataRowCount,
      esmaObservationCount,
      footerOrKpiRowsExcluded,
      sheetFingerprint,
      notes,
    });
  }

  const templateSheetCount = sheets.filter(s => s.isTemplate).length;
  const candidateSheetList = sheets.filter(s => !s.isTemplate && Boolean(s.normalizedSheetName));
  const candidateSheetCount = candidateSheetList.length;

  // Detect normalized-name collisions among sheet candidates
  const normalizedGroups = new Map<string, Array<{ raw: string; index: number }>>();
  for (const c of candidateSheetList) {
    const list = normalizedGroups.get(c.normalizedSheetName) ?? [];
    list.push({ raw: c.rawSheetName, index: c.sheetIndex });
    normalizedGroups.set(c.normalizedSheetName, list);
  }

  const normalizedNameCollisions: NormalizedNameCollision[] = [];
  for (const [norm, items] of normalizedGroups.entries()) {
    if (items.length > 1) {
      normalizedNameCollisions.push({
        normalizedName: norm,
        rawNames: items.map(i => i.raw),
        sheetIndexes: items.map(i => i.index),
      });
    }
  }

  const sheetIdentityAmbiguityGroups = detectSheetIdentityAmbiguityGroups(
    candidateSheetList.map(s => ({ rawSheetName: s.rawSheetName, normalizedSheetName: s.normalizedSheetName, sheetIndex: s.sheetIndex })),
    options.humanSuppliedAmbiguityGroups ?? [],
  );

  // If workbookFingerprint not supplied, derive from combined sheet fingerprints
  const workbookFingerprint =
    options.workbookFingerprint ??
    computeSha256(sheets.map(s => s.sheetFingerprint).join("||"));

  const workbookSha256 = options.workbookSha256 ?? workbookFingerprint;

  return {
    sourceFilename,
    workbookFingerprint,
    workbookSha256,
    totalSheetCount: sheets.length,
    templateSheetCount,
    candidateSheetCount,
    totalHistoricalDataRows,
    sheetsWithZeroDataRows,
    invalidOrBlankSheetNames,
    totalRowLevelEsmaObservations,
    totalFooterOrKpiRowsExcluded,
    normalizedNameCollisions,
    sheetIdentityAmbiguityGroups,
    sheets,
  };
}

/**
 * Builds the import/matching plan comparing discovered sheets with canonical resources & aliases.
 */
export function buildPersonnelMasterImportPlan(
  discovery: DiscoveredPersonnelWorkbook,
  resources: ResourceCandidateRow[],
  aliases: AliasCandidateRow[],
  options: {
    resourceMetadata?: Map<number, { name: string; type?: string }>;
    timestamp?: string;
  } = {},
): PersonnelImportPlan {
  const proposals: PersonnelImportProposal[] = [];

  const ambiguityGroupByNormalizedName = new Map<string, IdentityAmbiguityGroup>();
  for (const group of discovery.sheetIdentityAmbiguityGroups) {
    for (const n of group.normalizedNames) {
      ambiguityGroupByNormalizedName.set(n, group);
    }
  }

  const candidateSheetRefs = discovery.sheets
    .filter(s => !s.isTemplate && Boolean(s.normalizedSheetName))
    .map(s => ({ rawSheetName: s.rawSheetName, normalizedSheetName: s.normalizedSheetName, sheetIndex: s.sheetIndex }));

  const buildSuggestions = (matchResult: ReturnType<typeof matchResourceIdentity>) =>
    (matchResult.suggestions ?? []).map(s => ({
      resourceId: s.resourceId,
      displayName: options.resourceMetadata?.get(s.resourceId)?.name,
      score: s.score,
      reason: "Fuzzy similarity suggestion (informational only)",
    }));

  for (const sheet of discovery.sheets) {
    // Template sheets are strictly excluded from proposed imports
    if (sheet.isTemplate || !sheet.normalizedSheetName) {
      continue;
    }

    const matchResult = matchResourceIdentity(
      sheet.rawSheetName,
      resources,
      aliases,
      { fuzzySuggestions: true, suggestionThreshold: 0.6, maxSuggestions: 3 },
    );

    const sameWorkbookSimilarityNotes = computeSameWorkbookSimilarityNotes(
      { normalizedSheetName: sheet.normalizedSheetName, sheetIndex: sheet.sheetIndex },
      candidateSheetRefs,
    );

    const sourceFingerprint = sheet.sheetFingerprint;
    const base = {
      sourceWorkbook: discovery.sourceFilename,
      sourceWorkbookSha256: discovery.workbookSha256,
      sourceSheet: sheet.rawSheetName,
      sheetIndex: sheet.sheetIndex,
      rawName: sheet.rawSheetName,
      normalizedName: sheet.normalizedSheetName,
      dataRowCount: sheet.dataRowCount,
      sameWorkbookSimilarityNotes,
      sourceFingerprint,
      historicalRowCount: sheet.dataRowCount,
    };

    // ESMA rule: confirmed NON_GUIDE_PERSONNEL (operations personnel). MUST
    // remain REVIEW_REQUIRED and never automatically promoted/accepted as
    // a guide, and no resource is created for it in this phase. This only
    // fires for an actual ESMA worksheet — row-level ESMA mentions inside
    // another sheet never manufacture an ESMA candidate (see
    // countEsmaOccurrencesInRow, which is evidence-counting only).
    if (sheet.isEsmaSpecialCase) {
      proposals.push({
        ...base,
        proposedType: "REVIEW_REQUIRED",
        category: "REVIEW_REQUIRED",
        matchStatus: matchResult.status,
        matchedResourceId: null, // never auto-linked
        candidates: matchResult.candidates,
        suggestions: buildSuggestions(matchResult),
        reason:
          "ESMA business meaning is confirmed as OPERATIONS_PERSONNEL, not a guide identity. " +
          "Row-level evidence is preserved for future operations/personnel-domain mapping; no resource is created in this phase.",
        businessBucket: "NON_GUIDE_PERSONNEL",
        businessRole: "OPERATIONS_PERSONNEL",
      });
      continue;
    }

    // TAYLAN rule: confirmed NON_GUIDE_PERSONNEL (accounting personnel).
    // resources.type only supports GUIDE/DRIVER today, so canonical
    // resource creation is deferred until that model is widened — this
    // phase never creates or proposes a resource for it.
    if (sheet.isTaylanSpecialCase) {
      proposals.push({
        ...base,
        proposedType: "REVIEW_REQUIRED",
        category: "REVIEW_REQUIRED",
        matchStatus: matchResult.status,
        matchedResourceId: null,
        candidates: matchResult.candidates,
        suggestions: buildSuggestions(matchResult),
        reason:
          "TAYLAN business meaning is confirmed as ACCOUNTING_PERSONNEL, not a guide identity. " +
          "resources.type currently supports GUIDE/DRIVER only, so canonical resource creation is deferred " +
          "pending a future personnel-type model widening; the worksheet/history is preserved, not discarded.",
        businessBucket: "NON_GUIDE_PERSONNEL",
        businessRole: "ACCOUNTING_PERSONNEL",
        canonicalResourceStatus: "DEFER_TYPE_UNSUPPORTED",
      });
      continue;
    }

    // Production ambiguity comes ONLY from matchResourceIdentity's own
    // AMBIGUOUS status (same normalized identity or alias mapping to
    // multiple canonical resources — strong, structured evidence) or an
    // explicit human-supplied review rule (ambiguityGroup, sourced only
    // from discoverPersonnelWorkbook's humanSuppliedAmbiguityGroups
    // option). Mononym status and substring/fuzzy similarity are never,
    // by themselves, sufficient — those are informational only
    // (sameWorkbookSimilarityNotes / suggestions).
    const ambiguityGroup = ambiguityGroupByNormalizedName.get(sheet.normalizedSheetName);
    const hasHonorific = hasHonorificOrAbbreviation(sheet.rawSheetName);

    if (matchResult.status === "AMBIGUOUS" || ambiguityGroup) {
      const groupNote = ambiguityGroup
        ? ` Human-supplied review rule flags possible overlap with: ${ambiguityGroup.rawNames.filter(n => n !== sheet.rawSheetName).join(", ")}.`
        : "";
      proposals.push({
        ...base,
        proposedType: "REVIEW_REQUIRED",
        category: "REVIEW_REQUIRED",
        matchStatus: matchResult.status,
        matchedResourceId: null,
        candidates: matchResult.candidates,
        suggestions: buildSuggestions(matchResult),
        reason:
          matchResult.status === "AMBIGUOUS"
            ? `Ambiguous match: multiple distinct resources match '${sheet.rawSheetName}' (${matchResult.candidates?.length ?? 0} candidates).${groupNote}`
            : `True identity ambiguity per an explicit human-supplied review rule.${groupNote} Not merged automatically — human confirmation required.`,
        businessBucket: "REVIEW_TRUE_IDENTITY_AMBIGUITY",
      });
    } else if (matchResult.status === "EXACT_MATCH" || matchResult.status === "ALIAS_MATCH") {
      proposals.push({
        ...base,
        proposedType: "GUIDE",
        category: "SAFE_EXISTING_MATCH",
        matchStatus: matchResult.status,
        matchedResourceId: matchResult.resourceId ?? null,
        suggestions: [],
        reason:
          matchResult.status === "EXACT_MATCH"
            ? `Exact match with canonical resource ID ${matchResult.resourceId} (${sheet.normalizedSheetName})`
            : `Alias match with canonical resource ID ${matchResult.resourceId}`,
        businessBucket: hasHonorific ? "GUIDE_NAME_DISPLAY_REVIEW" : "CLEAN_GUIDE_CANDIDATE",
      });
    } else if (looksLikeUnknownCodeIdentity(sheet.normalizedSheetName)) {
      // Genuinely unclear, code-like identifier (e.g. "FF") — requires
      // human review before any resource is proposed for it. This is
      // NOT a word-count/mononym rule (see looksLikeUnknownCodeIdentity).
      proposals.push({
        ...base,
        proposedType: "REVIEW_REQUIRED",
        category: "REVIEW_REQUIRED",
        matchStatus: "UNMATCHED",
        matchedResourceId: null,
        suggestions: buildSuggestions(matchResult),
        reason: `Unexplained code-like identifier '${sheet.rawSheetName}' — no exact/alias match and the name is too short to evaluate as a person's name. Human review required before any resource is created.`,
        businessBucket: "REVIEW_UNKNOWN_CODE_OR_IDENTITY",
      });
    } else {
      // UNMATCHED -> PROPOSED_NEW_RESOURCE. A single-word/mononym,
      // surname-only, or concatenated name is a perfectly valid
      // candidate here — it is never redirected to review for that
      // reason alone.
      proposals.push({
        ...base,
        proposedType: "GUIDE",
        category: "PROPOSED_NEW_RESOURCE",
        matchStatus: "UNMATCHED",
        matchedResourceId: null,
        suggestions: buildSuggestions(matchResult),
        reason: "No exact or alias match found in canonical resources. Proposed as new guide candidate.",
        businessBucket: hasHonorific ? "GUIDE_NAME_DISPLAY_REVIEW" : "CLEAN_GUIDE_CANDIDATE",
      });
    }
  }

  const safeExistingMatches = proposals.filter(p => p.category === "SAFE_EXISTING_MATCH").length;
  const reviewRequired = proposals.filter(p => p.category === "REVIEW_REQUIRED").length;
  const proposedNewResources = proposals.filter(p => p.category === "PROPOSED_NEW_RESOURCE").length;
  const ambiguousCount = proposals.filter(p => p.matchStatus === "AMBIGUOUS").length;
  const unmatchedCount = proposals.filter(p => p.matchStatus === "UNMATCHED").length;
  const esmaCount = proposals.filter(p => isEsmaSpecialCase(p.rawName)).length;
  const taylanCount = proposals.filter(p => isTaylanSpecialCase(p.rawName)).length;
  const cleanGuideCandidateCount = proposals.filter(p => p.businessBucket === "CLEAN_GUIDE_CANDIDATE").length;
  const reviewTrueIdentityAmbiguityCount = proposals.filter(p => p.businessBucket === "REVIEW_TRUE_IDENTITY_AMBIGUITY").length;
  const reviewUnknownCodeOrIdentityCount = proposals.filter(p => p.businessBucket === "REVIEW_UNKNOWN_CODE_OR_IDENTITY").length;
  const nonGuidePersonnelCount = proposals.filter(p => p.businessBucket === "NON_GUIDE_PERSONNEL").length;
  const guideNameDisplayReviewCount = proposals.filter(p => p.businessBucket === "GUIDE_NAME_DISPLAY_REVIEW").length;

  return {
    version: 1,
    mode: "personnel-master-import-plan",
    sourceWorkbook: discovery.sourceFilename,
    workbookFingerprint: discovery.workbookFingerprint,
    workbookSha256: discovery.workbookSha256,
    createdAt: options.timestamp ?? new Date().toISOString(),
    summary: {
      totalSheets: discovery.totalSheetCount,
      templateSheets: discovery.templateSheetCount,
      candidateSheets: discovery.candidateSheetCount,
      totalHistoricalDataRows: discovery.totalHistoricalDataRows,
      sheetsWithZeroDataRows: discovery.sheetsWithZeroDataRows,
      invalidOrBlankSheetNames: discovery.invalidOrBlankSheetNames,
      totalRowLevelEsmaObservations: discovery.totalRowLevelEsmaObservations,
      safeExistingMatches,
      reviewRequired,
      proposedNewResources,
      ambiguousCount,
      unmatchedCount,
      esmaCount,
      taylanCount,
      cleanGuideCandidateCount,
      reviewTrueIdentityAmbiguityCount,
      reviewUnknownCodeOrIdentityCount,
      nonGuidePersonnelCount,
      guideNameDisplayReviewCount,
      totalFooterOrKpiRowsExcluded: discovery.totalFooterOrKpiRowsExcluded,
      normalizedNameCollisions: discovery.normalizedNameCollisions,
      sheetIdentityAmbiguityGroups: discovery.sheetIdentityAmbiguityGroups,
    },
    proposals,
  };
}

/**
 * Compares a previously recorded plan fingerprint against a current workbook fingerprint.
 */
export function checkSourceDrift(
  recordedFingerprint: string,
  currentFingerprint: string,
): { hasDrifted: boolean; status: "MATCH" | "SOURCE_DRIFT" } {
  if (recordedFingerprint !== currentFingerprint) {
    return { hasDrifted: true, status: "SOURCE_DRIFT" };
  }
  return { hasDrifted: false, status: "MATCH" };
}
