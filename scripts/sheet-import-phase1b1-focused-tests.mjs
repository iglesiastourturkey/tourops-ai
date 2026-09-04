import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-level checks for the Phase 1B.1 approval cutover. The live route is
// intentionally database-backed; these checks pin its transaction shape and
// migration safety without opening a database connection.
const route = readFileSync(
  new URL("../artifacts/api-server/src/routes/sheet-import.ts", import.meta.url),
  "utf8",
);
const operationsSchema = readFileSync(
  new URL("../lib/db/src/schema/operations.ts", import.meta.url),
  "utf8",
);
const reservationsSchema = readFileSync(
  new URL("../lib/db/src/schema/reservations.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../lib/db/migrations/0023_sheet_import_idempotency_cutover.sql", import.meta.url),
  "utf8",
);

const approve = route.slice(
  route.indexOf('router.post("/:id/approve"'),
  route.indexOf('router.post("/:id/reject"'),
);
assert.ok(approve.includes("db.transaction(async (tx) =>"), "approval must remain transactional");
for (const table of ["operationsTable", "reservationsTable", "bookingPartiesTable"]) {
  assert.ok(approve.includes(table), `approval must write ${table} inside its transaction`);
}

assert.ok(
  /\.for\("update"\)/.test(approve)
    && /reservationsTable\.sourceSheetImportId, importRow\.id/.test(approve),
  "source row lock plus reservation source ID lookup must serialize/reuse re-approvals",
);
assert.ok(
  /if \(existingReservation\)[\s\S]*?\.update\(reservationsTable\)/.test(approve)
    && /\.insert\(reservationsTable\)/.test(approve),
  "first approval inserts one reservation and re-approval updates the same one",
);
assert.ok(
  /\.update\(bookingPartiesTable\)[\s\S]*?\.insert\(bookingPartiesTable\)/.test(approve),
  "a booking party must be updated/reused rather than duplicated on re-approval",
);
assert.ok(
  /leadGuestName,[\s\S]*?status: "new",[\s\S]*?sourceSheetImportId: importRow\.id/.test(approve),
  "reservation mapping must retain lead guest, safe status, and source-row provenance",
);
assert.ok(
  /adultCount: fields\.adultCount,[\s\S]*?childCount: fields\.childCount/.test(approve),
  "PAX semantics must retain Adult/CHD source counts exactly",
);
assert.ok(
  !/\.insert\(guestsTable\)/.test(approve) && !/operationReservationDetailsTable/.test(approve),
  "the new path must fabricate neither Guest rows nor legacy detail writes",
);
assert.ok(
  /reservationId: result\.reservation\.id,[\s\S]*?bookingPartyId: result\.bookingParty\.id/.test(approve),
  "approval audit metadata must retain the operation and add reservation/booking-party IDs",
);
assert.ok(
  /sourceBookingReference: fields\.sourceBookingReference/.test(approve)
    && /sourceBookingReference.*uniqueIndex/.test(reservationsSchema) === false,
  "booking references must remain mapped but non-unique/advisory",
);

assert.ok(
  /sheetImportIdx: index\("operations_source_sheet_import_idx"\)/.test(operationsSchema),
  "operation source-row index must be plain after cutover",
);
assert.ok(
  /sheetImportUnique: uniqueIndex\("reservations_source_sheet_import_idx"\)/.test(reservationsSchema),
  "reservation source-row index must remain unique",
);
const guardAt = migration.indexOf("reservations_source_sheet_import_idx");
const dropAt = migration.indexOf("DROP INDEX IF EXISTS operations_source_sheet_import_idx");
const createAt = migration.indexOf("CREATE INDEX IF NOT EXISTS operations_source_sheet_import_idx");
assert.ok(
  guardAt >= 0 && dropAt > guardAt && createAt > dropAt,
  "cutover migration must verify reservation uniqueness before relaxing then restoring the operation index",
);
assert.ok(
  /indexdef ILIKE 'CREATE UNIQUE INDEX%'/i.test(migration),
  "migration guard must require a UNIQUE reservation-level index, not merely an index with the same name",
);

console.log("sheet-import Phase 1B.1 focused tests: passed");
