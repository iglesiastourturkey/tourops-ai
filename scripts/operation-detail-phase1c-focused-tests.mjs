import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Load the real pure-logic module directly (Node 22's built-in TS type ───
// stripping erases the plain type annotations in operation-detail-model.ts;
// no bundler/tsx involved) so these assertions exercise the actual PAX/guest
// composition logic, not a hand-copied mirror of it.
const modelUrl = new URL(
  "../artifacts/api-server/src/lib/operation-detail-model.ts",
  import.meta.url,
);
const { partyPax, composeReservations } = await import(modelUrl.href);

const readSource = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/lib/operation-detail-read.ts", import.meta.url)),
  "utf8",
);
// Phase 3H.2 split the operation detail workspace into a dispatcher plus a
// shared-sections module and two domain-specific components. These assertions
// are about the workspace as a whole, so read the parts together.
const workspaceSource = [
  "../artifacts/tourops-ai/src/components/OperationDomainWorkspace.tsx",
  "../artifacts/tourops-ai/src/components/operation-detail/operation-shared-sections.tsx",
  "../artifacts/tourops-ai/src/components/operation-detail/CruiseOperationDetail.tsx",
  "../artifacts/tourops-ai/src/components/operation-detail/SejourOperationDetail.tsx",
].map(rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")).join("\n");
const operationsRoute = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/routes/operations.ts", import.meta.url)),
  "utf8",
);
const fieldRoute = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/routes/field.ts", import.meta.url)),
  "utf8",
);
const guideRoute = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/routes/guide.ts", import.meta.url)),
  "utf8",
);
const sheetImportRoute = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/routes/sheet-import.ts", import.meta.url)),
  "utf8",
);
const reservationsRoute = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/routes/reservations.ts", import.meta.url)),
  "utf8",
);
const historicalPromote = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/historical-migration-promote.ts", import.meta.url)),
  "utf8",
);

// ─── PAX semantics: totalPax = adultCount + childCount, never guest count ───

assert.equal(partyPax({ adultCount: 3, childCount: 1 }), 4, "PAX must sum adults + children");
assert.equal(partyPax({ adultCount: null, childCount: 1 }), null, "missing adult count must not default to 0");
assert.equal(partyPax({ adultCount: 2, childCount: null }), null, "missing child count must not default to 0");
assert.equal(partyPax(null), null, "a missing BookingParty must not fabricate a PAX number");

// ─── Guest Model Rule: fewer named guests than PAX is valid, never fabricated ───

{
  const rows = [{
    reservation: { id: 1 },
    bookingParty: { id: 10, reservationId: 1, adultCount: 3, childCount: 1 },
  }];
  const guests = [{ bookingPartyId: 10, id: 100, name: "Richard" }, { bookingPartyId: 10, id: 101, name: "Lyne" }];
  const { reservations, summary } = composeReservations(rows, guests);
  assert.equal(reservations[0].bookingParty.totalPax, 4, "PAX must be adultCount+childCount, not guest count");
  assert.equal(reservations[0].bookingParty.guests.length, 2, "only the real, on-file guest rows may appear");
  assert.equal(summary.totalPax, 4, "operation-level PAX must not be reduced by an incomplete guest manifest");
}

{
  // A BookingParty with zero on-file guests must remain fully valid.
  const rows = [{ reservation: { id: 1 }, bookingParty: { id: 10, reservationId: 1, adultCount: 2, childCount: 0 } }];
  const { reservations } = composeReservations(rows, []);
  assert.deepEqual(reservations[0].bookingParty.guests, [], "zero named guests must not be an error or a fabricated array");
  assert.equal(reservations[0].bookingParty.totalPax, 2, "PAX stands on adult/child counts alone with no guests on file");
}

// ─── Multiple independently-sourced reservations under one operation ───

{
  // Operation -> Reservation A (2 adults) + Reservation B (3 adults + 1 child) = 6 PAX, two distinct reservations.
  const rows = [
    { reservation: { id: 1, leadGuestName: "A" }, bookingParty: { id: 10, reservationId: 1, adultCount: 2, childCount: 0 } },
    { reservation: { id: 2, leadGuestName: "B" }, bookingParty: { id: 11, reservationId: 2, adultCount: 3, childCount: 1 } },
  ];
  const { reservations, summary } = composeReservations(rows, []);
  assert.equal(reservations.length, 2, "two independently-sourced reservations must remain two separate records");
  assert.equal(summary.reservationCount, 2);
  assert.equal(summary.totalPax, 6, "operation total PAX must sum every reservation's BookingParty PAX");
  assert.notEqual(reservations[0].leadGuestName, reservations[1].leadGuestName, "reservations must not be merged into one traveler");
}

// ─── Nullable / partial data must be represented explicitly, never invented ───

{
  const rows = [
    { reservation: { id: 1 }, bookingParty: { id: 10, reservationId: 1, adultCount: 2, childCount: 0 } },
    { reservation: { id: 2 }, bookingParty: { id: 11, reservationId: 2, adultCount: null, childCount: null } },
  ];
  const { reservations, summary } = composeReservations(rows, []);
  assert.equal(reservations[1].bookingParty.totalPax, null, "an incomplete BookingParty must surface as unknown, not zero");
  assert.equal(summary.incompleteReservationCount, 1);
  assert.equal(summary.totalPax, null, "operation total PAX must not silently under-count when any reservation is incomplete");
}

