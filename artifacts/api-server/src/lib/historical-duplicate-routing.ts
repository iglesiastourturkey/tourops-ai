import type { HistoricalDuplicateClassification } from "./historical-duplicate-classification";

export interface HistoricalDuplicateRoute {
  duplicateBlocker: boolean;
  manualReview: boolean;
  supplementaryReview: boolean;
  allowNormalFlow: boolean;
}

export function routeHistoricalDuplicateClassification(
  classification: HistoricalDuplicateClassification,
): HistoricalDuplicateRoute {
  switch (classification) {
    case "REAL_DUPLICATE":
      return {
        duplicateBlocker: true,
        manualReview: true,
        supplementaryReview: false,
        allowNormalFlow: false,
      };

    case "SAME_BOOKING_SUPPLEMENTARY_ROW":
      return {
        duplicateBlocker: false,
        manualReview: true,
        supplementaryReview: true,
        allowNormalFlow: false,
      };

    case "SAME_BOOKING_DIFFERENT_SERVICE":
      return {
        duplicateBlocker: false,
        manualReview: false,
        supplementaryReview: false,
        allowNormalFlow: true,
      };

    case "AMBIGUOUS":
      return {
        duplicateBlocker: false,
        manualReview: true,
        supplementaryReview: false,
        allowNormalFlow: false,
      };
  }
}
