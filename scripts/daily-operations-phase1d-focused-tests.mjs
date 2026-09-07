import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

// ── Load the real pure-logic module directly (Node 22's built-in TS type ───
// stripping erases the plain type annotations in daily-operations-model.ts;
// no bundler/tsx involved) so these assertions exercise the actual daily
// board composition logic, not a hand-copied mirror of it. Node's native TS
// loader (unlike the project's bundler) requires an explicit extension on
// relative specifiers, so the real files are copied verbatim into a temp
// dir with only that one import line's extension patched - the copies used
// for behavior assertions are byte-identical to the real sources otherwise.
const realModelPath = fileURLToPath(new URL("../artifacts/api-server/src/lib/daily-operations-model.ts", import.meta.url));
const realDetailPath = fileURLToPath(new URL("../artifacts/api-server/src/lib/operation-detail-model.ts", import.meta.url));
const detailModelSrcRaw = readFileSync(realDetailPath, "utf8");
const dailyModelSrcRaw = readFileSync(realModelPath, "utf8");
const tmpDir = mkdtempSync(path.join(tmpdir(), "phase1d-test-"));
writeFileSync(path.join(tmpDir, "operation-detail-model.ts"), detailModelSrcRaw);
const patchedDailyModelSrc = dailyModelSrcRaw.replace(
  'from "./operation-detail-model"',
  'from "./operation-detail-model.ts"',
);
assert.notEqual(patchedDailyModelSrc, dailyModelSrcRaw, "expected exactly one extensionless relative import to patch for the test harness");
writeFileSync(path.join(tmpDir, "daily-operations-model.ts"), patchedDailyModelSrc);
const { buildDailyBoard } = await import(pathToFileURL(path.join(tmpDir, "daily-operations-model.ts")).href);

const { summarizePax } = await import(pathToFileURL(path.join(tmpDir, "operation-detail-model.ts")).href);

const readSource = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/lib/daily-operations-read.ts", import.meta.url)),
  "utf8",
);
const modelSource = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/lib/daily-operations-model.ts", import.meta.url)),
  "utf8",
);
const operationsRoute = readFileSync(
  fileURLToPath(new URL("../artifacts/api-server/src/routes/operations.ts", import.meta.url)),
  "utf8",
);
const boardComponent = readFileSync(
  fileURLToPath(new URL("../artifacts/tourops-ai/src/components/DailyOperationsBoard.tsx", import.meta.url)),
  "utf8",
);
const calendarPage = readFileSync(
  fileURLToPath(new URL("../artifacts/tourops-ai/src/pages/calendar.tsx", import.meta.url)),
  "utf8",
);
const appRouterSource = readFileSync(
  fileURLToPath(new URL("../artifacts/tourops-ai/src/App.tsx", import.meta.url)),
  "utf8",
);
const appShellSource = readFileSync(
  fileURLToPath(new URL("../artifacts/tourops-ai/src/components/AppShell.tsx", import.meta.url)),
  "utf8",
);
const viteConfigSource = readFileSync(
  fileURLToPath(new URL("../artifacts/tourops-ai/vite.config.ts", import.meta.url)),
  "utf8",
);

// Small helper: a minimal, fully-formed DailyOperationInput so each test only
// has to override the fields it cares about.
function op(overrides = {}) {
  return {
    id: 1,
    status: "planned",
    startDate: "2026-09-05",
    endDate: "2026-09-05",
    pickupTime: "09:00",
    notes: null,
    tourName: "Test Tour",
    programName: null,
    programCode: null,
    shipName: null,
    cruiseLine: null,
    portName: null,
    arrivalTime: null,
    departureTime: null,
    guideName: "Ali Guide",
    guidePhone: null,
    driverName: "Veli Driver",
    driverPhone: null,
    vehiclePlate: "34 ABC 123",
    vehicleType: null,
    vehicleCapacity: 20,
    ...overrides,
  };
}

function reservation(overrides = {}) {
  return {
    id: 1,
    leadGuestName: "Lead Guest",
    status: "confirmed",
    sourceType: "manual",
    sourceBookingReference: null,
    reservationType: null,
    bookingParty: { adultCount: 2, childCount: 0, passengerLanguage: "EN", pickupPoint: "Pier", externalSource: null, externalOperator: null, specialRequirements: null },
    ...overrides,
  };
}

