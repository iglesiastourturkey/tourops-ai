import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Focused tests for permanent deletion of reservations and operations:
// artifacts/api-server/src/lib/deletion-rules.ts and the two endpoints that use
// it. Deletion is irreversible, so the assertions here are mostly about what
// must NOT happen — the guards that refuse, and the ordering that keeps an
// operation's reservation usable afterwards.
//
// Same mirror + source-assertion shape as the neighbouring suites: the rules are
// re-stated as pure functions, and the source assertions at the bottom fail if
// the real implementation drifts from them.

const RULES_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/lib/deletion-rules.ts", import.meta.url),
  "utf8",
);
const RESERVATIONS_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/reservations.ts", import.meta.url),
  "utf8",
);
const OPERATIONS_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/operations.ts", import.meta.url),
  "utf8",
);
const SEED_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/lib/seed-permissions.ts", import.meta.url),
  "utf8",
);

// ── Mirrors ──────────────────────────────────────────────────────────────────

function reservationDeleteBlock(status, operationId) {
  if (status === "draft_created" || operationId !== null) return { code: "operation_linked" };
  return null;
}

function financialLockBlock(transactions) {
  const locked = transactions.filter(
    (row) => row.accountingStatus === "approved" || row.paymentStatus === "paid",
  );
  return locked.length === 0 ? null : { code: "financial_records_linked", lockedCount: locked.length };
}

// ── 1. A converted reservation is never deletable from the inbox ─────────────
// Its operation would be left claiming an origin that no longer exists, and the
// create-draft replay would lose the row it checks.
assert.deepEqual(reservationDeleteBlock("draft_created", 42), { code: "operation_linked" });
// Belt and braces: the status and the FK are checked independently, so a row
// that lost one of the two is still refused.
assert.deepEqual(reservationDeleteBlock("draft_created", null), { code: "operation_linked" });
assert.deepEqual(reservationDeleteBlock("pending_review", 42), { code: "operation_linked" });

// Everything else in the inbox may go.
for (const status of ["new", "analyzing", "pending_review", "missing_information", "error", "rejected"]) {
  assert.equal(reservationDeleteBlock(status, null), null, `${status} should be deletable`);
}

// ── 2. Settled money blocks an operation delete ──────────────────────────────
const unsettled = [{ accountingStatus: "pending", paymentStatus: "unpaid" }];
assert.equal(financialLockBlock([]), null);
assert.equal(financialLockBlock(unsettled), null);
assert.equal(financialLockBlock([{ accountingStatus: "rejected", paymentStatus: "unpaid" }]), null);
// Approved accounting alone is enough...
assert.deepEqual(
  financialLockBlock([{ accountingStatus: "approved", paymentStatus: "unpaid" }]),
  { code: "financial_records_linked", lockedCount: 1 },
);
// ...and so is a payment that already went out.
assert.deepEqual(
  financialLockBlock([{ accountingStatus: "pending", paymentStatus: "paid" }]),
  { code: "financial_records_linked", lockedCount: 1 },
);
// Only the locked ones are counted, and one locked row among many still blocks.
assert.deepEqual(
  financialLockBlock([...unsettled, { accountingStatus: "approved", paymentStatus: "paid" }, ...unsettled]),
  { code: "financial_records_linked", lockedCount: 1 },
);

// ── Source assertions ────────────────────────────────────────────────────────

// The two conditions above are the whole guard; a loosened operator here would
// silently let a cash-book record be orphaned.
assert.ok(
  /row\.accountingStatus === "approved" \|\| row\.paymentStatus === "paid"/.test(RULES_SOURCE),
  "the financial lock must trigger on approved accounting OR a completed payment",
);
assert.ok(
  /status === "draft_created" \|\| operationId !== null/.test(RULES_SOURCE),
  "a converted reservation must be refused on either the status or the FK",
);

// ── Permissions: deletion is not part of the day-to-day grants ───────────────
const matrixRow = (module, action) =>
  SEED_SOURCE.match(new RegExp(`\\["${module}",\\s*"${action}",\\s*\\[([^\\]]*)\\]`))?.[1] ?? null;

const reservationsDelete = matrixRow("reservations", "delete");
assert.ok(reservationsDelete !== null, "reservations.delete is missing from the permission matrix");
assert.ok(/"admin"/.test(reservationsDelete), "reservations.delete must be granted to admin");
assert.ok(
  !/"operations"|"guide"|"accounting"|"field_operations"/.test(reservationsDelete),
  "reservations.delete must not be granted to the non-admin roles",
);

const operationsPurge = matrixRow("operations", "purge");
assert.ok(operationsPurge !== null, "operations.purge is missing from the permission matrix");
assert.ok(/"admin"/.test(operationsPurge), "operations.purge must be granted to admin");
assert.ok(
  !/"operations"|"guide"|"accounting"|"field_operations"/.test(operationsPurge),
  "operations.purge must not be granted to the non-admin roles",
);
// The sub-resource grant is untouched: narrowing it would have taken task and
// document deletion away from the operations role.
assert.ok(
  /"operations"/.test(matrixRow("operations", "delete") ?? ""),
  "operations.delete must keep its existing operations-role grant",
);

