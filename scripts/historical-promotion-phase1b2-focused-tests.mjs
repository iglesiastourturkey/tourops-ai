import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Structural coverage for the Phase 1B.2 writer. The real promotion command
// is intentionally transaction/DB backed, so this pins its actual source
// path without connecting to a staging database.
const promotion = readFileSync(
  new URL("../artifacts/api-server/src/historical-migration-promote.ts", import.meta.url),
  "utf8",
);
const validation = readFileSync(
  new URL("../artifacts/api-server/src/lib/historical-migration-promote-validation.ts", import.meta.url),
  "utf8",
);
const customerLink = readFileSync(
  new URL("../artifacts/api-server/src/lib/historical-customer-link.ts", import.meta.url),
  "utf8",
);

const promoteOne = promotion.slice(
  promotion.indexOf("async function promoteOne"),
  promotion.indexOf("async function applyPromotion"),
);
assert.ok(promoteOne.includes("db.transaction(async (tx) =>"), "each promotion must remain atomic");
assert.ok(/\.for\("update"\)/.test(promoteOne), "staging and replay records must stay locked");
assert.ok(/pg_advisory_xact_lock\(2026, 4\)/.test(promoteOne), "historical promotion must retain its advisory lock");
for (const table of ["operationsTable", "reservationsTable", "bookingPartiesTable"]) {
  assert.ok(promoteOne.includes(table), `promotion must write ${table}`);
}
assert.ok(
  /tx\.insert\(reservationsTable\)[\s\S]*?sourceHistoricalKey: target\.reservation\.sourceHistoricalKey/.test(promoteOne),
  "reservation must own historical source provenance",
);
assert.ok(
  /tx\.insert\(bookingPartiesTable\)[\s\S]*?adultCount: target\.bookingParty\.adultCount,[\s\S]*?childCount: target\.bookingParty\.childCount/.test(promoteOne),
  "booking party must preserve Adult/CHD counts",
);
assert.ok(
  !/insert\(operationReservationDetailsTable\)|update\(operationReservationDetailsTable\)/.test(promoteOne),
  "the cutover path must not write legacy operation_reservation_details",
);
assert.ok(!/insert\(guestsTable\)/.test(promoteOne), "promotion must not fabricate Guest rows");
assert.ok(
  /buildPromotionProjectionFromExisting/.test(promoteOne)
    && /sourceHistoricalKey, sourceKey/.test(promoteOne)
    && /onConflictDoNothing\(\{ target: operationsTable\.sourceHistoricalKey \}\)/.test(promoteOne),
  "existing historical-key idempotency must remain the operation-level guard",
);
assert.ok(
  /reservationId,[\s\S]*?bookingPartyId,[\s\S]*?outcome/.test(promoteOne),
  "atomic audit metadata must include reservation and booking-party IDs",
);
assert.ok(
  /leadGuestName: payload\.customer\.fullName/.test(validation)
    && /sourceHistoricalKey: sourceKey/.test(validation),
  "the staged customer name and authoritative source key must map to Reservation identity",
);
assert.ok(
  /sourceFileId|worksheetName/.test(validation) === false,
  "promotion projection must not substitute workbook display provenance for the authoritative source key",
);
assert.ok(
  !/customersTable/.test(promotion)
    && /\.set\(\{ customerId: params\.customerId \}\)/.test(customerLink),
  "promotion keeps customer linking unchanged and the existing Phase 3D-B service remains the only linker",
);
assert.ok(
  !/similarity|levenshtein|fuzzy|dedup/i.test(promoteOne),
  "distinct historical records must not gain automatic duplicate matching",
);
assert.ok(
  /status: "draft"/.test(promoteOne) && /status: "new"/.test(validation),
  "existing historical status/cancellation treatment remains traceable and unchanged",
);

console.log("historical promotion Phase 1B.2 focused tests: passed");
