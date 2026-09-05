import fixture from "./fixtures/historical-duplicate-regression.json";

import {
  classifyHistoricalDuplicateGroup,
  type HistoricalDuplicateClassification,
} from "./lib/historical-duplicate-classification";

type FixtureCandidate = {
  sourceKind: string;
  worksheetName: string;
  sourceRow: number;
  operationDate: string;
  tourType: string | null;
  customerName: string | null;
  agency: string | null;
  operator: string | null;
  adultCount: number | null;
  childCount: number | null;
  pickupTime: string | null;
  pickupPoint: string | null;
  language: string | null;
  tourSection: string | null;
  notes: string | null;
};

type FixtureGroup = {
  group: number;
  customer: string;
  expected: HistoricalDuplicateClassification;
  candidates: FixtureCandidate[];
};

const groups = fixture as FixtureGroup[];

let passed = 0;

for (const group of groups) {
  const actual = classifyHistoricalDuplicateGroup(group.candidates);

  if (actual !== group.expected) {
    throw new Error(
      [
        `duplicate regression failed`,
        `group=${group.group}`,
        `customer=${group.customer}`,
        `expected=${group.expected}`,
        `actual=${actual}`,
      ].join(" "),
    );
  }

  passed += 1;
}

const counts = groups.reduce<Record<HistoricalDuplicateClassification, number>>(
  (acc, group) => {
    acc[group.expected] += 1;
    return acc;
  },
  {
    REAL_DUPLICATE: 0,
    SAME_BOOKING_SUPPLEMENTARY_ROW: 0,
    SAME_BOOKING_DIFFERENT_SERVICE: 0,
    AMBIGUOUS: 0,
  },
);

console.log("historical_duplicate_classification_self_test: PASS");
console.log("groups:", passed);
console.log("supplementary:", counts.SAME_BOOKING_SUPPLEMENTARY_ROW);
console.log("different_service:", counts.SAME_BOOKING_DIFFERENT_SERVICE);
console.log("real_duplicate:", counts.REAL_DUPLICATE);
console.log("ambiguous:", counts.AMBIGUOUS);

const baseSynthetic: FixtureCandidate = {
  sourceKind: "gemi",
  worksheetName: "15",
  sourceRow: 10,
  operationDate: "2026-09-15",
  tourType: "PVT",
  customerName: "SYNTHETIC CUSTOMER",
  agency: "VIATOR",
  operator: "IGLESIAS",
  adultCount: 2,
  childCount: 0,
  pickupTime: "08:30",
  pickupPoint: "KUS LIMAN",
  language: "ING",
  tourSection: "PRIVATE EPHESUS TOUR",
  notes: "EFES - M.ANA - ARTEMIS",
};

const exactRepeatedContent: FixtureCandidate = {
  ...baseSynthetic,
  sourceRow: 20,
};

if (
  classifyHistoricalDuplicateGroup([
    baseSynthetic,
    exactRepeatedContent,
  ]) !== "REAL_DUPLICATE"
) {
  throw new Error("expected exact repeated content to classify as REAL_DUPLICATE");
}

const differentCore: FixtureCandidate = {
  ...baseSynthetic,
  sourceRow: 21,
  adultCount: 3,
};

if (
  classifyHistoricalDuplicateGroup([
    baseSynthetic,
    differentCore,
  ]) !== "AMBIGUOUS"
) {
  throw new Error("expected different core content to classify as AMBIGUOUS");
}

if (
  classifyHistoricalDuplicateGroup([
    baseSynthetic,
  ]) !== "AMBIGUOUS"
) {
  throw new Error("expected single-candidate group to classify as AMBIGUOUS");
}

console.log("synthetic_guardrails: PASS");

const arbitrarySectionVariant: FixtureCandidate = {
  ...baseSynthetic,
  sourceRow: 30,
  tourSection: "SOME UNRELATED RAW CELL TEXT",
  notes: "EFES - M.ANA - ARTEMIS",
};

if (
  classifyHistoricalDuplicateGroup([
    baseSynthetic,
    arbitrarySectionVariant,
  ]) !== "AMBIGUOUS"
) {
  throw new Error(
    "expected arbitrary tourSectionRaw difference to remain AMBIGUOUS",
  );
}

console.log("conservative_section_guardrail: PASS");

const nullChildCount: FixtureCandidate = {
  ...baseSynthetic,
  sourceRow: 40,
  childCount: null,
};

const zeroChildCount: FixtureCandidate = {
  ...baseSynthetic,
  sourceRow: 41,
  childCount: 0,
};

if (
  classifyHistoricalDuplicateGroup([
    nullChildCount,
    zeroChildCount,
  ]) !== "REAL_DUPLICATE"
) {
  throw new Error(
    "expected childCount null and 0 to be semantically equivalent",
  );
}

console.log("child_count_null_zero_guardrail: PASS");