// ── Endpoints are behind those permissions ───────────────────────────────────
assert.ok(
  /router\.delete\("\/:id", requirePermission\("reservations", "delete"\)/.test(RESERVATIONS_SOURCE),
  "DELETE /reservations/:id must require reservations.delete",
);
assert.ok(
  /router\.delete\("\/:id", requirePermission\("operations", "purge"\)/.test(OPERATIONS_SOURCE),
  "DELETE /operations/:id must require operations.purge",
);

const operationDeleteSource = OPERATIONS_SOURCE.slice(
  OPERATIONS_SOURCE.indexOf('router.delete("/:id", requirePermission("operations", "purge")'),
);

// Guards must run before anything is destroyed — including the storage cleanup,
// which is not transactional and cannot be rolled back.
const financialGuardAt = operationDeleteSource.indexOf("financialLockBlock");
const gcsDeleteAt = operationDeleteSource.indexOf("file.delete()");
const rowDeleteAt = operationDeleteSource.indexOf("tx.delete(operationsTable)");
assert.ok(financialGuardAt >= 0, "the financial guard is missing from the operation delete");
assert.ok(gcsDeleteAt >= 0 && rowDeleteAt >= 0, "the delete steps were not found — update this assertion");
assert.ok(
  financialGuardAt < gcsDeleteAt && financialGuardAt < rowDeleteAt,
  "the financial guard must run before any receipt photo or row is deleted",
);
// Storage cleanup goes last. The other order leaves receipt rows in the database
// pointing at objects that were already deleted when the transaction fails —
// unrepairable, where the reverse merely strands an unreferenced object.
assert.ok(
  rowDeleteAt < gcsDeleteAt,
  "receipt photos must only be deleted after the database transaction has committed",
);

// Rows that merely lose their operation_id must not be reported as deleted.
assert.ok(
  /detachedRecords: \{ \.\.\.detachedCounts/.test(operationDeleteSource),
  "incidents and accounting documents are SET NULL — the audit entry must not call them deleted",
);
assert.ok(
  !/deletedChildren: \{[^}]*incidents/.test(operationDeleteSource),
  "incidents must not be counted under deletedChildren",
);
// quotations.converted_operation_id has no FK, so the purge has to clear it or
// the quote keeps a link to a row that no longer exists.
assert.ok(
  /tx\.update\(quotationsTable\)[\s\S]{0,160}convertedOperationId: null/.test(operationDeleteSource),
  "the purge must clear quotations.convertedOperationId inside the transaction",
);
assert.ok(
  /orphanedObjectPaths/.test(operationDeleteSource),
  "storage objects left behind must be recorded in the audit entry so they remain findable",
);

// Child counts are only obtainable before the delete; the audit entry is the
// only record of them afterwards.
const countsAt = operationDeleteSource.indexOf("countRowsFor");
assert.ok(countsAt >= 0 && countsAt < rowDeleteAt, "child rows must be counted before the delete");
assert.ok(
  /eventType: "operation_purged"/.test(operationDeleteSource),
  "the operation delete must write an audit entry",
);
assert.ok(
  /eventType: "reservation_import_deleted"/.test(RESERVATIONS_SOURCE),
  "the reservation delete must write an audit entry",
);

// The deleted reservation's audit snapshot must not carry the email itself.
const reservationDeleteSource = RESERVATIONS_SOURCE.slice(
  RESERVATIONS_SOURCE.indexOf('router.delete("/:id", requirePermission("reservations", "delete")'),
);
const auditBlock = reservationDeleteSource.slice(
  reservationDeleteSource.indexOf("oldValue:"),
  reservationDeleteSource.indexOf("description:"),
);
for (const field of ["plainTextBody", "sanitizedHtmlBody", "attachments:"]) {
  assert.ok(
    !auditBlock.includes(field),
    `the deletion audit snapshot must not include ${field} — that is the customer's correspondence`,
  );
}

// An operation delete must hand its reservation back to the review queue,
// otherwise the import keeps a terminal status with a nulled operationId and the
// state machine freezes it out of every action, including reject.
assert.ok(
  /IMPORT_STATUS_AFTER_OPERATION_DELETE/.test(operationDeleteSource),
  "the operation delete must reset the linked import's status",
);
assert.ok(
  /export const IMPORT_STATUS_AFTER_OPERATION_DELETE = "pending_review"/.test(RULES_SOURCE),
  "the released import must land on pending_review",
);
assert.ok(
  /operationId: null, status: IMPORT_STATUS_AFTER_OPERATION_DELETE/.test(operationDeleteSource),
  "releasing the import must clear operationId and set the status together",
);
// Deleting the reservation alongside the operation is opt-in.
assert.ok(
  /req\.query\.withReservation === "true"/.test(operationDeleteSource),
  "deleting the linked reservation must be opt-in via an explicit query flag",
);

console.log("deletion guard focused tests: passed");
