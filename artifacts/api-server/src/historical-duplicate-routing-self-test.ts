import {
  routeHistoricalDuplicateClassification,
  type HistoricalDuplicateRoute,
} from "./lib/historical-duplicate-routing";

const cases: Array<{
  classification:
    | "REAL_DUPLICATE"
    | "SAME_BOOKING_SUPPLEMENTARY_ROW"
    | "SAME_BOOKING_DIFFERENT_SERVICE"
    | "AMBIGUOUS";
  expected: HistoricalDuplicateRoute;
}> = [
  {
    classification: "REAL_DUPLICATE",
    expected: {
      duplicateBlocker: true,
      manualReview: true,
      supplementaryReview: false,
      allowNormalFlow: false,
    },
  },
  {
    classification: "SAME_BOOKING_SUPPLEMENTARY_ROW",
    expected: {
      duplicateBlocker: false,
      manualReview: true,
      supplementaryReview: true,
      allowNormalFlow: false,
    },
  },
  {
    classification: "SAME_BOOKING_DIFFERENT_SERVICE",
    expected: {
      duplicateBlocker: false,
      manualReview: false,
      supplementaryReview: false,
      allowNormalFlow: true,
    },
  },
  {
    classification: "AMBIGUOUS",
    expected: {
      duplicateBlocker: false,
      manualReview: true,
      supplementaryReview: false,
      allowNormalFlow: false,
    },
  },
];

for (const testCase of cases) {
  const actual = routeHistoricalDuplicateClassification(
    testCase.classification,
  );

  if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
    throw new Error(
      [
        "historical duplicate routing mismatch",
        `classification=${testCase.classification}`,
        `expected=${JSON.stringify(testCase.expected)}`,
        `actual=${JSON.stringify(actual)}`,
      ].join(" "),
    );
  }
}

console.log("historical_duplicate_routing_self_test: PASS");
console.log("cases:", cases.length);
