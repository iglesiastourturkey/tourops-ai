import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Focused tests for the Faz 5.3 sheet-import hardening pass:
// artifacts/api-server/src/routes/sheet-import.ts, plus the schema/migration
// pair backing the re-approval fix. Same shape as the other suites here -
// source assertions against the real files, because the route mixes
// express + a live db.transaction() and is not usefully mirrored as pure
// functions. These fail loudly if the real implementation drifts from what
// this suite pins down.
//
// The two behaviors under test both come from confirmed findings in the
// GEMI ingestion architecture review:
//   1. /approve used to always insert a brand-new customer, never matching
//      an existing one by phone/email.
//   2. Approving an edited, already-approved GEMI row used to insert a
//      second operation instead of updating the one the first approval
//      created (approvedAt being nulled on every edit made this
//      undetectable at review time).

const ROUTE_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/sheet-import.ts", import.meta.url),
  "utf8",
);
const SCHEMA_SOURCE = readFileSync(
  new URL("../lib/db/src/schema/operations.ts", import.meta.url),
  "utf8",
);
const MIGRATION_SOURCE = readFileSync(
  new URL("../lib/db/migrations/0018_operations_source_sheet_import_unique.sql", import.meta.url),
  "utf8",
);
const REVIEW_PAGE_SOURCE = readFileSync(
  new URL("../artifacts/tourops-ai/src/pages/sheet-import-review.tsx", import.meta.url),
  "utf8",
);

const webhookSource = ROUTE_SOURCE.slice(
  ROUTE_SOURCE.indexOf('router.post("/webhook"'),
  ROUTE_SOURCE.indexOf('router.use(requireAuth'),
);
const listSource = ROUTE_SOURCE.slice(
  ROUTE_SOURCE.indexOf('router.get("/", async'),
  ROUTE_SOURCE.indexOf('const NAME_FRAGMENTS'),
);
const reviewSource = ROUTE_SOURCE.slice(
  ROUTE_SOURCE.indexOf('router.patch("/:id/review"'),
  ROUTE_SOURCE.indexOf('router.post("/:id/approve"'),
);
const approveSource = ROUTE_SOURCE.slice(
  ROUTE_SOURCE.indexOf('router.post("/:id/approve"'),
  ROUTE_SOURCE.indexOf('router.post("/:id/reject"'),
);
const rejectSource = ROUTE_SOURCE.slice(ROUTE_SOURCE.indexOf('router.post("/:id/reject"'));

for (const [name, source] of [
  ["webhook", webhookSource],
  ["GET /", listSource],
  ["PATCH /:id/review", reviewSource],
  ["POST /:id/approve", approveSource],
  ["POST /:id/reject", rejectSource],
]) {
  assert.ok(source.length > 0, `${name} handler not found in sheet-import.ts`);
}

