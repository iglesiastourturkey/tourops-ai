import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Focused tests for the Phase 1A additive domain foundation:
// lib/db/src/schema/reservations.ts (reservations / booking_parties /
// guests) and lib/db/migrations/0022_reservation_domain_phase1a.sql.
//
// Same shape as the other suites here: the schema/migration files are
// TypeScript/SQL, not directly importable by a plain `node script.mjs`
// without a compiler, so these are source-regex/structural assertions
// against the real files rather than a live DB round-trip — same approach
// already used by reservation-validation-focused-tests.mjs and
// historical-migration-promotion-focused-tests.mjs for TS modules that
// pull in express/pg. Nothing here talks to a database.
//
// Phase 1A is purely additive and has zero writers: these tests exist to
// prove the new tables are structurally correct and that nothing existing
// was touched, not to exercise application behavior (there is none yet).

const SCHEMA_SOURCE = readFileSync(
  new URL("../lib/db/src/schema/reservations.ts", import.meta.url),
  "utf8",
);
const SCHEMA_INDEX_SOURCE = readFileSync(
  new URL("../lib/db/src/schema/index.ts", import.meta.url),
  "utf8",
);
const MIGRATION_SOURCE = readFileSync(
  new URL("../lib/db/migrations/0022_reservation_domain_phase1a.sql", import.meta.url),
  "utf8",
);
const LEGACY_DETAILS_SOURCE = readFileSync(
  new URL("../lib/db/src/schema/operation_reservation_details.ts", import.meta.url),
  "utf8",
);
const OPERATIONS_SCHEMA_SOURCE = readFileSync(
  new URL("../lib/db/src/schema/operations.ts", import.meta.url),
  "utf8",
);
const SHEET_IMPORT_ROUTE_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/sheet-import.ts", import.meta.url),
  "utf8",
);
const HISTORICAL_PROMOTE_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/historical-migration-promote.ts", import.meta.url),
  "utf8",
);
const RESERVATIONS_ROUTE_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/reservations.ts", import.meta.url),
  "utf8",
);

// ── 1-3: schema exports the three new tables ────────────────────────────