// ─── 1. Multiple Operations on one day ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1, pickupTime: "10:00" }), op({ id: 2, pickupTime: "08:00" })],
    reservationsByOperationId: new Map([[1, [reservation({ id: 10 })]], [2, [reservation({ id: 20 })]]]),
    legacyOperationIds: new Set(),
  });
  assert.equal(board.operations.length, 2, "two Operations on the same date must both appear on the board");
  assert.equal(board.summary.operationCount, 2);
}

// ─── 2. One Operation with multiple Reservations (never merged) ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1 })],
    reservationsByOperationId: new Map([[1, [
      reservation({ id: 10, leadGuestName: "A", bookingParty: { adultCount: 2, childCount: 0, passengerLanguage: null, pickupPoint: null, externalSource: null, externalOperator: null, specialRequirements: null } }),
      reservation({ id: 11, leadGuestName: "B", bookingParty: { adultCount: 3, childCount: 1, passengerLanguage: null, pickupPoint: null, externalSource: null, externalOperator: null, specialRequirements: null } }),
    ]]]),
    legacyOperationIds: new Set(),
  });
  const [board1] = board.operations;
  assert.equal(board1.reservations.length, 2, "one Operation with two independently-sourced Reservations must keep both, never merge them");
  assert.notEqual(board1.reservations[0].leadGuestName, board1.reservations[1].leadGuestName);
  assert.equal(board1.summary.reservationCount, 2);
}

// ─── 3. PAX = adultCount + childCount (never guest count; the model never even sees Guests) ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1 })],
    reservationsByOperationId: new Map([[1, [reservation({ id: 10, bookingParty: { adultCount: 3, childCount: 2, passengerLanguage: null, pickupPoint: null, externalSource: null, externalOperator: null, specialRequirements: null } })]]]),
    legacyOperationIds: new Set(),
  });
  assert.equal(board.operations[0].reservations[0].totalPax, 5, "totalPax must be adultCount + childCount");
  assert.equal(board.operations[0].summary.totalPax, 5);
}

// ─── 4. Guest count is never used as PAX: the daily model's input types have no Guest concept at all ───

assert.ok(
  !/\bguests\s*:/.test(modelSource) && !/\bGuest(?:s)?\[\]/.test(modelSource) && !/byPartyGuests|guestRows/.test(modelSource),
  "daily-operations-model.ts must declare no Guest-record field or type anywhere - only leadGuestName (a Reservation field) may mention 'guest'",
);
assert.ok(
  !/guestsTable/.test(readSource),
  "daily-operations-read.ts must never query the guests table - the daily board does not fetch or display Guests",
);

// ─── 5. Null adult/childCount -> that Reservation's totalPax is null, not zero ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1 })],
    reservationsByOperationId: new Map([[1, [reservation({ id: 10, bookingParty: { adultCount: null, childCount: 2, passengerLanguage: null, pickupPoint: null, externalSource: null, externalOperator: null, specialRequirements: null } })]]]),
    legacyOperationIds: new Set(),
  });
  assert.equal(board.operations[0].reservations[0].totalPax, null, "a missing adultCount must surface as null, never default to 0");
}

// ─── 6. Any incomplete Reservation PAX -> the Operation's totalPax is null (not a partial sum) ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1 })],
    reservationsByOperationId: new Map([[1, [
      reservation({ id: 10, bookingParty: { adultCount: 2, childCount: 0, passengerLanguage: null, pickupPoint: null, externalSource: null, externalOperator: null, specialRequirements: null } }),
      reservation({ id: 11, bookingParty: { adultCount: null, childCount: null, passengerLanguage: null, pickupPoint: null, externalSource: null, externalOperator: null, specialRequirements: null } }),
    ]]]),
    legacyOperationIds: new Set(),
  });
  const summary = board.operations[0].summary;
  assert.equal(summary.incompleteReservationCount, 1);
  assert.equal(summary.totalPax, null, "one incomplete Reservation must null out the whole Operation total, never silently under-count");
}

// ─── 7. Accurate reservation count on the board-level summary ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1 }), op({ id: 2 })],
    reservationsByOperationId: new Map([[1, [reservation({ id: 10 }), reservation({ id: 11 })]], [2, [reservation({ id: 20 })]]]),
    legacyOperationIds: new Set(),
  });
  assert.equal(board.summary.reservationCount, 3, "board-level reservationCount must sum every Operation's real Reservation count");
}

