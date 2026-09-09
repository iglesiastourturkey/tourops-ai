import assert from "node:assert/strict";
import {
  normalizePersonName,
  matchResourceIdentity,
  levenshteinDistance,
  similarityRatio,
} from "./lib/personnel-identity";
import {
  isTemplateSheetName,
  isEsmaSpecialCase,
  isTaylanSpecialCase,
  hasHonorificOrAbbreviation,
  looksLikeUnknownCodeIdentity,
  computeSameWorkbookSimilarityNotes,
  discoverPersonnelWorkbook,
  buildPersonnelMasterImportPlan,
  checkSourceDrift,
  computeSha256,
} from "./lib/personnel-import-parser";
import { runPersonnelMasterImportDryRun } from "./personnel-master-import-dry-run";

// Mock ExcelJS workbook builder helper for pure tests without external dependencies
function createMockWorkbook(sheetsData: Array<{ name: string; rows?: any[][] }>) {
  return {
    worksheets: sheetsData.map((s, idx) => ({
      name: s.name,
      eachRow: (opts: any, cb: (row: { actualCellCount: number; eachCell: (opts: any, cellCb: (c: { value: any }) => void) => void }, rowNumber: number) => void) => {
        const rows = s.rows ?? [["Header1", "Header2"], ["Val1", "Val2"]];
        rows.forEach((r, rIdx) => cb({
          actualCellCount: r.length,
          eachCell: (o: any, cellCb: (c: { value: any }) => void) => {
            r.forEach(cellVal => cellCb({ value: cellVal }));
          },
        }, rIdx + 1));
      },
    })),
  } as any;
}

// ─── 1. Sheet enumeration and template exclusion ──────────────────────────

assert.equal(isTemplateSheetName("ORNEK"), true);
assert.equal(isTemplateSheetName("ÖRNEK"), true);
assert.equal(isTemplateSheetName("Örnek Şablon"), true);
assert.equal(isTemplateSheetName("TEMPLATE"), true);
assert.equal(isTemplateSheetName("sablon"), true);
assert.equal(isTemplateSheetName(""), true, "empty name is treated as non-candidate");
assert.equal(isTemplateSheetName("ERMAN GOKBORA"), false);
assert.equal(isTemplateSheetName("KADIR SAHIN"), false);

{
  const mockWb = createMockWorkbook([
    { name: "ORNEK" },
    { name: "ERMAN GOKBORA" },
    { name: "KADIR SAHIN" },
    { name: "TEMPLATE" },
  ]);
  const discovery = discoverPersonnelWorkbook(mockWb, { sourceFilename: "TEST-2026.xlsx" });
  assert.equal(discovery.totalSheetCount, 4);
  assert.equal(discovery.templateSheetCount, 2);
  assert.equal(discovery.candidateSheetCount, 2);

  const plan = buildPersonnelMasterImportPlan(discovery, [], []);
  assert.equal(plan.summary.totalSheets, 4);
  assert.equal(plan.summary.templateSheets, 2);
  assert.equal(plan.summary.candidateSheets, 2);
  assert.equal(plan.proposals.length, 2, "Template sheets must be excluded from proposals");
  assert.ok(plan.proposals.every(p => !isTemplateSheetName(p.rawName)));
}

// ─── 2. Turkish character normalization in sheet names ────────────────────

assert.equal(normalizePersonName("Çiğdem Hanım"), "cigdemhanim");
assert.equal(normalizePersonName("ŞÜKRÜ ÖZTÜRK"), "sukruozturk");
assert.equal(normalizePersonName("İSMAİL IŞIK"), "ismailisik");
assert.equal(normalizePersonName("BAHAR K."), "bahark");
assert.equal(normalizePersonName("İIışŞçÇğĞöÖüÜ"), "iiissccggoouu");

// ─── 3. Exact match detection against canonical resources ─────────────────

