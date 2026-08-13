import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Focused tests for the M3 validation & duplicate engine:
// artifacts/api-server/src/lib/reservation-validation.ts, as wired into
// POST /api/reservations/:id/create-draft and the operations endpoints.
//
// Same shape as the other suites here: the rules are mirrored as pure functions
// rather than imported (the module is TypeScript, and the route around it pulls
// in express + a live DB). The source assertions at the bottom fail loudly if
// the real implementation drifts from this mirror — in particular if a warning
// silently becomes a block, or a block silently becomes a warning.

const VALIDATION_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/lib/reservation-validation.ts", import.meta.url),
  "utf8",
);
const ROUTE_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/reservations.ts", import.meta.url),
  "utf8",
);
const OPERATIONS_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/operations.ts", import.meta.url),
  "utf8",
);

// ── Mirrors ──────────────────────────────────────────────────────────────────

const ISO_DATE_IN_ISTANBUL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const todayInIstanbul = (now = new Date()) => ISO_DATE_IN_ISTANBUL.format(now);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function asIsoDate(value) {
  if (typeof value === "string" && ISO_DATE_RE.test(value.trim())) return value.trim();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
}

function normalizeBookingReference(raw) {
  const normalized = (raw ?? "").trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

function dateOrderBlock(startDate, endDate) {
  const start = asIsoDate(startDate);
  const end = asIsoDate(endDate);
  if (!start || !end) return null;
  return end < start ? "blocked" : null;
}

function collectDraftWarnings(data, { today, duplicates }) {
  const warnings = [];
  if (duplicates.length > 0) warnings.push({ code: "duplicate_booking_reference" });
  const tourDate = asIsoDate(data.tourDate);
  if (tourDate && tourDate < today) warnings.push({ code: "past_tour_date" });
  const hasSplit = data.adultCount !== null || data.childCount !== null;
  if (data.guestCount !== null && hasSplit) {
    const adults = data.adultCount ?? 0;
    const children = data.childCount ?? 0;
    if (adults + children !== data.guestCount) warnings.push({ code: "guest_count_mismatch" });
  }
  return warnings;
}

const DRAFT_WARNING_CODES = ["duplicate_booking_reference", "past_tour_date", "guest_count_mismatch"];
function parseAcknowledgedWarnings(body) {
  const raw = body?.acknowledgedWarnings;
  if (!Array.isArray(raw)) return [];
  return DRAFT_WARNING_CODES.filter((code) => raw.includes(code));
}

/** Mirror of the create-draft confirmation gate. */
function decideConfirmation(warnings, body) {
  const acknowledged = parseAcknowledgedWarnings(body);
  const unacknowledged = warnings.filter((warning) => !acknowledged.includes(warning.code));
  return unacknowledged.length ? { status: 409, code: "draft_confirmation_required" } : { status: 201 };
}

const codesFor = (data, context) => collectDraftWarnings(data, context).map((warning) => warning.code);
const noCounts = { guestCount: null, adultCount: null, childCount: null };
const clean = { today: "2026-08-13", duplicates: [] };

// ── 1. Booking reference normalisation ───────────────────────────────────────
// Case and stray whitespace must not hide a duplicate...
assert.equal(normalizeBookingReference("GYG-1234"), "gyg-1234");
assert.equal(normalizeBookingReference(" gyg-1234 "), "gyg-1234");
// ...but a blank reference is not an identity: without this, every
// reference-less booking would match every other one.
assert.equal(normalizeBookingReference(""), null);
assert.equal(normalizeBookingReference("   "), null);
assert.equal(normalizeBookingReference(null), null);
assert.equal(normalizeBookingReference(undefined), null);

// ── 2. Duplicate booking reference warns, never blocks ───────────────────────
const duplicates = [{ id: 12, status: "draft", startDate: "2026-09-01", sourceType: "gmail", sameSource: true }];
assert.deepEqual(
  codesFor({ tourDate: "2026-12-01", ...noCounts }, { today: "2026-08-13", duplicates }),
  ["duplicate_booking_reference"],
);
// A cancelled counterpart is exactly the case where continuing is right, so it
// is reported the same way and left to the reviewer.
assert.deepEqual(
  codesFor({ tourDate: "2026-12-01", ...noCounts }, {
    today: "2026-08-13",
    duplicates: [{ ...duplicates[0], status: "cancelled" }],
  }),
  ["duplicate_booking_reference"],
);

// ── 3. Past tour date warns ──────────────────────────────────────────────────
assert.deepEqual(codesFor({ tourDate: "2026-08-12", ...noCounts }, clean), ["past_tour_date"]);
// Today is not past — the boundary the operator hits every morning.
assert.deepEqual(codesFor({ tourDate: "2026-08-13", ...noCounts }, clean), []);
assert.deepEqual(codesFor({ tourDate: "2026-08-14", ...noCounts }, clean), []);
// No date at all is create-draft's tour_date_required block, not a warning.
assert.deepEqual(codesFor({ tourDate: null, ...noCounts }, clean), []);

// ── 4. "Today" is Istanbul's, not the server's ───────────────────────────────
// Render runs the API in UTC. Between midnight and 03:00 Istanbul time the UTC
// date is still yesterday, so a naive toISOString() would flag a tour booked
// for today as a past date.
const earlyMorningIstanbul = new Date("2026-08-14T00:30:00Z"); // 03:30 in Istanbul
assert.equal(todayInIstanbul(earlyMorningIstanbul), "2026-08-14");
const lateEveningUtc = new Date("2026-08-13T22:30:00Z"); // 01:30 on the 14th in Istanbul
assert.equal(todayInIstanbul(lateEveningUtc), "2026-08-14");
assert.notEqual(todayInIstanbul(lateEveningUtc), lateEveningUtc.toISOString().slice(0, 10));
// A tour on the Istanbul "today" must not warn even though UTC still says the 13th.
assert.deepEqual(
  codesFor({ tourDate: "2026-08-14", ...noCounts }, { today: todayInIstanbul(lateEveningUtc), duplicates: [] }),
  [],
);

// ── 5. Guest count consistency ───────────────────────────────────────────────
assert.deepEqual(codesFor({ tourDate: "2026-12-01", guestCount: 4, adultCount: 2, childCount: 1 }, clean), ["guest_count_mismatch"]);
assert.deepEqual(codesFor({ tourDate: "2026-12-01", guestCount: 3, adultCount: 2, childCount: 1 }, clean), []);
// 0 children is a real answer, not a missing one.
assert.deepEqual(codesFor({ tourDate: "2026-12-01", guestCount: 2, adultCount: 2, childCount: 0 }, clean), []);
// One side known and the total disagreeing is the case worth surfacing: 3
// adults against a total of 4 usually means the child count was dropped.
assert.deepEqual(codesFor({ tourDate: "2026-12-01", guestCount: 4, adultCount: 3, childCount: null }, clean), ["guest_count_mismatch"]);
// Nothing to compare — no noise.
assert.deepEqual(codesFor({ tourDate: "2026-12-01", guestCount: null, adultCount: 2, childCount: 1 }, clean), []);
assert.deepEqual(codesFor({ tourDate: "2026-12-01", guestCount: 4, adultCount: null, childCount: null }, clean), []);

// ── 6. Warnings accumulate; none of them is a block ──────────────────────────
assert.deepEqual(
  codesFor({ tourDate: "2026-08-01", guestCount: 4, adultCount: 1, childCount: 1 }, { today: "2026-08-13", duplicates }),
  ["duplicate_booking_reference", "past_tour_date", "guest_count_mismatch"],
);

// ── 7. Date order is the one hard block ──────────────────────────────────────
assert.equal(dateOrderBlock("2026-09-05", "2026-09-01"), "blocked");
assert.equal(dateOrderBlock("2026-09-01", "2026-09-05"), null);
// Single-day tours: create-draft writes the same date to both ends.
assert.equal(dateOrderBlock("2026-09-01", "2026-09-01"), null);
// Nothing to compare must never block — a half-filled PATCH is not an error.
assert.equal(dateOrderBlock(null, "2026-09-01"), null);
assert.equal(dateOrderBlock("2026-09-01", null), null);
assert.equal(dateOrderBlock(undefined, undefined), null);
// Unrecognised input is left to the database's own typing rather than guessed at.
assert.equal(dateOrderBlock("01/09/2026", "2026-09-01"), null);
assert.equal(dateOrderBlock(new Date("2026-09-05T00:00:00Z"), new Date("2026-09-01T00:00:00Z")), "blocked");

// ── 8. Acknowledgement covers named warnings, not "proceed regardless" ───────
const twoWarnings = [{ code: "past_tour_date" }, { code: "guest_count_mismatch" }];
// First attempt: nothing acknowledged yet.
assert.deepEqual(decideConfirmation(twoWarnings, {}), { status: 409, code: "draft_confirmation_required" });
assert.deepEqual(decideConfirmation(twoWarnings, { acknowledgedWarnings: [] }), { status: 409, code: "draft_confirmation_required" });
// Second attempt with exactly what was shown: through.
assert.deepEqual(
  decideConfirmation(twoWarnings, { acknowledgedWarnings: ["past_tour_date", "guest_count_mismatch"] }),
  { status: 201 },
);
// The case a boolean flag would have gotten wrong: a duplicate appears between
// the two requests. The reviewer never saw it, so it must block again rather
// than be recorded as acknowledged.
assert.deepEqual(
  decideConfirmation(
    [...twoWarnings, { code: "duplicate_booking_reference" }],
    { acknowledgedWarnings: ["past_tour_date", "guest_count_mismatch"] },
  ),
  { status: 409, code: "draft_confirmation_required" },
);
// Acknowledging more than is currently raised is harmless.
assert.deepEqual(
  decideConfirmation([{ code: "past_tour_date" }], { acknowledgedWarnings: DRAFT_WARNING_CODES }),
  { status: 201 },
);
// No warnings at all: the acknowledgement list is irrelevant.
assert.deepEqual(decideConfirmation([], {}), { status: 201 });
// Malformed or truthy-but-wrong bodies acknowledge nothing rather than everything.
for (const body of [{ acknowledgedWarnings: true }, { acknowledgedWarnings: "past_tour_date" }, { acknowledgedWarnings: null }, {}, null]) {
  assert.deepEqual(
    decideConfirmation([{ code: "past_tour_date" }], body),
    { status: 409, code: "draft_confirmation_required" },
    `body ${JSON.stringify(body)} must not count as an acknowledgement`,
  );
}
// Unknown codes are filtered out, so they can never acknowledge a real warning.
assert.deepEqual(parseAcknowledgedWarnings({ acknowledgedWarnings: ["made_up_code"] }), []);

// ── Source assertions: keep the mirror honest ────────────────────────────────

// The comparison operators are the whole behaviour of these rules, and the
// mirror above would keep passing if they were loosened. Pin them to the source.
assert.ok(
  /if \(end < start\)/.test(VALIDATION_SOURCE),
  "dateOrderBlock must block only when end is strictly before start — equal dates are single-day tours",
);
assert.ok(
  /tourDate < context\.today/.test(VALIDATION_SOURCE),
  "a tour on today's date must not be flagged as past",
);
assert.ok(
  /adults \+ children !== data\.guestCount/.test(VALIDATION_SOURCE),
  "the guest-count rule must compare the split against the stated total",
);
assert.ok(
  /data\.guestCount !== null && hasSplit/.test(VALIDATION_SOURCE),
  "the guest-count rule must stay silent when there is nothing to compare",
);
assert.ok(
  /const hasSplit = data\.adultCount !== null \|\| data\.childCount !== null/.test(VALIDATION_SOURCE),
  "one known side plus a disagreeing total is the case worth surfacing",
);
// The acknowledgement allowlist is what stops an unknown code from waving a
// real warning through.
assert.ok(
  /return DRAFT_WARNING_CODES\.filter\(code => raw\.includes\(code\)\)/.test(VALIDATION_SOURCE),
  "parseAcknowledgedWarnings must filter the known codes against the body, not trust the body",
);
assert.ok(
  /if \(!Array\.isArray\(raw\)\) return \[\]/.test(VALIDATION_SOURCE),
  "a non-array acknowledgement must acknowledge nothing",
);
// Every code the mirror knows about must exist in the real list, and vice versa.
const sourceCodes = (VALIDATION_SOURCE.match(/const DRAFT_WARNING_CODES[\s\S]*?\];/)?.[0] ?? "")
  .match(/"([a-z_]+)"/g)?.map((quoted) => quoted.slice(1, -1)) ?? [];