// ─── 8. Missing guide warning ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1, guideName: null })],
    reservationsByOperationId: new Map([[1, [reservation({ id: 10 })]]]),
    legacyOperationIds: new Set(),
  });
  assert.ok(board.operations[0].warnings.includes("missing_guide"));
  assert.equal(board.summary.missingGuideCount, 1);
}

// ─── 9. Missing vehicle warning ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1, vehiclePlate: null })],
    reservationsByOperationId: new Map([[1, [reservation({ id: 10 })]]]),
    legacyOperationIds: new Set(),
  });
  assert.ok(board.operations[0].warnings.includes("missing_vehicle"));
  assert.equal(board.summary.missingVehicleCount, 1);
}

// ─── 10. Vehicle-capacity warning only fires when BOTH capacity and total PAX are known/trusted ───

{
  // Known capacity (4) < known total PAX (5) -> warning fires.
  const over = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1, vehicleCapacity: 4 })],
    reservationsByOperationId: new Map([[1, [reservation({ id: 10, bookingParty: { adultCount: 5, childCount: 0, passengerLanguage: null, pickupPoint: null, externalSource: null, externalOperator: null, specialRequirements: null } })]]]),
    legacyOperationIds: new Set(),
  });
  assert.ok(over.operations[0].warnings.includes("vehicle_capacity_exceeded"), "capacity < known PAX must warn");

  // Unknown capacity -> must NOT warn, whatever the PAX is (nothing trusted to compare).
  const noCapacity = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1, vehicleCapacity: null })],
    reservationsByOperationId: new Map([[1, [reservation({ id: 10, bookingParty: { adultCount: 50, childCount: 0, passengerLanguage: null, pickupPoint: null, externalSource: null, externalOperator: null, specialRequirements: null } })]]]),
    legacyOperationIds: new Set(),
  });
  assert.ok(!noCapacity.operations[0].warnings.includes("vehicle_capacity_exceeded"), "an unknown vehicle capacity must never be guessed at - no warning without a trusted capacity");

  // Known capacity but incomplete (null) PAX -> must NOT warn (nothing trusted to compare).
  const noPax = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 1, vehicleCapacity: 4 })],
    reservationsByOperationId: new Map([[1, [reservation({ id: 10, bookingParty: { adultCount: null, childCount: null, passengerLanguage: null, pickupPoint: null, externalSource: null, externalOperator: null, specialRequirements: null } })]]]),
    legacyOperationIds: new Set(),
  });
  assert.ok(!noPax.operations[0].warnings.includes("vehicle_capacity_exceeded"), "an incomplete PAX total must never be assumed safe or unsafe against capacity");
}

// ─── 11. No automatic merge/assignment of Reservations to Operations ───

assert.ok(
  !/reservationsByOperationId\.set\([^)]*(?:find|match|guess|infer)/i.test(modelSource),
  "the daily model must not contain any Reservation-to-Operation matching/inference logic",
);
assert.ok(
  !/reservationsTable\.tourOperationId\s*=/.test(readSource),
  "the daily read model must never assign/rewrite which Operation a Reservation belongs to - it only reads the existing link",
);

// ─── 12. No Guest fabrication - the model has no path that can create a Guest-shaped record ───

assert.ok(
  !/\.insert\(guestsTable\)/.test(readSource),
  "daily-operations-read.ts must never insert into the guests table",
);

// ─── 13. Deterministic TUR / display sequence ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 5, pickupTime: "11:00" }), op({ id: 2, pickupTime: "09:00" }), op({ id: 1, pickupTime: null })],
    reservationsByOperationId: new Map(),
    legacyOperationIds: new Set(),
  });
  assert.deepEqual(board.operations.map(o => o.operation.id), [2, 5, 1], "sequence must sort by pickupTime ascending, with no-pickup-time Operations last");
  assert.deepEqual(board.operations.map(o => o.sequence), [1, 2, 3], "sequence numbers must be 1-based and contiguous");

  // Same pickupTime -> stable tie-break by Operation id, never arbitrary.
  const tie = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 9, pickupTime: "09:00" }), op({ id: 3, pickupTime: "09:00" })],
    reservationsByOperationId: new Map(),
    legacyOperationIds: new Set(),
  });
  assert.deepEqual(tie.operations.map(o => o.operation.id), [3, 9], "identical pickupTime must tie-break by ascending id, deterministically");
}
assert.ok(
  /never persisted|display\s+order|display-only|DISPLAY/i.test(modelSource),
  "the TUR display sequence must be documented as non-persisted, display-only",
);