{
  const mockWb = createMockWorkbook([{ name: "ERMAN GOKBORA" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const resources = [{ id: 101, normalizedName: "ermangokbora" }];
  const aliases: any[] = [];

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  assert.equal(plan.summary.safeExistingMatches, 1);
  assert.equal(plan.proposals[0]?.matchStatus, "EXACT_MATCH");
  assert.equal(plan.proposals[0]?.category, "SAFE_EXISTING_MATCH");
  assert.equal(plan.proposals[0]?.matchedResourceId, 101);
  assert.equal(plan.proposals[0]?.proposedType, "GUIDE");
}

// ─── 4. Alias match detection against resource aliases ────────────────────

{
  const mockWb = createMockWorkbook([{ name: "GOKBORA" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const resources = [{ id: 101, normalizedName: "ermangokbora" }];
  const aliases = [{ resourceId: 101, normalizedAlias: "gokbora" }];

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  assert.equal(plan.summary.safeExistingMatches, 1);
  assert.equal(plan.proposals[0]?.matchStatus, "ALIAS_MATCH");
  assert.equal(plan.proposals[0]?.category, "SAFE_EXISTING_MATCH");
  assert.equal(plan.proposals[0]?.matchedResourceId, 101);
}

// ─── 5. Ambiguity on identical normalized names (two distinct resources) ──
// This is "strong structured evidence": the SAME normalized identity maps
// to two distinct canonical resources. This must still force review.

{
  const mockWb = createMockWorkbook([{ name: "Kadir Şahin" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const resources = [
    { id: 201, normalizedName: "kadirsahin" },
    { id: 202, normalizedName: "kadirsahin" },
  ];
  const aliases: any[] = [];

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  assert.equal(plan.summary.reviewRequired, 1);
  assert.equal(plan.summary.ambiguousCount, 1);
  assert.equal(plan.proposals[0]?.matchStatus, "AMBIGUOUS");
  assert.equal(plan.proposals[0]?.category, "REVIEW_REQUIRED");
  assert.equal(plan.proposals[0]?.matchedResourceId, null, "Ambiguous cases must never auto-pick a resource");
  assert.equal(plan.proposals[0]?.candidates?.length, 2);
  assert.equal(plan.proposals[0]?.businessBucket, "REVIEW_TRUE_IDENTITY_AMBIGUITY");
}

// ─── 6. Ambiguity on shared alias (same alias maps to multiple resources) ─

{
  const mockWb = createMockWorkbook([{ name: "NAZMI" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const resources = [
    { id: 301, normalizedName: "nazmitarakci" },
    { id: 302, normalizedName: "nazimbahadir" },
  ];
  const aliases = [
    { resourceId: 301, normalizedAlias: "nazmi" },
    { resourceId: 302, normalizedAlias: "nazmi" },
  ];

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  assert.equal(plan.proposals[0]?.matchStatus, "AMBIGUOUS");
  assert.equal(plan.proposals[0]?.category, "REVIEW_REQUIRED");
  assert.equal(plan.proposals[0]?.matchedResourceId, null);
  assert.equal(plan.proposals[0]?.candidates?.length, 2);
}

// ─── 7. Ambiguity between name match and alias match pointing to different resources

{
  const mockWb = createMockWorkbook([{ name: "GOKBORA" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const resources = [{ id: 401, normalizedName: "gokbora" }];
  const aliases = [{ resourceId: 402, normalizedAlias: "gokbora" }];

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  assert.equal(plan.proposals[0]?.matchStatus, "AMBIGUOUS");
  assert.equal(plan.proposals[0]?.category, "REVIEW_REQUIRED");
  assert.equal(plan.proposals[0]?.matchedResourceId, null);
  assert.equal(plan.proposals[0]?.candidates?.length, 2);
}

// ─── 8. ESMA handling: Row-level observations & Sheet-level safety ────────

assert.equal(isEsmaSpecialCase("ESMA"), true);
assert.equal(isEsmaSpecialCase("Esma Hanim"), true);
assert.equal(isEsmaSpecialCase("KADIR SAHIN"), false);

{
  // PROOF: Row-level ESMA appearances NEVER create a candidate identity or proposed resource,
  // and never create a GUIDE. Sheet is named "AHMET YILMAZ", but contains ESMA in data cells.
  const mockWb = createMockWorkbook([
    {
      name: "AHMET YILMAZ",
      rows: [
        ["Date", "Tour", "Guide Note", "Status"],
        ["2026-05-01", "Ephesus Full Day", "ESMA confirmed pax", "Completed"],
        ["2026-05-02", "Pamukkale", "Handled by ESMA office", "Completed"],
      ],
    },
  ]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  assert.equal(discovery.candidateSheetCount, 1);
  assert.equal(discovery.totalRowLevelEsmaObservations, 2);
  assert.equal(discovery.sheets[0]?.esmaObservationCount, 2);

  const plan = buildPersonnelMasterImportPlan(discovery, [], []);
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0]?.rawName, "AHMET YILMAZ");
  assert.equal(plan.proposals[0]?.category, "PROPOSED_NEW_RESOURCE");
  assert.equal(plan.proposals[0]?.proposedType, "GUIDE");
  assert.equal(plan.summary.totalRowLevelEsmaObservations, 2);
  // Row-level ESMA NEVER produced an ESMA candidate proposal or a manufactured ESMA sheet
  assert.ok(plan.proposals.every(p => p.rawName !== "ESMA"));
  assert.equal(plan.summary.esmaCount, 0, "no actual ESMA worksheet exists in this workbook");
}

{
  // PROOF: If a sheet tab itself is literally named ESMA, it must remain REVIEW_REQUIRED and never
  // auto-linked or turned into a GUIDE, and its confirmed business meaning is OPERATIONS_PERSONNEL
  // (Phase 2D.3 correction).
  const mockWb = createMockWorkbook([{ name: "ESMA" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const resources = [{ id: 501, normalizedName: "esma" }]; // even if a resource exists
  const aliases: any[] = [];

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  assert.equal(plan.summary.esmaCount, 1);
  assert.equal(plan.summary.reviewRequired, 1);
  assert.equal(plan.proposals[0]?.category, "REVIEW_REQUIRED");
  assert.equal(plan.proposals[0]?.proposedType, "REVIEW_REQUIRED", "ESMA must never become GUIDE");
  assert.equal(plan.proposals[0]?.matchedResourceId, null, "ESMA must NEVER be auto-linked to any resource");
  assert.ok(plan.proposals[0]?.reason.includes("ESMA"));
  assert.equal(plan.proposals[0]?.businessBucket, "NON_GUIDE_PERSONNEL");
  assert.equal(plan.proposals[0]?.businessRole, "OPERATIONS_PERSONNEL");
  assert.equal(plan.proposals[0]?.canonicalResourceStatus, undefined, "ESMA has no type-model blocker, unlike TAYLAN");
}

// ─── 9. Honorifics and abbreviated display forms (CIGDEM HANIM, SINAN BEY, BAHAR K.) ─
// Phase 2D.3 correction: these get an informational GUIDE_NAME_DISPLAY_REVIEW flag,
// but MUST NOT be rejected or forced into REVIEW_REQUIRED for that reason alone.

{
  const mockWb = createMockWorkbook([
    { name: "CIGDEM HANIM" },
    { name: "SINAN BEY" },
    { name: "BAHAR K." },
  ]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const resources = [
    { id: 601, normalizedName: "cigdemozturk" },
    { id: 602, normalizedName: "sinanyilmaz" },
    { id: 603, normalizedName: "baharkara" },
  ];
  const aliases: any[] = [];

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  assert.equal(plan.summary.proposedNewResources, 3);
  assert.ok(plan.proposals.every(p => p.category === "PROPOSED_NEW_RESOURCE"), "display-review names must not be rejected or redirected to REVIEW_REQUIRED");
  assert.ok(plan.proposals.every(p => p.matchedResourceId === null));
  assert.ok(plan.proposals.every(p => p.businessBucket === "GUIDE_NAME_DISPLAY_REVIEW"));
  assert.equal(plan.summary.guideNameDisplayReviewCount, 3);
  // Verify fuzzy suggestions are surfaced as informational suggestions only
  const cigdemProp = plan.proposals.find(p => p.rawName === "CIGDEM HANIM");
  assert.ok(cigdemProp);
  assert.equal(cigdemProp.matchStatus, "UNMATCHED");
  // Raw source string is preserved verbatim, honorific included
  assert.equal(cigdemProp.rawName, "CIGDEM HANIM");
}

assert.equal(hasHonorificOrAbbreviation("CIGDEM HANIM"), true);
assert.equal(hasHonorificOrAbbreviation("SINAN BEY"), true);
assert.equal(hasHonorificOrAbbreviation("BAHAR K."), true);
assert.equal(hasHonorificOrAbbreviation("FATMA"), false);
assert.equal(hasHonorificOrAbbreviation("ERMAN GOKBORA"), false);

// ─── 10. Fuzzy suggestions policy (score < 1, informational only) ─────────

{
  const mockWb = createMockWorkbook([{ name: "Erman Gokbora" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const resources = [{ id: 701, normalizedName: "ermangokbor" }]; // 1 char difference
  const aliases: any[] = [];

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  assert.equal(plan.proposals[0]?.matchStatus, "UNMATCHED");
  assert.equal(plan.proposals[0]?.category, "PROPOSED_NEW_RESOURCE");
  assert.equal(plan.proposals[0]?.matchedResourceId, null);
  assert.ok((plan.proposals[0]?.suggestions.length ?? 0) > 0);
  assert.equal(plan.proposals[0]?.suggestions[0]?.resourceId, 701);
  assert.ok((plan.proposals[0]?.suggestions[0]?.score ?? 0) >= 0.6 && (plan.proposals[0]?.suggestions[0]?.score ?? 0) < 1);
}

// ─── 11. Deterministic workbook fingerprinting & source-drift detection ───

{
  const fingerprint1 = computeSha256("WORKBOOK_CONTENT_V1");
  const fingerprint2 = computeSha256("WORKBOOK_CONTENT_V1");
  const fingerprint3 = computeSha256("WORKBOOK_CONTENT_V2");

  assert.equal(fingerprint1, fingerprint2, "SHA-256 must be deterministic");
  assert.notEqual(fingerprint1, fingerprint3);

  const matchCheck = checkSourceDrift(fingerprint1, fingerprint2);
  assert.equal(matchCheck.hasDrifted, false);
  assert.equal(matchCheck.status, "MATCH");

  const driftCheck = checkSourceDrift(fingerprint1, fingerprint3);
  assert.equal(driftCheck.hasDrifted, true);
  assert.equal(driftCheck.status, "SOURCE_DRIFT");
}

// ─── 12. Idempotent rerun verification ───────────────────────────────────

{
  const mockWb = createMockWorkbook([
    { name: "ORNEK" },
    { name: "ERMAN GOKBORA" },
    { name: "KADIR SAHIN" },
    { name: "ESMA" },
  ]);
  const resources = [{ id: 801, normalizedName: "ermangokbora" }];
  const aliases = [{ resourceId: 801, normalizedAlias: "gokbora" }];

  const discovery1 = discoverPersonnelWorkbook(mockWb, { sourceFilename: "RAPOR.xlsx" });
  const plan1 = buildPersonnelMasterImportPlan(discovery1, resources, aliases, { timestamp: "2026-09-08T00:00:00.000Z" });

  const discovery2 = discoverPersonnelWorkbook(mockWb, { sourceFilename: "RAPOR.xlsx" });
  const plan2 = buildPersonnelMasterImportPlan(discovery2, resources, aliases, { timestamp: "2026-09-08T00:00:00.000Z" });

  assert.deepEqual(plan1, plan2, "Reruns on same input and state must be byte-for-byte identical");
}

// ─── 13. Read-only safety & dry-run file check ────────────────────────────

async function testDryRun() {
  const result = await runPersonnelMasterImportDryRun(["--workbook", "NON_EXISTENT_WORKBOOK_PATH_12345.xlsx"]);
  if ("status" in result) {
    assert.equal(result.status, "WORKBOOK_NOT_AVAILABLE");
    assert.equal(result.databaseWrites, false);
  } else {
    assert.fail("Expected WORKBOOK_NOT_AVAILABLE");
  }
}

await testDryRun();

// ─── 14. Phase 2D.3 correction: single-word/mononym names are CLEAN, never auto-reviewed ──
// Business confirmation: workbook names are intentional operational identifiers. A first-name-only,
// surname-only, or concatenated first+surname sheet name must land as a normal candidate, exactly
// like any multi-word name — never flagged for review merely for being one word.

{
  const mockWb = createMockWorkbook([
    { name: "FATMA" },
    { name: "DENIZ" },
    { name: "MERT" },
    { name: "NILGUN" },
    { name: "YALCINDAG" },
    { name: "CAMURCU" },
    { name: "NALDOKEN" },
  ]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const plan = buildPersonnelMasterImportPlan(discovery, [], []);

  assert.equal(plan.proposals.length, 7);
  assert.ok(plan.proposals.every(p => p.category === "PROPOSED_NEW_RESOURCE"), "mononyms must not be redirected to REVIEW_REQUIRED");
  assert.ok(plan.proposals.every(p => p.businessBucket === "CLEAN_GUIDE_CANDIDATE"), "a single-word name alone must never yield anything but CLEAN_GUIDE_CANDIDATE");
  assert.equal(plan.summary.cleanGuideCandidateCount, 7);
}

// ─── 15. Phase 2D.3 correction: TAYLAN = ACCOUNTING_PERSONNEL, deferred (type unsupported) ──

assert.equal(isTaylanSpecialCase("TAYLAN"), true);
assert.equal(isTaylanSpecialCase("Taylan"), true);
assert.equal(isTaylanSpecialCase("KADIR SAHIN"), false);
assert.equal(isTaylanSpecialCase("AYTAYLAN"), false, "TAYLAN is an exact-match special case only, unlike ESMA's prefix/suffix match");

{
  const mockWb = createMockWorkbook([{ name: "TAYLAN" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const resources: any[] = [];
  const aliases: any[] = [];

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases);
  assert.equal(plan.summary.taylanCount, 1);
  assert.equal(plan.summary.reviewRequired, 1);
  assert.equal(plan.proposals[0]?.category, "REVIEW_REQUIRED");
  assert.equal(plan.proposals[0]?.proposedType, "REVIEW_REQUIRED", "TAYLAN must never be proposed as GUIDE");
  assert.equal(plan.proposals[0]?.matchedResourceId, null);
  assert.equal(plan.proposals[0]?.businessBucket, "NON_GUIDE_PERSONNEL");
  assert.equal(plan.proposals[0]?.businessRole, "ACCOUNTING_PERSONNEL");
  assert.equal(plan.proposals[0]?.canonicalResourceStatus, "DEFER_TYPE_UNSUPPORTED");
  assert.ok(plan.proposals[0]?.reason.includes("TAYLAN"));
  assert.equal(plan.summary.nonGuidePersonnelCount, 1);
}

// ─── 16. Phase 2D.3 correction: genuinely unclear code-like identifiers (e.g. "FF") ──
// "FF" is confirmed present as a real worksheet name in PERFORMANS RAPORU-2026.xlsx.

assert.equal(looksLikeUnknownCodeIdentity("ff"), true);
assert.equal(looksLikeUnknownCodeIdentity("fatma"), false);
assert.equal(looksLikeUnknownCodeIdentity("ali"), false, "a real 3-letter mononym is not treated as a code");

{
  const mockWb = createMockWorkbook([{ name: "FF" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  const plan = buildPersonnelMasterImportPlan(discovery, [], []);

  assert.equal(plan.proposals[0]?.matchStatus, "UNMATCHED");
  assert.equal(plan.proposals[0]?.category, "REVIEW_REQUIRED", "an unexplained code-like identifier requires human review before any resource is proposed");
  assert.equal(plan.proposals[0]?.matchedResourceId, null);
  assert.equal(plan.proposals[0]?.businessBucket, "REVIEW_UNKNOWN_CODE_OR_IDENTITY");
  assert.equal(plan.summary.reviewUnknownCodeOrIdentityCount, 1);
}

// ─── 17. Phase 2D.3 SAFETY CORRECTION: no hard-coded / substring-driven ambiguity in production ──
// GOKBORA/ERMAN GOKBORA and NAZMICAN/NAZMI TARAKCI/NAZIM BAHADIR are NOT confirmed the same
// people. By default (no human-supplied review rule), they must NOT be forced into
// REVIEW_REQUIRED — same-workbook similarity is informational only.

{
  const mockWb = createMockWorkbook([
    { name: "GOKBORA" },
    { name: "ERMAN GOKBORA" },
  ]);
  const discovery = discoverPersonnelWorkbook(mockWb); // no humanSuppliedAmbiguityGroups
  assert.equal(discovery.sheetIdentityAmbiguityGroups.length, 0, "no hard-coded group may exist without an explicit human-supplied rule");

  const plan = buildPersonnelMasterImportPlan(discovery, [], []);
  assert.ok(plan.proposals.every(p => p.category === "PROPOSED_NEW_RESOURCE"), "substring similarity alone must never force REVIEW_REQUIRED");
  assert.ok(plan.proposals.every(p => p.businessBucket === "CLEAN_GUIDE_CANDIDATE"));
  assert.equal(plan.summary.reviewTrueIdentityAmbiguityCount, 0);
  // The relationship IS still surfaced, but purely as an informational note.
  const gokbora = plan.proposals.find(p => p.rawName === "GOKBORA");
  assert.ok(gokbora);
  assert.equal(gokbora.sameWorkbookSimilarityNotes.length, 1);
  assert.equal(gokbora.sameWorkbookSimilarityNotes[0]?.basis, "INFORMATIONAL_SUGGESTION");
  assert.equal(gokbora.sameWorkbookSimilarityNotes[0]?.rawName, "ERMAN GOKBORA");
}

{
  // A short name being a substring of a longer one is common and must NOT be ambiguous
  // (e.g. "ALI" inside "MEHMET ALI").
  const mockWb = createMockWorkbook([{ name: "ALI" }, { name: "MEHMET ALI" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  assert.equal(discovery.sheetIdentityAmbiguityGroups.length, 0);
  const plan = buildPersonnelMasterImportPlan(discovery, [], []);
  assert.ok(plan.proposals.every(p => p.category === "PROPOSED_NEW_RESOURCE"));
  assert.ok(plan.proposals.every(p => p.businessBucket === "CLEAN_GUIDE_CANDIDATE"));
  // "ALI" is only 3 characters — below the 4-character floor — so it gets no similarity note either.
  const ali = plan.proposals.find(p => p.rawName === "ALI");
  assert.equal(ali?.sameWorkbookSimilarityNotes.length, 0);
}

{
  // NAZMICAN / NAZMI TARAKCI / NAZIM BAHADIR: no substring-containment relationship exists between
  // these (verified against the real names), so with no human-supplied rule there is neither a
  // forced-ambiguity group NOR an automatic similarity note — this is a known, honestly-disclosed
  // limitation of pure string algorithms; a human must supply this pairing explicitly if it matters.
  const mockWb = createMockWorkbook([
    { name: "NAZMICAN" },
    { name: "NAZMI TARAKCI" },
    { name: "NAZIM  BAHADIR" },
  ]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  assert.equal(discovery.sheetIdentityAmbiguityGroups.length, 0);
  const plan = buildPersonnelMasterImportPlan(discovery, [], []);
  assert.equal(plan.summary.reviewTrueIdentityAmbiguityCount, 0);
  const nazmican = plan.proposals.find(p => p.rawName === "NAZMICAN");
  assert.equal(nazmican?.sameWorkbookSimilarityNotes.length, 0);
}

{
  // Explicit human-supplied review rule IS the only way to force REVIEW_TRUE_IDENTITY_AMBIGUITY
  // for a cross-sheet pairing. This must be opted in per call — never a file-level default.
  const mockWb = createMockWorkbook([
    { name: "NAZMICAN" },
    { name: "NAZMI TARAKCI" },
    { name: "NAZIM  BAHADIR" },
  ]);
  const discovery = discoverPersonnelWorkbook(mockWb, {
    humanSuppliedAmbiguityGroups: [["NAZMICAN", "NAZMI TARAKCI", "NAZIM BAHADIR"]],
  });
  assert.equal(discovery.sheetIdentityAmbiguityGroups.length, 1);
  assert.equal(discovery.sheetIdentityAmbiguityGroups[0]?.basis, "HUMAN_SUPPLIED_GROUP");
  assert.equal(discovery.sheetIdentityAmbiguityGroups[0]?.normalizedNames.length, 3);

  const plan = buildPersonnelMasterImportPlan(discovery, [], []);
  assert.equal(plan.summary.reviewTrueIdentityAmbiguityCount, 3);
  assert.ok(plan.proposals.every(p => p.category === "REVIEW_REQUIRED"));
  assert.ok(plan.proposals.every(p => p.matchedResourceId === null));
}

// ─── 18. Phase 2D.3 correction: footer/KPI rows excluded from the data-row count ──
// Vocabulary verified against the real PERFORMANS RAPORU-2026.xlsx footer block. The row's own
// cell values are read only to detect a footer label — nothing is rewritten, nothing is removed
// from the workbook, and the sheet itself is never dropped for this reason.

{
  const mockWb = createMockWorkbook([
    {
      name: "AHMET YILMAZ",
      rows: [
        ["Date", "Tour", "Pax"],
        ["2026-05-01", "Ephesus Full Day", "12"],
        ["2026-05-02", "Pamukkale", "8"],
        ["TOPLAM", "", "20"],
        ["TUR SAYISI", "2"],
        ["PAX", "20"],
        ["YORUM %", "100"],
        ["BILET SATISI %", "50"],
        ["YEMEK SATISI %", "50"],
        ["TUR/HALI %", "100"],
        ["TUR/DERI %", "100"],
      ],
    },
  ]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  assert.equal(discovery.sheets[0]?.totalRows, 11, "footer rows are still counted as physical rows (1 header + 2 data + 8 footer)");
  assert.equal(discovery.sheets[0]?.dataRowCount, 2, "the real 8-row TOPLAM/TUR SAYISI/PAX/YORUM %/BILET SATISI %/YEMEK SATISI %/TUR-HALI %/TUR-DERI % footer block must not be counted as tour rows");
  assert.equal(discovery.sheets[0]?.footerOrKpiRowsExcluded, 8);
  assert.equal(discovery.totalFooterOrKpiRowsExcluded, 8);
  assert.ok(discovery.sheets[0]?.notes.some(n => n.startsWith("FOOTER_OR_KPI_ROWS_EXCLUDED_")));
}

// ─── 19. Phase 2D.3 correction: rawName is preserved exactly, including incidental whitespace ──
// The real workbook has a sheet literally named "CEYLA " (trailing space) and "NAZIM  BAHADIR"
// (double internal space) — these must be stored byte-for-byte, never trimmed or collapsed.

{
  const mockWb = createMockWorkbook([{ name: "CEYLA " }, { name: "NAZIM  BAHADIR" }]);
  const discovery = discoverPersonnelWorkbook(mockWb);
  assert.equal(discovery.sheets[0]?.rawSheetName, "CEYLA ", "trailing whitespace must be preserved exactly");
  assert.equal(discovery.sheets[1]?.rawSheetName, "NAZIM  BAHADIR", "internal double space must be preserved exactly");
  // Matching is unaffected — normalization still strips whitespace for comparison purposes.
  assert.equal(discovery.sheets[0]?.normalizedSheetName, "ceyla");
  const plan = buildPersonnelMasterImportPlan(discovery, [], []);
  assert.equal(plan.proposals.find(p => p.normalizedName === "ceyla")?.rawName, "CEYLA ");
}

console.log("personnel-master-import-self-test: 22 suites passed");
