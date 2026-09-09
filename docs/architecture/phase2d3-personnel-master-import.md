# Phase 2D.3: Personnel Master Data Import / Matching Foundation

Status: **Deterministic, read-only analyzer and matching foundation for `PERFORMANS RAPORU-2026.xlsx`. Zero live database writes, zero schema migrations, zero performance-history promotion, zero operation assignment rewrites.**

This document is the controlling reference for Phase 2D.3. It defines the discovery, matching, collision safety, business classification, human approval data model, and source-drift protection for establishing canonical personnel master data from historical workbooks.

---

## 1. Scope
- Parsing and discovering worksheet structure in `PERFORMANS RAPORU-2026.xlsx` using `exceljs`.
- Filtering template/example sheets (`ORNEK`, `ÖRNEK`, `TEMPLATE`, `ŞABLON`).
- Extracting raw and normalized sheet names (`normalizePersonName` from Phase 2D.1). **Raw sheet names (`rawName`) are always preserved exactly as they appear in the workbook — they are source identity evidence and are never rewritten, "corrected," or completed** (see Section 7).
- Matching discovered sheet names against existing canonical `resources` and `resource_aliases` using Phase 2D.1 deterministic identity functions (`matchResourceIdentity`).
- Surface fuzzy suggestions strictly as informational metadata on unmatched candidates.
- Flagging confirmed non-guide personnel (`ESMA`, `TAYLAN`) as `REVIEW_REQUIRED` with their confirmed business role (Section 7).
- Flagging genuine cross-sheet identity ambiguity and genuinely unclear code-like identifiers for human review (Section 7).
- Generating deterministic, machine-readable discovery and review artifacts (`PersonnelImportPlan`).
- Enabling dry-run execution with guaranteed zero DB mutation.

---

## 2. Non-Goals
- **No live DB inserts, updates, or deletes**: Phase 2D.3 does not insert new `resources`, create `resource_aliases`, or link `profiles`.
- **No database migrations**: Migration 0025 (`0025_resource_identity_foundation.sql`) was applied in Phase 2D.1/2D.2 and is sufficient.
- **No performance-history import**: Tour logs, attendance counts, and financial rows inside sheets are counted for evidence only, not imported or promoted to operations.
- **No operation assignment rewrites**: Existing operations and assignments remain untouched.
- **No Guest fabrication**: Customer/guest identities are never inferred or created from personnel sheets.
- **No automatic fuzzy merges**: Fuzzy similarity never automatically resolves identity or merges resources.
- **No name rewriting**: A sheet name is never "cleaned up," expanded, or required to include a surname. First-name-only, surname-only, and concatenated first+surname forms are all valid, preserved as-is (Section 7).
- **No widening of `resources.type`**: Still `GUIDE` / `DRIVER` only (Section 7.2 — TAYLAN-class personnel are deferred, not force-fit into an existing type).

---

## 3. Workbook Evidence Model
The source workbook `PERFORMANS RAPORU-2026.xlsx` contains approximately 85 worksheets:
1. **Template Sheet**: A single template worksheet (`ORNEK` / `ÖRNEK`) serving as a structural archetype. Excluded from candidate extraction.
2. **Personnel Candidate Sheets**: Approximately 84 worksheets representing individual personnel performance records.
3. **Data Rows**: Historical tour assignment and performance rows per guide. In Phase 2D.3, row counts are recorded purely as provenance evidence (`historicalRowCount` / `dataRowCount`). **Footer/KPI/grand-total rows (e.g. a `TOPLAM` or `GENEL TOPLAM` row) are excluded from this count** — see Section 7.3. This only affects the count; no cell is ever read for any other purpose, rewritten, or removed, and a sheet is never dropped for having few or zero real tour rows.
4. **Fingerprint**: Each sheet and the entire workbook receive a deterministic SHA-256 hash based on content and structure.

---