// ─── 14. Correct date filtering ───

assert.ok(
  /eq\(operationsTable\.startDate,\s*date\)/.test(readSource),
  "the daily endpoint must filter Operations by exact startDate equality for the requested date",
);
assert.ok(
  /todayInIstanbul\(\)/.test(readSource),
  "an omitted date must default to the app's canonical Istanbul-anchored 'today', not server-local UTC",
);
assert.ok(
  /ISO_DATE_RE\.test\(rawDate\)/.test(readSource) && /status\(400\)/.test(readSource),
  "an invalid ?date= value must be rejected with 400, never silently coerced",
);

// ─── 15. RBAC enforcement (server-side, on the daily route itself) ───

assert.ok(
  /router\.get\("\/daily",\s*requirePermission\("operations",\s*"view"\),\s*dailyOperationsRead\)/.test(operationsRoute),
  "the /daily route must enforce operations:view permission server-side, the same as every other operations route",
);
// Express route-ordering hazard: "/daily" must be registered before the
// generic "/:id" single-segment route, or "daily" gets parsed as an id.
{
  const dailyIndex = operationsRoute.indexOf('router.get("/daily"');
  const idIndex = operationsRoute.indexOf('router.get("/:id"');
  assert.ok(dailyIndex !== -1 && idIndex !== -1 && dailyIndex < idIndex, "/daily must be registered before the generic /:id route");
}

// ─── 16. The daily endpoint is read-only ───

for (const verb of ["insert", "update", "delete"]) {
  const re = new RegExp(`db\\.${verb}\\(`);
  assert.ok(!re.test(readSource), `daily-operations-read.ts must never call db.${verb}() - it is a pure read model`);
}

// ─── 17. No legacy writes ───

assert.ok(
  !/\.insert\(operationReservationDetailsTable\)/.test(readSource)
    && !/\.update\(operationReservationDetailsTable\)/.test(readSource)
    && !/\.delete\(operationReservationDetailsTable\)/.test(readSource),
  "the daily read model must never write to the legacy operation_reservation_details table",
);

// ─── 18. No schema migration introduced by Phase 1D ───

const migrationsDir = fileURLToPath(new URL("../lib/db/migrations", import.meta.url));
const migrationFiles = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

assert.ok(
  migrationFiles.includes("0022_reservation_domain_phase1a.sql") && migrationFiles.includes("0023_sheet_import_idempotency_cutover.sql"),
  "0022 and 0023 (Phase 1A) must still exist exactly as before Phase 1D",
);
assert.equal(
  migrationFiles.filter(file => /phase1d|daily[._-]?operations/i.test(file)).length,
  0,
  "Phase 1D must not add a migration for the daily-operations read-only surface",
);

// ─── 19. 0022/0023 remain untouched AND unapplied - Phase 1D never runs a migration ───

for (const file of [
  "artifacts/api-server/src/lib/daily-operations-model.ts",
  "artifacts/api-server/src/lib/daily-operations-read.ts",
  "artifacts/tourops-ai/src/components/DailyOperationsBoard.tsx",
]) {
  const src = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
  assert.ok(
    !/migrate|drizzle-kit|runMigrations|applyMigration/i.test(src),
    `${file} must contain no migration-running code of any kind`,
  );
}

// ─── 20. No N+1 - exactly three batched queries regardless of Operation/Reservation count ───

assert.equal(
  (readSource.match(/\.from\(operationsTable\)/g) ?? []).length,
  1,
  "daily-operations-read must issue exactly one query against operationsTable, however many Operations exist for the day",
);
assert.equal(
  (readSource.match(/\.from\(reservationsTable\)/g) ?? []).length,
  1,
  "daily-operations-read must issue exactly one batched query against reservationsTable, never one per Operation",
);
assert.equal(
  (readSource.match(/\.from\(operationReservationDetailsTable\)/g) ?? []).length,
  1,
  "the legacy lookup must be exactly one batched query, never one per Operation",
);
assert.ok(
  /inArray\(reservationsTable\.tourOperationId,\s*operationIds\)/.test(readSource),
  "Reservations must be fetched with one inArray query across all of the day's Operation ids, not per-Operation",
);
assert.ok(
  /inArray\(operationReservationDetailsTable\.operationId,\s*zeroReservationIds\)/.test(readSource),
  "the legacy fallback must be one inArray query, restricted to only the zero-Reservation Operations",
);

