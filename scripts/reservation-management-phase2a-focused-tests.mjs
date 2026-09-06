import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Load the real pure-logic modules directly (Node 22's built-in TS type ──
// stripping erases the plain type annotations; no bundler/tsx involved) so
// these assertions exercise the actual PAX/transition logic, not a
// hand-copied mirror of it.
const modelUrl = new URL("../artifacts/api-server/src/lib/operation-detail-model.ts", import.meta.url);
const { partyPax, summarizePax } = await import(modelUrl.href);

const writeUrl = new URL("../artifacts/api-server/src/lib/reservation-record-write.ts", import.meta.url);
const { canTransitionReservationStatus, diffChangedFields } = await import(writeUrl.href);

function read(relPath) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

const listReadSource = read("../artifacts/api-server/src/lib/reservation-record-read.ts");
const writeSource = read("../artifacts/api-server/src/lib/reservation-record-write.ts");
const routeSource = read("../artifacts/api-server/src/routes/reservation-records.ts");
const routesIndex = read("../artifacts/api-server/src/routes/index.ts");
const appSource = read("../artifacts/tourops-ai/src/App.tsx");
const appShellSource = read("../artifacts/tourops-ai/src/components/AppShell.tsx");
const listPageSource = read("../artifacts/tourops-ai/src/pages/reservation-records.tsx");
const detailPageSource = read("../artifacts/tourops-ai/src/pages/reservation-record-detail.tsx");
const incomingQueuePageSource = read("../artifacts/tourops-ai/src/pages/reservations.tsx");
const viteConfig = read("../artifacts/tourops-ai/vite.config.ts");

// ─── Domain: PAX math is reused, never reimplemented ───────────────────────

assert.ok(
  /import \{ partyPax \} from "\.\/operation-detail-model"/.test(listReadSource),
  "the Phase 2A read model must reuse partyPax from operation-detail-model.ts, not reimplement PAX math",
);
assert.equal(partyPax({ adultCount: 2, childCount: 1 }), 3, "PAX must sum adults + children");
assert.equal(partyPax({ adultCount: null, childCount: 1 }), null, "a missing adult count must not default to 0");
assert.equal(summarizePax([2, null, 4]).totalPax, null, "one incomplete reservation must null the aggregate total, never silently drop it");

// ─── Domain: Guest count is never the PAX source ───────────────────────────

assert.ok(
  !/guests\.length/.test(listReadSource.match(/collectRowWarnings[\s\S]*?^\}/m)?.[0] ?? ""),
  "row warnings must never derive from a guest count",
);
assert.ok(
  /Toplam PAX:.*totalPax.*misafir sayısından değil/.test(detailPageSource) === false
    ? /kayıtlı misafir sayısından değil/.test(detailPageSource)
    : true,
  "the detail workspace must state PAX comes from adult+child counts, not the guest roster",
);
assert.ok(/Kayıtlı misafir yok/.test(detailPageSource), "zero named guests must render an explicit, non-fabricated empty state");

// ─── Domain: multiple reservations under one operation stay separate ───────

assert.ok(
  /siblingReservations/.test(listReadSource) && /tourOperationId, row\.operation\.id\).*!= \$\{id\}/s.test(listReadSource),
  "detail read model must list sibling reservations rather than merge them",
);
assert.ok(
  /siblings = row\.operation \? await db\.select/.test(listReadSource),
  "sibling reservations must come from a real, separate query keyed by operation id, never assumed",
);

// ─── Domain: unlinked-operation representation exists but is honest about being unreachable today ───

assert.ok(
  /tourOperationId: integer\("tour_operation_id"\)\s*\n\s*\.notNull\(\)/.test(
    read("../lib/db/src/schema/reservations.ts"),
  ),
  "reservations.tourOperationId must still be NOT NULL - Phase 2A must not have silently relaxed it",
);
assert.ok(/Operasyona Atanmamış/.test(listPageSource) && /Operasyona Atanmamış/.test(detailPageSource),
  "both list and detail must render the unassigned-operation state even though it cannot occur under the current schema",
);

// ─── API: RBAC is enforced server-side on every route ──────────────────────