{
  // A Reservation without a BookingParty row at all (defensive: schema expects 1:1, data may lag) must not throw.
  const rows = [{ reservation: { id: 1 }, bookingParty: null }];
  const { reservations } = composeReservations(rows, []);
  assert.equal(reservations[0].bookingParty, null, "a missing BookingParty must be represented as null, not fabricated");
}

// ─── Read route: batched queries, no N+1 per reservation ───

assert.ok(
  /await db\.select\(\{[\s\S]*?\}\)\.from\(reservationsTable\)/.test(readSource),
  "reservations must be fetched with a single batched query, not per-reservation",
);
assert.ok(
  /inArray\(guestsTable\.bookingPartyId, partyIds\)/.test(readSource),
  "guests must be fetched with one batched inArray query across all booking parties, not one query per party",
);
assert.equal(
  (readSource.match(/\.from\(reservationsTable\)/g) ?? []).length,
  1,
  "operation-detail-read must issue exactly one query against reservationsTable",
);

// ─── Legacy compatibility: read-only, only when no Reservation hierarchy exists ───

assert.ok(
  /rows\.length === 0[\s\S]{0,80}operationReservationDetailsTable/.test(readSource),
  "the legacy operation_reservation_details fallback must be read only for operations with zero reservations",
);
assert.ok(
  /legacy: legacy \? \{ \.\.\.legacy, readOnly: true/.test(readSource),
  "legacy data must be tagged read-only in the response so the UI cannot treat it as a live domain record",
);
assert.ok(
  !/\.insert\(operationReservationDetailsTable\)/.test(readSource)
    && !/\.update\(operationReservationDetailsTable\)/.test(readSource)
    && !/\.delete\(operationReservationDetailsTable\)/.test(readSource),
  "Phase 1C must never write to, backfill, or delete operation_reservation_details",
);
assert.ok(
  !/\.insert\(guestsTable\)/.test(readSource) && !/\.insert\(bookingPartiesTable\)/.test(readSource) && !/\.insert\(reservationsTable\)/.test(readSource),
  "operation-detail-read is a pure read model and must never write to the reservation domain either",
);

// ─── Operation status and Reservation status stay independent ───

assert.ok(
  !/operation\.status\s*=/.test(readSource) && !/reservation\.status\s*=\s*operation/.test(readSource),
  "no code path may derive operation status from reservation status or vice versa",
);
assert.ok(
  /Operasyon:\s*\{OPERATION_STATUS_LABELS\[(op|operation)\.status\]/.test(workspaceSource)
    && /Rezervasyon:\s*\{reservationStatuses\[r\.status\]/.test(workspaceSource),
  "the UI must render operation status and each reservation's status from independent labels/values",
);

// ─── Nullable customer / booking reference must be handled, not required ───

assert.ok(
  /\.leftJoin\(customersTable, eq\(reservationsTable\.customerId, customersTable\.id\)\)/.test(readSource),
  "reservation customer must be a left join so a reservation without a linked customer still loads",
);
assert.ok(
  /r\.customer\?\.name/.test(workspaceSource) && /r\.sourceBookingReference/.test(workspaceSource),
  "the UI must read customer/bookingReference defensively (nullable) rather than assume they are present",
);
assert.ok(/missing = 'Belirtilmemiş'/.test(workspaceSource), "missing fields must render an explicit placeholder, never an invented default");

// ─── RBAC stays server-enforced on all three surfaces ───

assert.ok(
  /router\.get\("\/:id\/detail", requirePermission\("operations", "view"\), operationDetailRead\)/.test(operationsRoute),
  "desktop operations surface must enforce the existing operations:view permission server-side",
);
assert.ok(
  /router\.get\("\/operations\/:id\/detail", requirePermission\("field_operations", "view"\), operationDetailRead\)/.test(fieldRoute),
  "field surface must enforce the existing field_operations:view permission server-side",
);
assert.ok(
  /router\.get\("\/my-operations\/:id\/detail", requirePermission\("guide_workspace", "view"\), operationDetailRead\)/.test(guideRoute),
  "guide surface must enforce the existing guide_workspace:view permission server-side",
);
assert.ok(
  /role === "guide" && operation\.assignedGuideUserId !== getAuth\(req\)\.userId/.test(readSource),
  "a guide must only be able to open the detail of an operation assigned to them",
);

// ─── Blast radius: no other write path was touched or made aware of this read model ───

for (const [name, source] of [["sheet-import.ts", sheetImportRoute], ["reservations.ts", reservationsRoute], ["historical-migration-promote.ts", historicalPromote]]) {
  assert.ok(
    !source.includes("operation-detail-read") && !source.includes("operation-detail-model") && !source.includes("operationDetailRead"),
    `${name} must remain unaware of the new Operation Detail read model`,
  );
}

console.log("operation detail Phase 1C focused tests: passed");