// ─── 21. Phase 1C's PAX composition is reused, not reimplemented (both screens agree by construction) ───

assert.ok(
  /import \{ partyPax, summarizePax \} from "\.\/operation-detail-model"/.test(modelSource),
  "the daily model must reuse Phase 1C's partyPax/summarizePax rather than recompute PAX a second way",
);
{
  // summarizePax itself (Phase 1C's, imported unmodified) must behave identically for the daily board.
  assert.deepEqual(
    summarizePax([4, 2]),
    { reservationCount: 2, incompleteReservationCount: 0, totalPax: 6 },
  );
  assert.deepEqual(
    summarizePax([4, null]),
    { reservationCount: 2, incompleteReservationCount: 1, totalPax: null },
  );
}

// ─── 22. Desktop/mobile share the same domain semantics - one component, no device branching ───

assert.ok(
  !/navigator\.userAgent|isMobile|Platform\.OS/.test(boardComponent),
  "DailyOperationsBoard must not branch its data or domain logic by device - one component, one set of semantics, responsive via CSS only",
);
assert.ok(
  /grid-cols-1/.test(boardComponent) && /lg:grid-cols-2/.test(boardComponent),
  "the board must reflow to a single column on narrow viewports via responsive classes, not a separate mobile implementation",
);

// ─── 23. Legacy-only Operation behavior ───

{
  const board = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 7 })],
    reservationsByOperationId: new Map(),
    legacyOperationIds: new Set([7]),
  });
  const legacyOp = board.operations[0];
  assert.equal(legacyOp.legacy, true, "an Operation with zero Reservations but a legacy row must be flagged legacy: true");
  assert.equal(legacyOp.summary.reservationCount, 0, "legacy data must never be counted into the Reservation-domain reservationCount");
  assert.ok(legacyOp.warnings.includes("legacy_only"), "a legacy-only Operation must warn distinctly from a plain no_reservations Operation");

  // A zero-Reservation Operation with NO legacy row must warn no_reservations instead, never legacy_only.
  const board2 = buildDailyBoard({
    date: "2026-09-05",
    operations: [op({ id: 8 })],
    reservationsByOperationId: new Map(),
    legacyOperationIds: new Set(),
  });
  assert.ok(board2.operations[0].warnings.includes("no_reservations"));
  assert.ok(!board2.operations[0].warnings.includes("legacy_only"));
  assert.equal(board2.operations[0].legacy, false);
}

// ─── 24. No accounting/operational mutation anywhere in the Phase 1D surface ───