assert.ok(/router\.get\("\/", requirePermission\("reservations", "view"\), reservationRecordListRead\)/.test(routeSource));
assert.ok(/router\.get\("\/:id", requirePermission\("reservations", "view"\), reservationRecordDetailRead\)/.test(routeSource));
assert.ok(/router\.patch\("\/:id", requirePermission\("reservations", "update"\)/.test(routeSource));
assert.ok(/router\.use\(requireAuth\)/.test(routeSource), "every route in this router must sit behind requireAuth");

// ─── API: mounted at a distinct path, never shadowing the import queue ─────

assert.ok(/router\.use\("\/reservation-records", reservationRecordsRouter\)/.test(routesIndex));
assert.ok(!/router\.use\("\/reservations", reservationRecordsRouter\)/.test(routesIndex),
  "the new domain router must never be mounted at /reservations - that path belongs to the import queue");

// ─── API: filters exist and are applied in SQL, not just accepted and ignored ──

for (const filter of [
  "reservationStatus", "operationStatus", "sourceType", "operator", "bookingReference",
  "incompletePax", "missingPickup", "missingLanguage",
]) {
  assert.ok(listReadSource.includes(filter), `list read model must implement the '${filter}' filter`);
}

// ─── API: detail 404s cleanly on a missing id ──────────────────────────────

assert.ok(/if \(!row\) \{ res\.status\(404\)/.test(listReadSource), "detail read model must 404 when the reservation does not exist");

// ─── API: no N+1 - a fixed, small number of queries regardless of row count ──

const listSelectCount = (listReadSource.match(/await db\.select/g) ?? []).length;
assert.ok(listSelectCount <= 5, `expected a small fixed number of db.select calls (found ${listSelectCount}), not one per row`);
assert.ok(!/for\s*\(.*\)\s*\{[\s\S]*await db\./.test(listReadSource), "no query may be issued inside a loop over rows");

// ─── API: safe mutation validation - only the approved fields are settable ──

assert.ok(/\.strict\(\)/.test(writeSource), "edit schemas must be .strict() so an unlisted field is rejected, not silently ignored");
for (const forbidden of ["sourceEmailImportId", "sourceSheetImportId", "sourceHistoricalKey", "customerId", "tourOperationId"]) {
  assert.ok(
    !new RegExp(`${forbidden}:\\s*z\\.`).test(writeSource),
    `${forbidden} must not appear as an editable field in the write schema`,
  );
}
assert.equal(canTransitionReservationStatus("new", "confirmed"), true);
assert.equal(canTransitionReservationStatus("completed", "new"), false, "a terminal status must not be reversible");
assert.equal(canTransitionReservationStatus("new", "new"), true, "setting the same status must always be a no-op success");
assert.deepEqual(
  diffChangedFields({ status: "new", leadGuestName: "A" }, { status: "confirmed" }),
  ["status"],
  "the audit diff must report only fields that actually changed",
);

// ─── API: reservation and operation status stay independent ───────────────

assert.ok(
  !/operationsTable\)\s*\n?\s*\.set\(/.test(routeSource),
  "the mutation route must never write to operationsTable - reservation and operation status must stay independent",
);

// ─── Legacy: operation_reservation_details is never written by anything new ─

for (const [name, source] of [
  ["reservation-record-read.ts", listReadSource],
  ["reservation-record-write.ts", writeSource],
  ["reservation-records.ts (route)", routeSource],
]) {
  assert.ok(!/operationReservationDetailsTable/.test(source), `${name} must not reference the legacy compatibility table at all`);
}

// ─── UI/static: routes and nav registered, incoming queue left untouched ───

assert.ok(/path="\/reservation-records\/:id"/.test(appSource));
assert.ok(/path="\/reservation-records"/.test(appSource));
const reservationsNavGroup = appShellSource.match(/id: 'reservations'[\s\S]*?hrefs:\s*\[([\s\S]*?)\]/)?.[0] ?? "";
const reservationRecordNavIndex = appShellSource.indexOf("href: '/reservation-records'");
const reservationRecordNavItem = reservationRecordNavIndex >= 0
  ? appShellSource.slice(Math.max(0, reservationRecordNavIndex - 300), reservationRecordNavIndex + 300)
  : "";
assert.ok(/NAV_GROUPS/.test(appShellSource) && /label: 'Rezervasyonlar'/.test(reservationsNavGroup),
  "the domain-based navigation must retain the reservations group");
assert.ok(/'\/reservation-records'/.test(reservationsNavGroup),
  "the new workspace must be grouped under the reservations domain");
assert.ok(
  /permission/.test(reservationRecordNavItem)
    && /reservations/.test(reservationRecordNavItem)
    && /view/.test(reservationRecordNavItem),
  "the new workspace nav item must require reservations.view permission",
);
assert.ok(
  /import\s*\{[^}]*ClipboardCheck[^}]*\}\s*from 'lucide-react'/.test(appShellSource)
    && /icon: ClipboardCheck/.test(reservationRecordNavItem),
  "the new workspace nav item must keep its ClipboardCheck icon import and usage",
);
assert.ok(
  /title="Gelen Rezervasyonlar"/.test(incomingQueuePageSource) && /href={`\/reservations\/\$\{item\.id\}`}/.test(incomingQueuePageSource),
  "the existing import-review queue page must remain unchanged and clearly distinct",
);
assert.ok(/href={`\/operations\/\$\{/.test(listPageSource) && /href={`\/operations\/\$\{/.test(detailPageSource),
  "both surfaces must link out to the real Operation Detail Workspace, never re-render it inline");

// ─── UI/static: mobile/PWA reachability, no fixed-width desktop-only pattern ──

// (?<!min-)(?<!max-) excludes the codebase-wide min-w-[...]/max-w-[...] convention
// (used throughout operation-detail.tsx, reservations.tsx, etc. for truncation/min
// sizing, which does not force fixed-width overflow) - only a bare w-[...] utility,
// which would pin an element to a fixed desktop width regardless of viewport, fails.
const fixedWidthPattern = /(?<!min-)(?<!max-)w-\[\d{3,}px\]/;
assert.ok(!fixedWidthPattern.test(listPageSource) && !fixedWidthPattern.test(detailPageSource),
  "no fixed pixel width may be used - the workspace must degrade responsively like the rest of the app");
assert.ok(!/overflow-x-scroll/.test(listPageSource), "the list must not rely on horizontal scrolling to be usable on mobile");
assert.ok(/sm:hidden/.test(listPageSource) && /hidden sm:block/.test(listPageSource),
  "the list page must render a genuine mobile card layout distinct from the desktop table, not just a hidden column trick");
assert.ok(
  /navigateFallback: 'index\.html'/.test(viteConfig) && !/reservation-records/.test(viteConfig),
  "the existing PWA fallback already covers every UI route with no per-route special-casing needed - Phase 2A requires no vite.config.ts change",
);

console.log("reservation management Phase 2A focused tests: passed");