## 4. Canonical Identity Rules
- **Canonical identity is `resources.id`**: A sheet name, Excel spelling, alias, legacy string, or login account is NEVER canonical identity on its own.
- **PERSON != LOGIN ACCOUNT**: `resources` represents the real physical person. `profiles` and `linked_profile_id` represent authentication/login access only. A Resource can exist and be assigned without any linked login profile.
- **`normalized_name` is non-unique by design**: Two real distinct individuals can have the same normalized name. The system never merges them.
- **Turkish character folding**: Folds Turkish letters (`İ`, `I`, `ı`, `Ş`, `ş`, `Ç`, `ç`, `Ğ`, `ğ`, `Ö`, `ö`, `Ü`, `ü`) to plain ASCII equivalents before stripping non-alphanumerics and lowercasing.
- **No word-count/mononym rule**: Whether a raw sheet name is one word or several has no bearing on identity classification. A first-name-only, surname-only, nickname-like, or concatenated first+surname form is a normal candidate identity.

---

## 5. Matching Precedence & Ambiguity Handling
Matching is performed via `matchResourceIdentity()` in `artifacts/api-server/src/lib/personnel-identity.ts`:

| Match Status | Condition | Import Proposal Category | Action |
| --- | --- | --- | --- |
| `EXACT_MATCH` | Matches exactly 1 resource by `normalized_name` | `SAFE_EXISTING_MATCH` | Proposed as existing guide match |
| `ALIAS_MATCH` | Matches exactly 1 resource via `resource_aliases` | `SAFE_EXISTING_MATCH` | Proposed as existing guide match |
| `AMBIGUOUS` | Matches >1 resource (by name, alias, or combination) | `REVIEW_REQUIRED` | All candidate resource IDs preserved; requires human disambiguation |
| `UNMATCHED` | Matches 0 resources and 0 aliases | `PROPOSED_NEW_RESOURCE` (unless flagged per Section 7.4) | Proposed as new resource candidate; fuzzy suggestions attached as metadata |

`matchStatus` (the table above) and `category` (`SAFE_EXISTING_MATCH` / `REVIEW_REQUIRED` / `PROPOSED_NEW_RESOURCE`) are the technical decision that has driven the human-approval workflow since Phase 2D.3 began. Section 7 adds an orthogonal, human-facing **`businessBucket`** classification on top of this — it explains *why* to a reviewer, and can force `category` to `REVIEW_REQUIRED` for cross-sheet ambiguity or an unclear code-like identifier, but it never changes which `resourceId` (if any) gets picked.

### Ambiguity Safety
If two different resources match (e.g. two distinct guides with the same name, or a name match on resource A and alias match on resource B), the status is strictly `AMBIGUOUS`. The system never picks one over the other automatically.

---

## 6. Fuzzy Suggestion Policy
- Fuzzy matching uses pure Levenshtein string distance converted to a 0..1 ratio (`similarityRatio`).
- Suggestions are computed only for `UNMATCHED` candidates (threshold $\ge 0.6$, max 3 suggestions).
- **Rule**: Fuzzy suggestions are **informational metadata only**. They NEVER elevate a candidate to `MATCHED` or resolve an `AMBIGUOUS` state automatically.

---

## 7. Business Rule Corrections (operator-confirmed) & Classification Buckets

This section reflects an explicit operator business-rule correction pass. It supersedes any earlier framing of mononyms as inherently ambiguous, and confirms the business meaning of two previously-unclear sheet names.

### 7.0 businessBucket

Every proposal in `PersonnelImportPlan.proposals` carries a `businessBucket`, one of:

| Bucket | Meaning | Effect on `category` |
| --- | --- | --- |
| `CLEAN_GUIDE_CANDIDATE` | A structurally valid guide identity — including first-name-only, surname-only, nickname-like, or concatenated forms. | None — follows normal matching (`SAFE_EXISTING_MATCH` or `PROPOSED_NEW_RESOURCE`). |
| `REVIEW_TRUE_IDENTITY_AMBIGUITY` | Evidence that two or more sheet identities (in this workbook, or against canonical resources) may be the same person. | Forces `REVIEW_REQUIRED`, `matchedResourceId: null`. Never merged automatically. |
| `REVIEW_UNKNOWN_CODE_OR_IDENTITY` | A genuinely unclear, code-like identifier (e.g. an unexplained `FF`). | Forces `REVIEW_REQUIRED`, `matchedResourceId: null`, even though `matchStatus` is `UNMATCHED`. |
| `NON_GUIDE_PERSONNEL` | A known, confirmed non-guide business role (`ESMA`, `TAYLAN`). | Forces `REVIEW_REQUIRED`, `matchedResourceId: null`, `proposedType: "REVIEW_REQUIRED"` (never `GUIDE`). |
| `GUIDE_NAME_DISPLAY_REVIEW` | A name carrying a Turkish honorific (`HANIM`/`BEY`) or a trailing single-letter surname abbreviation (e.g. `BAHAR K.`). Renamed from `GUIDE_NAME_WITH_HONORIFIC_OR_ABBREVIATION` in the final safety-correction pass (Section 7.5). | **None** — purely informational, for an optional canonical-display-name confirmation. The name is never rejected. |

