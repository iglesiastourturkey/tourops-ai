/**
 * Rules governing permanent deletion of reservations and operations.
 *
 * Deletion here is a hard delete: the row and everything the database cascades
 * from it are gone. The archived status (operations.archive) remains the
 * reversible path — this one is for records that should never have existed,
 * chiefly test data. Because it cannot be undone, the rules below are
 * deliberately conservative and live in one pure module so they can be read,
 * tested and argued about without a database.
 */

/** Transaction fields that decide whether money has already been committed. */
export interface FinancialLinkRow {
  accountingStatus: string;
  paymentStatus: string;
}

/**
 * Reservation imports that may be deleted.
 *
 * draft_created is excluded: that import is the provenance of a live operation.
 * The FK would null the operation's sourceEmailImportId and leave it claiming an
 * origin nobody can look up, and the idempotent create-draft replay would lose
 * the row it checks. Deleting the operation first is the supported order — that
 * path releases the import back to pending_review.
 */
export function reservationDeleteBlock(
  status: string,
  operationId: number | null,
): { message: string; code: string } | null {
  if (status === "draft_created" || operationId !== null) {
    return {
      message:
        "Bu rezervasyondan operasyon taslağı oluşturulmuş. Önce ilgili operasyonu silin, " +
        "sonra bu kaydı silebilirsiniz.",
      code: "operation_linked",
    };
  }
  return null;
}

/**
 * Accounting rows that stop an operation from being deleted.
 *
 * An approved or paid transaction is a cash-book record. The FK would set its
 * operationId (and, through the receipts cascade, its receiptId) to NULL,
 * quietly leaving an approved amount attached to nothing — the same link that
 * PATCH /receipts refuses to let anyone edit once accounting has signed off.
 * Unsettled rows (pending/rejected, unpaid) carry no such commitment and are
 * allowed through; they are reported in the audit entry instead.
 */
export function financialLockBlock(
  transactions: readonly FinancialLinkRow[],
): { message: string; code: string; lockedCount: number } | null {
  const locked = transactions.filter(
    row => row.accountingStatus === "approved" || row.paymentStatus === "paid",
  );
  if (locked.length === 0) return null;
  return {
    message:
      `Bu operasyona bağlı ${locked.length} onaylanmış/ödenmiş muhasebe kaydı var. ` +
      "Operasyon silinirse bu kayıtlar sahipsiz kalır. Önce muhasebe tarafında ilişkiyi çözün.",
    code: "financial_records_linked",
    lockedCount: locked.length,
  };
}

/**
 * The status a reservation import returns to when its operation is deleted but
 * the import itself is kept.
 *
 * Without this the import keeps its terminal draft_created status while its
 * operationId is nulled by the FK, and the inbox state machine then refuses
 * every action on it — analyze, review, create-draft and reject alike. The
 * reviewer's approved data survives, so pending_review is where it belongs:
 * ready to be drafted again or rejected.
 */
export const IMPORT_STATUS_AFTER_OPERATION_DELETE = "pending_review";