assert.deepEqual(
  [...sourceCodes].sort(),
  [...DRAFT_WARNING_CODES].sort(),
  "the warning codes in this test have drifted from reservation-validation.ts",
);

// The timezone claim above is only true if the implementation actually names it.
assert.ok(
  VALIDATION_SOURCE.includes('timeZone: "Europe/Istanbul"'),
  "todayInIstanbul must resolve the date in Europe/Istanbul, not the server's timezone",
);
assert.ok(
  VALIDATION_SOURCE.includes('new Intl.DateTimeFormat("en-CA"'),
  "the date formatter must stay en-CA — it is what yields a comparable YYYY-MM-DD",
);

const createDraftSource = ROUTE_SOURCE.slice(ROUTE_SOURCE.indexOf('router.post("/:id/create-draft"'));
assert.ok(createDraftSource.length > 0, "create-draft handler not found in the route file");

// Soft checks must answer 409 with the machine-readable code the UI keys on...
assert.ok(
  createDraftSource.includes('code: "draft_confirmation_required"'),
  "create-draft must report soft warnings as draft_confirmation_required",
);
assert.ok(
  /res\.status\(409\)\.json\(\{\s*\n?\s*error: "Taslak oluşturmadan önce/.test(createDraftSource),
  "the warning response must be a 409, not a 400 — nothing is wrong with the data itself",
);
// ...and the route must gate on the unacknowledged remainder rather than on a
// blanket "the caller said yes".
assert.ok(
  /const unacknowledged = warnings\.filter\(warning => !acknowledgedWarnings\.includes\(warning\.code\)\)/.test(createDraftSource),
  "create-draft must block on warnings the reviewer did not acknowledge by code",
);
assert.ok(
  /if \(unacknowledged\.length\)/.test(createDraftSource),
  "the confirmation gate must test the unacknowledged remainder",
);
assert.ok(
  !/acknowledgeWarnings === true/.test(createDraftSource),
  "the boolean acknowledgement was replaced by a code list — a bare true would let unseen warnings through",
);

// The whole point of the pre-flight design: nothing is written before the
// reviewer has seen the warnings.
const warningsAt = createDraftSource.indexOf("collectDraftWarnings");
const confirmationAt = createDraftSource.indexOf('code: "draft_confirmation_required"');
const firstWriteAt = createDraftSource.indexOf("db.insert(customersTable)");
assert.ok(warningsAt >= 0, "create-draft no longer collects draft warnings");
assert.ok(firstWriteAt >= 0, "the customer insert was not found — update this assertion");
assert.ok(
  warningsAt < firstWriteAt && confirmationAt < firstWriteAt,
  "warnings must be computed and answered before create-draft writes anything",
);

// The duplicate lookup must not count a half-created operation from an earlier
// interrupted attempt on this same import as a duplicate of itself.
assert.ok(
  /IS DISTINCT FROM/.test(createDraftSource),
  "the duplicate query must exclude this import's own operation with IS DISTINCT FROM",
);
// Matching has to be case/whitespace insensitive or the index and the agencies'
// formatting will disagree.
assert.ok(
  /lower\(trim\(/.test(createDraftSource),
  "booking references must be compared case- and whitespace-insensitively",
);

// The hard block stays a block, on both sides.
assert.ok(
  createDraftSource.includes('code: "invalid_date_range"'),
  "create-draft must reject an impossible date range outright",
);
const postSource = OPERATIONS_SOURCE.slice(
  OPERATIONS_SOURCE.indexOf('router.post("/", requirePermission("operations", "create")'),
);
const patchSource = OPERATIONS_SOURCE.slice(
  OPERATIONS_SOURCE.indexOf('router.patch("/:id", requirePermission("operations", "update")'),
);
for (const [name, source] of [["POST /operations", postSource], ["PATCH /operations/:id", patchSource]]) {
  assert.ok(source.length > 0, `${name} handler not found`);
  assert.ok(
    source.slice(0, source.indexOf("createAuditLog")).includes("dateOrderBlock"),
    `${name} must validate the date range before writing`,
  );
}
// A PATCH that moves only one end must be checked against the stored other end.
assert.ok(
  /"startDate" in body \? body\.startDate : before\.startDate/.test(patchSource) &&
    /"endDate" in body \? body\.endDate : before\.endDate/.test(patchSource),
  "PATCH must merge the request body with the stored dates before comparing them",
);

console.log("reservation validation & duplicate focused tests: passed");
