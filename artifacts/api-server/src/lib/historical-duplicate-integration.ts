import type { HistoricalDuplicateClassification } from "./historical-duplicate-classification";

export type HistoricalDuplicateIntegrationIssue =
  | "possible_duplicate_content"
  | "ambiguous_duplicate_content"
  | "supplementary_booking_row";

export function duplicateClassificationToIssues(
  classification: HistoricalDuplicateClassification,
): HistoricalDuplicateIntegrationIssue[] {
  switch (classification) {
    case "REAL_DUPLICATE":
      return ["possible_duplicate_content"];

    case "AMBIGUOUS":
      return ["ambiguous_duplicate_content"];

    case "SAME_BOOKING_SUPPLEMENTARY_ROW":
      return ["supplementary_booking_row"];

    case "SAME_BOOKING_DIFFERENT_SERVICE":
      return [];
  }
}
