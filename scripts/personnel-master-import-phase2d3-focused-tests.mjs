import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function read(relPath) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

const parserSource = read("../artifacts/api-server/src/lib/personnel-import-parser.ts");
const dryRunSource = read("../artifacts/api-server/src/personnel-master-import-dry-run.ts");
const docSource = read("../docs/architecture/phase2d3-personnel-master-import.md");
const rootPkgSource = read("../package.json");
const apiPkgSource = read("../artifacts/api-server/package.json");

let assertions = 0;
function check(condition, msg) {
  assert.ok(condition, msg);
  assertions += 1;
}

// ─── 1. Static Safety & Zero DB Mutation Guarantees ───────────────────────

check(
  !/\bdb\.(insert|update|delete)\b/.test(parserSource),
  "personnel-import-parser.ts must not contain DB write statements",
);
check(
  !/\bdb\.(insert|update|delete)\b/.test(dryRunSource),
  "personnel-master-import-dry-run.ts must not contain DB write statements",
);
check(
  !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i.test(parserSource),
  "parser must not contain raw SQL mutation statements",
);

// ─── 2. ESMA & Template Special Case Rules in Code ────────────────────────

check(
  /isEsmaSpecialCase/.test(parserSource) && /REVIEW_REQUIRED/.test(parserSource),
  "ESMA must be explicitly flagged and routed to REVIEW_REQUIRED",
);
check(
  /isTemplateSheetName/.test(parserSource) && /ornek/.test(parserSource),
  "Template sheets (ORNEK/ÖRNEK/TEMPLATE) must be identified and excluded",
);

// ─── 3. Human Approval Model Invariants ───────────────────────────────────

check(
  /MATCH_EXISTING_RESOURCE/.test(parserSource) &&
  /CREATE_NEW_RESOURCE/.test(parserSource) &&
  /ADD_ALIAS/.test(parserSource) &&
  /REJECT/.test(parserSource) &&
  /DEFER/.test(parserSource),
  "Human approval decision types must cover all 5 required actions",
);

// ─── 4. Package.json Scripts & Documentation Invariants ───────────────────

check(
  rootPkgSource.includes("test:personnel-master-import-phase2d3"),
  "root package.json must contain test:personnel-master-import-phase2d3",
);
check(
  apiPkgSource.includes("personnel:import-dry-run"),
  "api-server package.json must contain personnel:import-dry-run",
);
check(
  docSource.includes("Phase 2D.3: Personnel Master Data Import / Matching Foundation"),
  "architecture doc must exist and contain title",
);
check(
  docSource.includes("PERFORMANS RAPORU-2026.xlsx"),
  "architecture doc must document PERFORMANS RAPORU-2026.xlsx",
);

// ─── 5. Phase 2D.3 business-rule correction invariants (initial pass) ─────

