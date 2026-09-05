import {
  duplicateClassificationToIssues,
} from "./lib/historical-duplicate-integration";

const cases = [
  {
    classification: "REAL_DUPLICATE" as const,
    expectedIssues: ["possible_duplicate_content"],
  },
  {
    classification: "AMBIGUOUS" as const,
    expectedIssues: ["ambiguous_duplicate_content"],
  },
  {
    classification: "SAME_BOOKING_SUPPLEMENTARY_ROW" as const,
    expectedIssues: ["supplementary_booking_row"],
  },
  {
    classification: "SAME_BOOKING_DIFFERENT_SERVICE" as const,
    expectedIssues: [],
  },
];

for (const testCase of cases) {
  const actual = duplicateClassificationToIssues(
    testCase.classification,
  );

  if (JSON.stringify(actual) !== JSON.stringify(testCase.expectedIssues)) {
    throw new Error(
      [
        "duplicate integration mismatch",
        `classification=${testCase.classification}`,
        `expected=${JSON.stringify(testCase.expectedIssues)}`,
        `actual=${JSON.stringify(actual)}`,
      ].join(" "),
    );
  }
}

console.log("historical_duplicate_integration_self_test: PASS");
console.log("cases:", cases.length);