### 7.1 Single-word names / mononyms are never auto-flagged

Workbook names are intentional operational identifiers. A sheet stored by first name only, surname only, first+surname, a concatenated form, or an operational nickname (e.g. `FATMA`, `DENIZ`, `MERT`, `NILGUN`, `YALCINDAG`, `CAMURCU`, `NALDOKEN`, `TAYLAN`) must be preserved exactly as `rawName` and is never redirected to review, never required to have a surname completed, and is never rewritten. There is no word-count-based rule anywhere in `personnel-import-parser.ts`; a plain one-word name lands as `CLEAN_GUIDE_CANDIDATE`.

### 7.2 Confirmed non-guide personnel: ESMA and TAYLAN

- **ESMA = `OPERATIONS_PERSONNEL`.** ESMA is not a guide identity. If a sheet tab is literally named ESMA, it is explicitly designated `isEsmaSpecialCase = true`, categorized `REVIEW_REQUIRED` / `businessBucket: "NON_GUIDE_PERSONNEL"` / `businessRole: "OPERATIONS_PERSONNEL"`, and `matchedResourceId` is forced to `null` even if an exact name match exists. Row-level ESMA mentions (evidence of operations-personnel involvement in another guide's sheet) are counted (`esmaObservationCount` / `totalRowLevelEsmaObservations`) but never create an ESMA candidate proposal. No resource is created for ESMA in this phase; the evidence is preserved for a future operations/personnel-domain mapping.
- **TAYLAN = `ACCOUNTING_PERSONNEL`.** TAYLAN is not a guide. The TAYLAN worksheet stays part of workbook personnel discovery (`isTaylanSpecialCase`), categorized `REVIEW_REQUIRED` / `businessBucket: "NON_GUIDE_PERSONNEL"` / `businessRole: "ACCOUNTING_PERSONNEL"` / `canonicalResourceStatus: "DEFER_TYPE_UNSUPPORTED"`, and `proposedType` is `"REVIEW_REQUIRED"`, never `"GUIDE"`. `resources.type` currently supports `GUIDE`/`DRIVER` only (`lib/db/schema/resources.ts`, enforced by both a Postgres `CHECK` constraint and the `resourceCreateSchema` zod enum) and is **not** widened in this phase — TAYLAN's worksheet/history is preserved, not discarded, pending a future personnel-type model that can represent accounting/operations staff.

### 7.3 Historical row-count parser: footer/KPI exclusion

`isFooterOrKpiRow()` recognizes a narrow, whole-cell, Turkish-normalized vocabulary. This vocabulary has since been directly verified against the real `PERFORMANS RAPORU-2026.xlsx` footer block (Section 7.6) and expanded from the original 5-keyword placeholder set to: `toplam`, `geneltoplam`, `aratoplam`, `ozet`, `kpi`, `tursayisi`, `pax`, `yorum`, `biletsatisi`, `yemeksatisi`, `turhali`, `turderi`. A row matching one of these is excluded from `dataRowCount` (tracked separately as `footerOrKpiRowsExcluded` / `totalFooterOrKpiRowsExcluded`) but still counted in `totalRows`. This never alters workbook contents, names, comments, or notes, and never removes a sheet for having few or zero real tour rows.

### 7.4 Human review classification (revised)

The former framing — "a single-word / mononym name requires review" — is invalid for this business and does not appear anywhere in code. Review classification uses these buckets instead (see 7.0):

- **`CLEAN_GUIDE_CANDIDATE`**: any structurally valid guide identity, single-word or not.
- **`REVIEW_TRUE_IDENTITY_AMBIGUITY`**: only with actual, strong evidence that two or more sheet identities may be the same person (Section 7.5). Never merged automatically.
- **`REVIEW_UNKNOWN_CODE_OR_IDENTITY`**: only genuinely unclear, code-like entries. `looksLikeUnknownCodeIdentity()` uses a narrow heuristic (normalized length ≤ 2 characters, e.g. `FF`) — deliberately not a word-count rule, since a real one-word name like `FATMA` or `ALI` is well above that length.
- **`NON_GUIDE_PERSONNEL`**: `TAYLAN` (`ACCOUNTING_PERSONNEL`) and `ESMA` (`OPERATIONS_PERSONNEL`) today (Section 7.2).
- **`GUIDE_NAME_DISPLAY_REVIEW`**: `CIGDEM HANIM`, `SINAN BEY`, `BAHAR K.` and similar. `hasHonorificOrAbbreviation()` detects a `HANIM`/`BEY` word or a trailing single-letter abbreviation. These are **never** auto-rejected — they flow through normal matching (`SAFE_EXISTING_MATCH` or `PROPOSED_NEW_RESOURCE`) exactly like any other name; the bucket is flagged only for an optional canonical-display-name confirmation.

### 7.5 Final safety correction: no hard-coded ambiguity, no algorithmic substring-to-review promotion

An earlier iteration of this module shipped a hard-coded `KNOWN_IDENTITY_AMBIGUITY_GROUPS` constant (`["GOKBORA", "ERMAN GOKBORA"]`, `["NAZMICAN", "NAZMI TARAKCI", "NAZIM BAHADIR"]`) and promoted generic same-workbook substring containment (a short normalized name being a substring of a longer one) directly to `REVIEW_TRUE_IDENTITY_AMBIGUITY`. The operator explicitly corrected both of these as unsafe for production identity matching:

- These name pairs/groups are **examples requiring human review**, not confirmed shared identities. Hard-coding them as production truth risks silently treating two different people as one, or vice versa.
- A generic "short string is a substring of a longer string" rule is far too aggressive — e.g. `ALI` is a substring of `MEHMET ALI`, but that is common and not evidence of shared identity.

The corrected design removes `KNOWN_IDENTITY_AMBIGUITY_GROUPS` entirely from production source. `detectSheetIdentityAmbiguityGroups()` now takes an explicit `humanSuppliedGroups: string[][]` parameter (default `[]`) and produces entries with `basis: "HUMAN_SUPPLIED_GROUP"` — the **only** way a cross-sheet pairing can ever become `REVIEW_TRUE_IDENTITY_AMBIGUITY`. This threads through `discoverPersonnelWorkbook`'s `humanSuppliedAmbiguityGroups` option and the CLI's `--human-ambiguity-groups-json <path>` flag (an explicit, opt-in review-rule file a reviewer supplies — never a built-in default). The old GOKBORA/NAZMICAN example groups now live **only** as explicit test fixtures in `personnel-master-import-self-test.ts`, passed as literal function arguments in specific test cases, never referenced from `personnel-import-parser.ts`.

Same-workbook substring containment is still computed (4-character normalized-length floor, to avoid near-universal trivial matches on very short names), but its output is now structurally incapable of affecting `category`, `businessBucket`, or `matchedResourceId`: `computeSameWorkbookSimilarityNotes()` returns `SameWorkbookSimilarityNote[]` entries with `basis: "INFORMATIONAL_SUGGESTION"`, attached to every proposal as `sameWorkbookSimilarityNotes` (always present, possibly empty). A human reviewer can act on a similarity note by supplying it as a `humanSuppliedAmbiguityGroups` entry on a subsequent run; nothing merges automatically. Fuzzy suggestions (Section 6) follow the same informational-only rule and were never changed.

Production ambiguity (`REVIEW_TRUE_IDENTITY_AMBIGUITY`) is therefore gated by exactly two sources: (a) `matchResourceIdentity`'s own `AMBIGUOUS` status (the sheet name maps to ≥2 canonical resources by name and/or alias — strong, structured evidence), or (b) an explicit human-supplied review rule. Mononym status and substring/fuzzy similarity are never, by themselves, sufficient.

### 7.6 Raw sheet-name whitespace preservation

Real-workbook inspection surfaced a pre-existing bug: the stored `rawSheetName` was computed as `worksheet.name.trim()`, which silently corrupted real sheet names carrying incidental whitespace (confirmed real examples: `"CEYLA "` with a trailing space, `"NAZIM  BAHADIR"` with a doubled internal space) — a direct violation of the "rawName must remain the exact worksheet name" rule (Section 7.1). This is fixed: `rawSheetName` is now stored byte-for-byte from `worksheet.name` with no trimming; a separately-trimmed check is used only to detect a genuinely blank sheet name. Matching/normalization behavior is unaffected, since `normalizePersonName()` already strips all whitespace.

---

## 8. Human Approval Data Model
The output plan (`PersonnelImportPlan`) is structured so Phase 2D.4 can accept explicit human decisions without re-evaluating the raw workbook:

```typescript
export type HumanApprovalActionType =
  | "MATCH_EXISTING_RESOURCE" // Links sheet to an existing resource ID
  | "CREATE_NEW_RESOURCE"     // Approves creation of a new Resource row
  | "ADD_ALIAS"               // Adds a new alias to an existing Resource
  | "REJECT"                  // Explicitly ignores sheet
  | "DEFER";                  // Defers decision for later review

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
```

---

## 9. Idempotency & Source-Drift Design
- **Source Fingerprint**: Generated from the SHA-256 hash of the workbook binary (`workbookFingerprint`) and individual sheet coordinates (`sheetFingerprint`).
- **Drift Protection**: If a previously generated plan or approval batch is loaded against a modified workbook, `checkSourceDrift()` flags `SOURCE_DRIFT`. Stale approvals cannot be replayed onto changed source data.
- **Determinism**: Re-running the pipeline against the same workbook and database state produces byte-for-byte identical output. Timestamps are excluded from identity keys.

---

## 10. CLI & Verification Usage

### Offline / DB-Independent Mode (Default)
```bash
pnpm --filter @workspace/api-server personnel:import-dry-run -- --workbook PERFORMANS\ RAPORU-2026.xlsx --output plan.json
```

### Read-Only Database Mode
```bash
pnpm --filter @workspace/api-server personnel:import-dry-run -- --workbook PERFORMANS\ RAPORU-2026.xlsx --db --output plan.json
```

### Human-Supplied Ambiguity Review Rules (optional)
```bash
pnpm --filter @workspace/api-server personnel:import-dry-run -- --workbook PERFORMANS\ RAPORU-2026.xlsx --human-ambiguity-groups-json review-rules.json
```
`review-rules.json` is an array of arrays of raw sheet names a human reviewer has explicitly opted in for cross-sheet ambiguity review, e.g. `[["GOKBORA", "ERMAN GOKBORA"]]` (Section 7.5). Omitting this flag means zero `REVIEW_TRUE_IDENTITY_AMBIGUITY` entries can be produced from same-workbook evidence alone — only `matchResourceIdentity`'s own `AMBIGUOUS` status against supplied canonical resources/aliases can still do so.

**Note:** `PERFORMANS RAPORU-2026.xlsx` is supplied externally at runtime (via `--workbook <path>`) and is not checked into the repository. It has since been supplied and validated in a real-device environment (SHA-256 verified), and `discoverPersonnelWorkbook` / `buildPersonnelMasterImportPlan` have been exercised against the real workbook, not only the self-test's mock fixtures.

---

## 11. Future Phase 2D.4 Execution Boundary
Phase 2D.3 strictly prepares the discovery and review package.
Execution of decisions (inserting `resources`, adding `resource_aliases` with source `PERFORMANCE_2026`, and operator audit logging) is reserved for Phase 2D.4 under explicit human approval.

**Personnel-type model gap (from Section 7.2):** `resources.type` supports `GUIDE`/`DRIVER` only. `TAYLAN`-class (`ACCOUNTING_PERSONNEL`) and `ESMA`-class (`OPERATIONS_PERSONNEL`) personnel cannot become canonical resources until a future phase widens this model (new `resources.type` values, a schema migration, and corresponding zod/API changes) — out of scope for both 2D.3 and 2D.4 as currently defined.