assert.ok(
  /export const reservationsTable = pgTable\("reservations"/.test(SCHEMA_SOURCE),
  "schema must export reservationsTable backed by a \"reservations\" table",
);
assert.ok(
  /export const bookingPartiesTable = pgTable\("booking_parties"/.test(SCHEMA_SOURCE),
  "schema must export bookingPartiesTable backed by a \"booking_parties\" table",
);
assert.ok(
  /export const guestsTable = pgTable\("guests"/.test(SCHEMA_SOURCE),
  "schema must export guestsTable backed by a \"guests\" table",
);
assert.ok(
  /export \* from "\.\/reservations";/.test(SCHEMA_INDEX_SOURCE),
  "schema/index.ts must re-export the new reservations module",
);

// ── 4: reservations has FK to operations ────────────────────────────────

assert.ok(
  /tourOperationId: integer\("tour_operation_id"\)\s*\.notNull\(\)\s*\.references\(\(\) => operationsTable\.id/.test(SCHEMA_SOURCE),
  "reservations.tourOperationId must be a NOT NULL FK to operationsTable.id",
);
assert.ok(
  /CREATE TABLE IF NOT EXISTS reservations[\s\S]*?REFERENCES operations\(id\) ON DELETE CASCADE/.test(MIGRATION_SOURCE),
  "migration must declare reservations.tour_operation_id as a FK to operations with ON DELETE CASCADE",
);

// ── 5: booking_parties.reservationId is 1:1 / unique ────────────────────

assert.ok(
  /reservationId: integer\("reservation_id"\)\s*\.notNull\(\)\s*\.unique\(\)\s*\.references\(\(\) => reservationsTable\.id/.test(SCHEMA_SOURCE),
  "booking_parties.reservationId must be NOT NULL, UNIQUE, and reference reservationsTable.id (strict 1:1)",
);
assert.ok(
  /reservation_id INTEGER NOT NULL UNIQUE\s*\n\s*REFERENCES reservations\(id\)/.test(MIGRATION_SOURCE),
  "migration must declare booking_parties.reservation_id as NOT NULL UNIQUE REFERENCES reservations(id)",
);

// ── 6: guests is 0..many under booking_parties (FK present, NOT unique) ─

const guestsBlockMatch = SCHEMA_SOURCE.match(/export const guestsTable = pgTable\("guests", \{([\s\S]*?)\}, \(table\)/);
assert.ok(guestsBlockMatch, "guestsTable definition block not found");
const guestsColumnsSource = guestsBlockMatch[1];
assert.ok(
  /bookingPartyId: integer\("booking_party_id"\)\s*\.notNull\(\)\s*\.references\(\(\) => bookingPartiesTable\.id/.test(guestsColumnsSource),
  "guests.bookingPartyId must be a NOT NULL FK to bookingPartiesTable.id",
);
assert.ok(
  !/bookingPartyId[\s\S]{0,80}\.unique\(\)/.test(guestsColumnsSource),
  "guests.bookingPartyId must NOT be unique — a booking party may have zero, one, or many guest rows",
);

// ── 7-9: non-negative CHECK constraints on counts/age when present ──────

for (const [label, field, checkName] of [
  ["adult count", "adultCount", "booking_parties_adult_count_check"],
  ["child count", "childCount", "booking_parties_child_count_check"],
]) {
  const pattern = new RegExp(
    `check\\("${checkName}", sql\`\\$\\{table\\.${field}\\} IS NULL OR \\$\\{table\\.${field}\\} >= 0\``,
  );
  assert.ok(pattern.test(SCHEMA_SOURCE), `booking_parties must CHECK that ${label} is NULL or >= 0 in the Drizzle schema`);
  assert.ok(
    MIGRATION_SOURCE.includes(`CONSTRAINT ${checkName} CHECK (`),
    `migration must declare ${checkName}`,
  );
}
assert.ok(
  /ageCheck: check\("guests_age_check", sql`\$\{table\.age\} IS NULL OR \$\{table\.age\} >= 0`\)/.test(SCHEMA_SOURCE),
  "guests must CHECK that age is NULL or >= 0 in the Drizzle schema",
);
assert.ok(
  MIGRATION_SOURCE.includes("CONSTRAINT guests_age_check CHECK (age IS NULL OR age >= 0)"),
  "migration must declare guests_age_check",
);

// ── 10: guest count is NOT constrained to adultCount + childCount ───────
//
// There is no single-table CHECK that could express a cross-table
// (guests vs. booking_parties) constraint in Postgres, and no trigger is
// introduced either — the absence of a trigger is itself part of the
// guarantee, since a trigger would be the only other mechanism capable of
// enforcing this. Guarding against the specific trigger keywords Postgres
// uses to attach that mechanism is a reasonable proxy for "no such
// enforcement exists."
assert.ok(
  !/CREATE TRIGGER/i.test(MIGRATION_SOURCE),
  "migration must not introduce any trigger — guest-count-to-pax-count equality is never enforced",
);
assert.ok(
  !/CREATE (OR REPLACE )?FUNCTION/i.test(MIGRATION_SOURCE),
  "migration must not introduce any function/trigger-backing logic",
);
// The documented rule itself must be present so the intent is traceable,
// not just structurally absent by omission.
assert.ok(
  /COUNT\(guests\) to equal/i.test(SCHEMA_SOURCE) || /COUNT\(guests\)\s+to\s+equal/i.test(MIGRATION_SOURCE),
  "the Guest Model Rule (no guest-count-equals-pax-count constraint) must be documented at the point it could otherwise be added",
);

// ── 11: source booking reference is NOT a hard global unique key ────────

assert.ok(
  !/sourceBookingReference[\s\S]{0,120}uniqueIndex/.test(SCHEMA_SOURCE),
  "reservations.sourceBookingReference must never be backed by a uniqueIndex",
);
assert.ok(
  /bookingReferenceIdx: index\("reservations_source_booking_reference_idx"\)/.test(SCHEMA_SOURCE),
  "reservations.sourceBookingReference must be backed by a plain (non-unique) advisory index",
);
assert.ok(
  !/CREATE UNIQUE INDEX[\s\S]{0,40}reservations_source_booking_reference_idx/.test(MIGRATION_SOURCE),
  "migration must not create a unique index on reservations.source_booking_reference",
);

// ── 12: reservation status does not trigger/imply operation status ──────
//
// No code path exists yet that could even attempt this — operations.ts is
// not modified by Phase 1A and reservations.ts (schema) never imports or
// references operationsTable's status column.
assert.ok(
  !SCHEMA_SOURCE.includes("operationsTable.status"),
  "reservations schema must never read or reference operations.status — the two status models stay independent",
);
assert.ok(
  !OPERATIONS_SCHEMA_SOURCE.includes("reservationsTable"),
  "operations.ts must not be modified to reference the new reservations table in Phase 1A",
);

// ── 13: no existing operation_reservation_details schema changed ────────
//
// Lightweight sanity check (not a full diff) that the table's defining
// characteristics survive untouched: still a strict 1:1 with operations,
// still cascade-deletes, still has its full original column set.
assert.ok(
  /operationId: integer\("operation_id"\)\.notNull\(\)\.unique\(\)/.test(LEGACY_DETAILS_SOURCE),
  "operation_reservation_details.operationId must remain untouched: NOT NULL, unique, 1:1 with operations",
);
assert.ok(
  LEGACY_DETAILS_SOURCE.includes('.references(() => operationsTable.id, { onDelete: "cascade" })'),
  "operation_reservation_details must still cascade-delete with operations, unchanged",
);
for (const originalField of ["adultCount", "childCount", "netAmount", "advanceAmount", "externalSource", "externalOperator"]) {
  assert.ok(
    LEGACY_DETAILS_SOURCE.includes(originalField),
    `operation_reservation_details must still define ${originalField} — Phase 1A does not remove legacy fields`,
  );
}

// ── 14: no existing write route changed ──────────────────────────────────

assert.ok(
  SHEET_IMPORT_ROUTE_SOURCE.includes("updatedDetailsRows"),
  "sheet-import.ts's existing update-in-place approval logic must be unchanged in Phase 1A",
);
assert.ok(
  !SHEET_IMPORT_ROUTE_SOURCE.includes("reservationsTable"),
  "sheet-import.ts must not import or reference the new reservationsTable in Phase 1A — wiring is a Phase 1B concern",
);
assert.ok(
  HISTORICAL_PROMOTE_SOURCE.includes("Create the 1:1 reservation-details row"),
  "historical-migration-promote.ts's existing 1:1 promotion logic must be unchanged in Phase 1A",
);
assert.ok(
  !HISTORICAL_PROMOTE_SOURCE.includes("reservationsTable"),
  "historical-migration-promote.ts must not import or reference the new reservationsTable in Phase 1A",
);
assert.ok(
  !RESERVATIONS_ROUTE_SOURCE.includes("reservationsTable"),
  "routes/reservations.ts (the create-draft handler) must not import or reference the new reservationsTable in Phase 1A",
);

// ── 15: migration contains no destructive SQL ────────────────────────────
//
// Checked against the migration with SQL comments stripped: the header
// deliberately *names* DROP/DELETE/TRUNCATE/ALTER in prose to explain what
// this migration does NOT do, so a raw substring/regex check against the
// full file (comments included) would false-positive on its own safety
// documentation.
const MIGRATION_SOURCE_NO_COMMENTS = MIGRATION_SOURCE.replace(/--.*$/gm, "");

for (const destructive of [/\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bALTER\s+TABLE\b/i]) {
  assert.ok(!destructive.test(MIGRATION_SOURCE_NO_COMMENTS), `migration must not contain ${destructive} — Phase 1A is CREATE-only`);
}
// Every statement should be a CREATE (TABLE or INDEX); a crude but useful
// cross-check that nothing else crept in. Comments are stripped from the
// WHOLE file first, then split into statements — stripping per-chunk
// (after an initial split) breaks on a semicolon that falls inside a prose
// comment sentence (e.g. "...first; there is nothing..."), which would
// otherwise leave a comment fragment looking like a bogus leading keyword.
const statementKeywords = MIGRATION_SOURCE_NO_COMMENTS
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.split(/\s+/)[0]?.toUpperCase());
for (const keyword of statementKeywords) {
  if (!keyword) continue;
  assert.ok(keyword === "CREATE", `unexpected non-CREATE leading statement keyword found: ${keyword}`);
}

// ── 16: migration does not modify existing operations provenance indexes ─
//
// Checked with comments stripped: this migration's own prose legitimately
// *names* operations_source_sheet_import_idx to explain why it is left
// alone (mirroring how migrations 0018/0021 reference each other in
// comments) — the invariant under test is that no actual SQL statement
// touches it, not that the name never appears in an explanation.
for (const untouchedIndex of [
  "operations_source_email_import_idx",
  "operations_source_sheet_import_idx",
  "operations_source_historical_key_idx",
  "operations_source_booking_reference_idx",
]) {
  assert.ok(
    !MIGRATION_SOURCE_NO_COMMENTS.includes(untouchedIndex),
    `migration must not contain a live SQL statement referencing the existing ${untouchedIndex}`,
  );
}
assert.ok(
  !/\bON\s+operations\b/i.test(MIGRATION_SOURCE_NO_COMMENTS),
  "migration must not create or alter any index on the operations table itself",
);

// ── Guest Model Rule proof: adultCount/childCount can exceed named-guest
//    rows without violating anything (documented behavior, exercised here
//    as a pure-function mirror of the intended display semantics) ───────

function paxSummary(bookingParty, guestCount) {
  const adults = bookingParty.adultCount ?? 0;
  const children = bookingParty.childCount ?? 0;
  const totalPax = adults + children;
  return { totalPax, namedGuests: guestCount, label: `${totalPax} PAX · ${guestCount} named` };
}

const richardAndLyneCase = paxSummary({ adultCount: 3, childCount: 1 }, 2);
assert.equal(richardAndLyneCase.totalPax, 4, "authoritative pax must come from adultCount + childCount, not guest rows");
assert.equal(richardAndLyneCase.namedGuests, 2, "partial named-guest enrichment must be representable without error");
assert.equal(richardAndLyneCase.label, "4 PAX · 2 named");

const zeroGuestsCase = paxSummary({ adultCount: 2, childCount: 0 }, 0);
assert.equal(zeroGuestsCase.totalPax, 2, "zero named guests must not affect the authoritative pax total");

console.log("reservation domain Phase 1A focused tests: passed");