// ── 1. status is the only "current state" signal ─────────────────────────────
// approvedAt/approvedBy must survive the webhook's edit-reset (they now mean
// "last approved at/by", read by /approve to detect an out-of-band edit to
// the linked operation) - only rejectedAt/rejectedBy get nulled.
assert.ok(
  /set:\s*\{\s*\.\.\.values,\s*status:\s*"pending",\s*rejectedAt:\s*null,\s*rejectedBy:\s*null,/.test(webhookSource),
  "the webhook's edit-reset must clear status/rejectedAt/rejectedBy only",
);
assert.ok(
  !/approvedAt:\s*null/.test(webhookSource),
  "the webhook must not null approvedAt - /approve needs the previous approval time to detect an out-of-band operation edit",
);
assert.ok(
  !/approvedBy:\s*null/.test(webhookSource),
  "the webhook must not null approvedBy alongside approvedAt",
);

// Every guard that used to branch on approvedAt/rejectedAt being null must
// now branch on status - that null-check is exactly what silently broke
// once approvedAt stopped being cleared on edit.
assert.ok(
  /if \(status === "all"\) return true;\s*return r\.status === status;/.test(listSource),
  "GET / must filter on the status column, not approvedAt/rejectedAt nullness",
);
assert.ok(
  !/r\.approvedAt/.test(listSource) && !/r\.rejectedAt/.test(listSource),
  "GET / must not read approvedAt/rejectedAt at all now that status is the source of truth",
);
assert.ok(
  /if \(importRow\.status !== "pending"\)/.test(reviewSource),
  "PATCH /:id/review's already-reviewed guard must check status, not approvedAt/rejectedAt",
);
assert.ok(
  /if \(importRow\.status !== "pending"\)/.test(approveSource),
  "POST /:id/approve's already-reviewed guard must check status, not approvedAt/rejectedAt",
);
assert.ok(
  /if \(importRow\.status !== "pending"\)/.test(rejectSource),
  "POST /:id/reject's already-reviewed guard must check status, not approvedAt/rejectedAt",
);

// ── 2. customer: match before create ─────────────────────────────────────────
assert.ok(
  /previouslyMatchedCustomerId = importRow\.matchedCustomerId/.test(approveSource),
  "approve must capture the row's already-linked customer before deciding whether to match or create one",
);
assert.ok(
  /lower\(trim\(\$\{customersTable\.email\}\)\) = lower\(trim\(\$\{fields\.customerEmail\}\)\)/.test(approveSource),
  "approve must look up an existing customer by email before creating a new one",
);
assert.ok(
  /lower\(trim\(\$\{customersTable\.phone\}\)\) = lower\(trim\(\$\{fields\.customerPhone\}\)\)/.test(approveSource),
  "approve must look up an existing customer by phone when email did not match",
);
{
  const emailAt = approveSource.indexOf("customersTable.email");
  const phoneAt = approveSource.indexOf("customersTable.phone");
  const insertAt = approveSource.indexOf(".insert(customersTable)");
  assert.ok(emailAt >= 0 && phoneAt >= 0 && insertAt >= 0, "customer match/create block not found");
  assert.ok(
    emailAt < insertAt && phoneAt < insertAt,
    "both the email and phone lookups must run before the customer insert, not after",
  );
}
assert.ok(
  /if \(!customerId && fields\.customerName\)/.test(approveSource),
  "a customer must only be created when no existing customer (linked or matched) was found",
);

// ── 3. cutover: reservation owns re-approval idempotency ────────────────────
assert.ok(
  /from\(reservationsTable\)\s*\.where\(eq\(reservationsTable\.sourceSheetImportId, importRow\.id\)\)/.test(approveSource),
  "approve must find the existing logical reservation by sourceSheetImportId before deciding insert vs. update",
);
assert.ok(
  /existingReservation\?\.tourOperationId\s*\?\? importRow\.matchedOperationId/.test(approveSource),
  "an idempotent reservation's explicit operation link must take precedence over the legacy matchedOperationId",
);
assert.ok(
  /if \(existingReservation\)\s*\{\s*\[reservation\]\s*=\s*await tx\s*\.update\(reservationsTable\)/.test(approveSource),
  "re-approval must update the existing reservation rather than inserting a duplicate",
);
assert.ok(
  /\.update\(bookingPartiesTable\)/.test(approveSource) && /\.insert\(bookingPartiesTable\)/.test(approveSource),
  "booking_parties must be updated in place with an insert fallback for first approval",
);
assert.ok(
  !/operationReservationDetailsTable/.test(approveSource),
  "the Phase 1B.1 path must not write the legacy operation_reservation_details table",
);

// ── 4. operation index is relaxed; reservation index owns uniqueness ────────
assert.ok(
  /sheetImportIdx: index\("operations_source_sheet_import_idx"\)\.on\(table\.sourceSheetImportId\)/.test(SCHEMA_SOURCE),
  "operations.ts must retain operations_source_sheet_import_idx as a plain provenance index",
);
assert.ok(
  /CREATE UNIQUE INDEX IF NOT EXISTS operations_source_sheet_import_idx/.test(MIGRATION_SOURCE),
  "migration 0018 must create operations_source_sheet_import_idx",
);
assert.ok(
  /ON operations \(source_sheet_import_id\)/.test(MIGRATION_SOURCE),
  "the migration's index must be on source_sheet_import_id, unqualified (no partial WHERE) - multiple NULLs are not duplicates in Postgres",
);
assert.ok(
  !/WHERE/i.test(MIGRATION_SOURCE.slice(MIGRATION_SOURCE.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS"))),
  "the sheet-import unique index must not be partial - every source, including sourceSheetImportId IS NULL rows, relies on NULL != NULL here",
);

// ── 5. frontend: the review list keys off status, not approvedAt/rejectedAt ──
assert.ok(
  /row\.status === 'approved' &&/.test(REVIEW_PAGE_SOURCE) && /row\.status === 'rejected' &&/.test(REVIEW_PAGE_SOURCE),
  "sheet-import-review.tsx's action column must branch on row.status",
);
assert.ok(
  !/\{row\.approvedAt &&/.test(REVIEW_PAGE_SOURCE) && !/\{row\.rejectedAt &&/.test(REVIEW_PAGE_SOURCE) && !/\{!row\.approvedAt && !row\.rejectedAt/.test(REVIEW_PAGE_SOURCE),
  "sheet-import-review.tsx must not branch the action column on approvedAt/rejectedAt presence - a re-pending row now keeps a non-null approvedAt",
);
assert.ok(
  /row\.status === 'pending' &&/.test(REVIEW_PAGE_SOURCE),
  "the Onayla/Reddet buttons must reappear for a row that is status 'pending' again, even if it carries a stale approvedAt",
);

console.log("sheet-import hardening focused tests: passed");