check(
  !/split\(\s*["'`] ["'`]\s*\)\.length\s*===?\s*1/.test(parserSource),
  "no word-count/mononym rule may exist anywhere in the parser (operator correction: single-word names are never auto-flagged)",
);
check(
  /isTaylanSpecialCase/.test(parserSource) && /ACCOUNTING_PERSONNEL/.test(parserSource),
  "TAYLAN must be explicitly classified as ACCOUNTING_PERSONNEL",
);
check(
  /OPERATIONS_PERSONNEL/.test(parserSource),
  "ESMA's confirmed business role (OPERATIONS_PERSONNEL) must be present in source",
);
check(
  /DEFER_TYPE_UNSUPPORTED/.test(parserSource),
  "TAYLAN's canonical resource creation must be explicitly deferred (resources.type is GUIDE/DRIVER only)",
);
check(
  ["CLEAN_GUIDE_CANDIDATE", "REVIEW_TRUE_IDENTITY_AMBIGUITY", "REVIEW_UNKNOWN_CODE_OR_IDENTITY", "NON_GUIDE_PERSONNEL", "GUIDE_NAME_DISPLAY_REVIEW"]
    .every(bucket => parserSource.includes(bucket)),
  "all 5 business classification buckets (post-rename: GUIDE_NAME_DISPLAY_REVIEW) must be present in source",
);
check(
  /hasHonorificOrAbbreviation/.test(parserSource),
  "honorific/abbreviation names must be flagged informationally, not rejected",
);
check(
  /FOOTER_OR_KPI_ROW_KEYWORDS/.test(parserSource) && /toplam/.test(parserSource),
  "footer/KPI row exclusion (e.g. TOPLAM) must be present in the row-count logic",
);

// ─── 6. Phase 2D.3 FINAL SAFETY CORRECTION invariants ─────────────────────
// (removal of hard-coded ambiguity groups; substring/fuzzy similarity demoted
// to informational-only; see "TourPilot Phase 2D.3 — FINAL REAL WORKBOOK
// VALIDATION + AMBIGUITY SAFETY" operator instruction.)

check(
  !/KNOWN_IDENTITY_AMBIGUITY_GROUPS/.test(parserSource),
  "the removed hard-coded KNOWN_IDENTITY_AMBIGUITY_GROUPS constant must never reappear in production source",
);
check(
  /humanSuppliedGroups(:\s*string\[\]\[\])?\s*=\s*\[\]/.test(parserSource),
  "detectSheetIdentityAmbiguityGroups must default to an empty humanSuppliedGroups array — GOKBORA/NAZMICAN may appear only as documentation examples/test fixtures, never as a hard-coded production default",
);
check(
  /humanSuppliedAmbiguityGroups/.test(parserSource) && /HUMAN_SUPPLIED_GROUP/.test(parserSource),
  "cross-sheet identity ambiguity groups must only ever originate from an explicit, caller-supplied humanSuppliedAmbiguityGroups parameter",
);
check(
  /--human-ambiguity-groups-json/.test(dryRunSource),
  "the CLI must expose an explicit, opt-in flag for human-supplied ambiguity review rules (no hard-coded default)",
);
check(
  /INFORMATIONAL_SUGGESTION/.test(parserSource) && /sameWorkbookSimilarityNotes/.test(parserSource),
  "same-workbook substring/fuzzy similarity must be surfaced only as a structural INFORMATIONAL_SUGGESTION field, never as forced review",
);
check(
  /computeSameWorkbookSimilarityNotes/.test(parserSource),
  "substring-containment detection must be isolated in its own function whose output cannot affect category/businessBucket/matchedResourceId",
);
check(
  /if\s*\(\s*matchResult\.status\s*===\s*["'`]AMBIGUOUS["'`]\s*\|\|\s*ambiguityGroup\s*\)/.test(parserSource),
  "REVIEW_TRUE_IDENTITY_AMBIGUITY must be gated only by matchResourceIdentity's own AMBIGUOUS status or an explicit human-supplied ambiguityGroup",
);
check(
  docSource.includes("HUMAN_SUPPLIED_GROUP") || docSource.includes("INFORMATIONAL_SUGGESTION"),
  "architecture doc must describe the final safety-correction design (human-supplied groups / informational similarity notes)",
);

// ─── 7. Run Pure TS Self-Test Suite via TSX ───────────────────────────────

const tsx = new URL("../artifacts/api-server/node_modules/.bin/tsx", import.meta.url).pathname;
const selfTest = new URL("../artifacts/api-server/src/personnel-master-import-self-test.ts", import.meta.url).pathname;

const result = spawnSync(tsx, [selfTest], {
  encoding: "utf8",
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost:5432/unused",
  },
});

assert.equal(result.status, 0, result.stderr || result.stdout);
check(
  result.stdout.includes("22 suites passed"),
  "all 22 pure test suites must pass in self-test",
);

console.log(`personnel-master-import-phase2d3: all ${assertions + 22} focused safety assertions passed!`);