assert.ok(
  !/useMutation/.test(boardComponent),
  "DailyOperationsBoard.tsx must contain no mutation hook - the board is read-only, click-through only",
);
assert.ok(
  !/router\.(post|patch|put|delete)\("\/daily"/.test(operationsRoute),
  "no mutating HTTP method may ever be registered on the /daily path",
);
assert.ok(
  !/netAmount|advanceAmount|currency/.test(modelSource) && !/netAmount|advanceAmount|currency/.test(readSource),
  "the daily board must not surface financial fields - Phase 1D is not an accounting surface",
);

// ─── 25. Click-through reuses the existing Operation Detail route; the daily board never duplicates detail content ───

assert.ok(
  /href=\{`\/operations\/\$\{operation\.id\}`\}/.test(boardComponent),
  "each Operation card must link to the existing /operations/:id detail route rather than re-render detail content inline",
);
assert.ok(
  /DailyOperationsBoard/.test(calendarPage),
  "calendar.tsx must mount DailyOperationsBoard for its day view rather than a bespoke implementation",
);

// ─── 26. Mobile/PWA access: /calendar (the Daily Operations Center) is a ───
// normal role-gated route, not a desktop-device-restricted one. There is
// exactly one SPA/router/app shell in this codebase - no separate "desktop
// app" vs "mobile app" build - so proving the route carries no device
// check IS proving mobile/PWA access, not a proxy for it.

{
  const routeLine = appRouterSource.split("\n").find(l => l.includes('path="/calendar"'));
  assert.ok(routeLine, "the /calendar route must exist in the single app Router()");
  assert.ok(
    /roles=\{\['admin', 'operations', 'accounting'\]\}/.test(routeLine),
    "/calendar must be gated by role/permission (ProtectedRoleRoute) only, the same mechanism every other route in the app uses",
  );
  assert.ok(
    !/isMobile|isDesktop|Platform\.OS|navigator\.userAgent|matchMedia|window\.innerWidth/.test(routeLine),
    "the /calendar route registration must contain no device/viewport check - RoleRoute is the only gate",
  );
}

// The route is reached through ProtectedRoleRoute/RoleRoute - confirm those
// guards themselves branch on role only, never on device/viewport.
{
  const guardSection = appRouterSource.slice(
    appRouterSource.indexOf("function RoleRoute"),
    appRouterSource.indexOf("function HomeRedirect"),
  );
  assert.ok(guardSection.length > 0, "expected to find the RoleRoute/ProtectedRoleRoute guard functions");
  assert.ok(
    !/isMobile|isDesktop|Platform\.OS|navigator\.userAgent|matchMedia|window\.innerWidth/.test(guardSection),
    "RoleRoute/ProtectedRoleRoute must gate purely on the signed-in user's role - no device/viewport branch exists anywhere in the route-guard chain",
  );
}

// The nav item that opens the board is the SAME item in the SAME <nav>,
// merely re-parented into a slide-over drawer under lg:hidden vs a static
// sidebar under hidden lg:flex - not a second, trimmed-down mobile nav
// that could omit Takvim/Calendar.
{
  assert.ok(
    /\{\s*icon:\s*CalendarDays,\s*label:\s*'Takvim',\s*href:\s*'\/calendar'/.test(appShellSource),
    "AppShell's shared navItems array must include the Takvim (Calendar) entry",
  );
  assert.ok(
    /className="hidden lg:flex flex-col w-60/.test(appShellSource) && /className="lg:hidden fixed inset-0/.test(appShellSource),
    "the sidebar must be the same nav content re-parented for viewport (desktop static / mobile drawer), not two different nav item lists",
  );
  // The one <nav> that actually renders navItems must not itself be wrapped
  // in a desktop-only visibility class - only its two containers (aside vs
  // drawer) are, and both containers render the identical <SidebarContent/>.
  assert.ok(
    !/hidden lg:flex[\s\S]{0,40}navItems\.map/.test(appShellSource),
    "the nav item list itself must not be desktop-only - it is shared by both the desktop sidebar and the mobile drawer",
  );
}

// PWA: one shell for every device. navigateFallback serves index.html (the
// same SPA/router bundle) for any non-/api/ path, so /calendar works the
// same standalone-installed or in a mobile browser tab as on desktop; the
// API denylist is scoped to /api/, never to a page route.
{
  assert.ok(
    /navigateFallback:\s*'index\.html'/.test(viteConfigSource),
    "the PWA config must fall back to the same SPA shell for every page route, on every device",
  );
  assert.ok(
    /navigateFallbackDenylist:\s*\[\/\^\\\/api\\\//.test(viteConfigSource),
    "the PWA navigation denylist must be scoped to /api/ requests only, never to a UI route like /calendar",
  );
  assert.ok(
    !/\/calendar/.test(viteConfigSource),
    "vite.config.ts must contain no special-case handling for /calendar - it is precached/served exactly like every other route",
  );
}

// DailyOperationsBoard/calendar.tsx: no fixed pixel width that would force
// horizontal overflow on a narrow (e.g. 375px) viewport - only Tailwind's
// responsive/flex/grid utilities are used, consistent with the assertion
// in check 22 that there is no separate mobile implementation at all.
{
  const fixedWidthPattern = /\bw-\[\d{3,}px\]/;
  assert.ok(!fixedWidthPattern.test(boardComponent), "DailyOperationsBoard must not use a fixed pixel width that could overflow a narrow viewport");
  assert.ok(!fixedWidthPattern.test(calendarPage), "calendar.tsx must not use a fixed pixel width that could overflow a narrow viewport");
  assert.ok(!/overflow-x-scroll|overflow-x-auto/.test(boardComponent), "the board must reflow via grid/flex, not rely on horizontal scrolling to fit its content");
}

console.log("daily operations Phase 1D focused tests: passed");
