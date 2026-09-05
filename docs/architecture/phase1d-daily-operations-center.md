# Phase 1D: Daily Operations Center

Status: **one additive, batched, read-only endpoint plus one new frontend
board component, mounted into the existing Calendar page's day view. No
schema change, no migration, no write path, no automation.** This document
describes what Phase 1D adds, the semantics it commits to, and what it
deliberately does not do.

## What existed before Phase 1D

Phase 1C (`docs/architecture/phase1c-operation-detail.md`) gave every
Operation a Reservation-domain detail view, but only one Operation at a
time, opened one at a time, by id. There was no single screen where an
operations employee could see the day's Operations together - the shape
they previously got from the daily Excel file. The existing `/calendar`
page already had day/month view switching and date navigation
(`lib/calendar-grouping.ts`), but its day view rendered nothing but a bare
list of Operation names with no Reservation-domain data at all.

## Why `/calendar`, not `/field` or `/operations`

The brief asked for reuse of existing operations/navigation architecture
rather than inventing a new page. Three existing routes were inspected:

- `/field` ("Operasyon Merkezi" in the nav) is the mobile field-staff
  dashboard (`field-dashboard.tsx`) - KPI cards and today's assignments for
  a field user, gated by `field_operations:view`, with no date navigation
  and no Reservation-domain concept.
- `/operations` ("Operasyon Planlama") is the CRUD/management table
  (`operations.tsx`) for creating and editing Operations - the wrong shape
  for a read-only daily overview.
- `/calendar` ("Takvim") already had month/day toggle, prev/next/today
  navigation, and an explicit day-view branch that was rendering almost
  nothing (`dayOperations` bare list) - the one existing screen already
  structurally intended for "operations on a specific day."

Phase 1D replaces that thin day-view branch with `<DailyOperationsBoard
date={cursorKey} />`, reusing the page's own date-cursor state
(`cursorKey`, already a `YYYY-MM-DD` string from `toDateKey()`) rather than
introducing a second date-navigation implementation. Nothing else on the
Calendar page - the month-grid view, the view-mode toggle, the nav entry,
the `operations:view` permission gate - was changed.

## API contract

`GET /api/operations/daily?date=YYYY-MM-DD` (`requirePermission("operations",
"view")`, the same permission the sibling `GET /:id` route already
enforces). `date` is optional; when omitted it defaults to
`todayInIstanbul()`, the app's existing Europe/Istanbul-anchored "what day
is it" utility (chosen specifically so Render's UTC clock cannot roll the
day over three hours early). A malformed `date` (anything not matching
`^\d{4}-\d{2}-\d{2}$`) is rejected with `400`, never silently coerced.

The response is one object:

```
{
  date: "2026-09-05",
  summary: { operationCount, reservationCount, knownTotalPax,
             incompleteOperationPaxCount, missingGuideCount, missingVehicleCount },
  operations: [{
    sequence,                      // 1-based TUR display position, see below
    operation: { id, status, startDate, endDate, pickupTime, notes },
    context: { tourName, programName, programCode, shipName, cruiseLine,
               portName, arrivalTime, departureTime },
    resources: { guideName, guidePhone, driverName, driverPhone,
                 vehiclePlate, vehicleType, vehicleCapacity },
    summary: { reservationCount, incompleteReservationCount, totalPax },
    reservations: [{ id, leadGuestName, status, sourceType, sourceBookingReference,
                     reservationType, adultCount, childCount, totalPax,
                     passengerLanguage, pickupPoint, externalSource,
                     externalOperator, specialRequirements }],
    legacy: boolean,
    warnings: string[],
  }],
}
```

Deliberately absent: `guests[]`, and every financial field
(`netAmount`/`advanceAmount`/`currency`/collection status). The daily board
is an overview; Operation Detail (Phase 1C) remains the only place Guests
and financials are shown, one Operation at a time.

## Query / batching strategy - exactly three queries, always

Regardless of how many Operations or Reservations exist for the requested
date:

1. One joined query for the day's Operations plus their tour/program,
   ship/port-call, guide/driver resource, and vehicle context -
   `WHERE operations.startDate = :date`, left-joined the same way Phase
   1C's `/detail` context join already works, plus one additional
   self-join alias (`driver`) on `resourcesTable` for the driver resource
   alongside the existing guide resource join.
2. One batched query for every Reservation + BookingParty across all of
   that day's Operations, via `inArray(reservationsTable.tourOperationId,
   operationIds)` - not one query per Operation.
3. One batched legacy lookup via `inArray(operationReservationDetailsTable.operationId,
   zeroReservationIds)`, restricted to only the Operations that came back
   with zero Reservations (the same "only when the hierarchy is actually
   empty" rule Phase 1C's `/detail` endpoint already uses).

Guests are never fetched - there is no fourth query, because the daily
board has no Guest-level UI. The Phase 1D focused test suite asserts each
of the three `.from(...)` calls appears in the source exactly once, so a
future edit that reintroduces a per-Operation loop breaks the test
immediately rather than shipping silently.

## Domain semantics (unchanged from Phase 1A-1C, extended not redecided)

- **Operation != Reservation.** `reservations[]` under each Operation is a
  flat array; an Operation with three independently-sourced Reservations
  shows three separate cards, never merged, never capped, never
  deduplicated.
- **PAX.** `totalPax = adultCount + childCount`, computed by
  `partyPax()` - imported unmodified from Phase 1C's
  `operation-detail-model.ts`, not reimplemented. If either count is
  `null`, that Reservation's `totalPax` is `null`. An Operation's
  `summary.totalPax` is the plain sum of every Reservation's `totalPax`,
  and is itself `null` (never a partial sum) if any Reservation on that
  Operation is incomplete; `summary.incompleteReservationCount` says how
  many. This is `summarizePax()`, a function extracted out of Phase 1C's
  `composeReservations()` during this phase specifically so Operation
  Detail and the Daily board can never compute "total PAX" two different
  ways - Phase 1C's own focused test suite was re-run unchanged after the
  extraction to confirm its behavior did not move.
- **Board-level `knownTotalPax`.** The sum of `summary.totalPax` across
  only the Operations whose PAX is fully known; an Operation with any
  incomplete Reservation contributes nothing to this figure rather than
  an under-count being mistaken for a complete one.
  `incompleteOperationPaxCount` is the count of Operations affected, so the
  gap is visible rather than silently absorbed into the total.
- **Operation status and Reservation status stay independent.** Neither is
  derived from the other anywhere in this phase, the same rule Phase 1C
  established.
- **No automatic Reservation-to-Operation matching or merging.** The daily
  read model only reads the existing `reservations.tourOperationId` link;
  it never writes it, guesses it, or groups Reservations by any heuristic.
  Any future "suggest this Reservation belongs to this Operation" workflow
  is explicitly out of scope for Phase 1D and would require a human-approval
  step to even exist.
- **No Guest fabrication.** The daily model has no Guest-record concept at
  all (no `guests[]` field, no Guest type) - it composes PAX from
  `adultCount`/`childCount` only, and never queries the `guests` table.

## Daily date semantics

`operations.startDate` and `endDate` are plain SQL `date` columns with no
time-of-day or timezone component. "Does this Operation belong to `date`"
is therefore an exact string-equality match (`startDate = :date`) with no
UTC/Istanbul instant conversion involved anywhere - there is nothing to get
wrong the way there would be with a `timestamptz` column. A multi-day
Operation (`endDate > startDate`) is shown once, on its `startDate` only -
the same convention the existing Calendar month/day grouping
(`calendar-grouping.ts`) already uses, preserved rather than redecided by
this phase. `pickupTime` is a free-text `"HH:MM"` column (confirmed via the
existing `historical-pickup-time-correction*` code, which already treats it
as text); it sorts correctly as plain lexicographic text because every
value already in the system is zero-padded. An omitted `?date=` defaults to
`todayInIstanbul()`.

## TUR display sequence

`sequence` ("TUR 1", "TUR 2", ...) is computed fresh on every request by
sorting the day's Operations by `pickupTime` ascending (Operations with no
recorded pickup time sort last), tie-broken by the Operation's own id for
a fully deterministic order. It is a **display position only**: never
persisted anywhere, never a physical slot or vehicle-seat model, never
limiting how many Operations, Reservations, or Guests can exist for the
day, and never used to mutate source data. Reordering the day's Operations
(a guide's pickup time changing, a new Operation appearing) simply
recomputes different `sequence` numbers on the next read.

## Legacy operations

An Operation with zero rows in `reservations` is checked against the
legacy `operation_reservation_details` table (`SELECT` only, batched, never
per-Operation). If a legacy row exists, the Operation is flagged `legacy:
true` and gets a `legacy_only` warning instead of `no_reservations`; if
neither a Reservation nor a legacy row exists, it gets a plain
`no_reservations` warning. In both cases `summary.reservationCount` for
that Operation is `0` - legacy data is never counted into the
Reservation-domain reservation count, never synthesized into a fake
Reservation, and never mixed with real Reservation-domain data in the same
array. The daily board does not render the legacy row's own field content
(unlike Phase 1C's `/detail` screen, which does show it in a read-only
section) - the daily board only needs to know *that* an Operation is
legacy-only, not the legacy row's contents, so no legacy fields were added
to the daily response shape.

## Warning rules

Eight deterministic warnings, each firing on one concrete, operationally
meaningful condition - no AI-generated or heuristic warnings anywhere in
this phase:

| Warning | Fires when |
|---|---|
| `missing_guide` | the Operation has no resolved guide name |
| `missing_vehicle` | the Operation has no resolved vehicle plate |
| `missing_pickup_time` | `pickupTime` is not set |
| `missing_pickup_point` | the Operation has at least one Reservation and at least one of them has no `pickupPoint` |
| `incomplete_pax` | `summary.incompleteReservationCount > 0` |
| `no_reservations` | zero Reservations and no legacy row |
| `legacy_only` | zero Reservations but a legacy row exists |
| `vehicle_capacity_exceeded` | `vehicleCapacity` is known **and** `totalPax` is known **and** `totalPax > vehicleCapacity` |

`vehicle_capacity_exceeded` deliberately never fires when either side is
unknown - an Operation with no recorded vehicle capacity, or with
incomplete Reservation PAX, gets no capacity warning at all rather than a
guessed one, because trusting an unknown value either way would be worse
than saying nothing. `missing_pickup_point` and `no_reservations`/
`legacy_only` are mutually exclusive with each other by construction (the
pickup-point check only runs when Reservations exist), so a legacy-only
Operation is never also flagged for a missing pickup point it structurally
cannot have.

## Resource-field resolution (guide/driver/vehicle)

`guideName`, `guidePhone`, `driverName`, `driverPhone`, and `vehiclePlate`
each use the exact same precedence `OperationDomainWorkspace.tsx` (Phase
1C) already renders: the Operation's own free-text field first, falling
back to the linked master-data resource (and, for the guide, further
falling back to the assigned guide user's profile name) - resolved once in
`daily-operations-read.ts` from the same joined row Phase 1C's `/detail`
context join produces, not duplicated business logic that could drift out
of sync with the detail screen.

## RBAC

The `/daily` route is mounted with the same `requirePermission("operations",
"view")` guard as the existing `GET /:id` route in the same file - no new
permission was introduced and no existing one was broadened. This is a
role/permission distinction, not a device one: any signed-in user whose
role carries `operations:view` (currently `admin`, `operations`, and
`accounting` - see `App.tsx`'s `roles={['admin', 'operations',
'accounting']}` on the `/calendar` route) can open the Daily Operations
Center from a desktop browser, a tablet, a phone browser, or the installed
PWA - there is one Router/app shell for the whole product, not a separate
"desktop app." It is registered as a single mount on the `operations`
router (the same Express router the existing `/:id` detail route already
lives on) rather than duplicated onto the field/guide **routers** - those
are separate Express routers gated by different permissions
(`field_operations:view`, `guide_workspace:view`) for the field-staff and
guide-specific surfaces, not a "mobile" router. Extending the same read
model to those two role-scoped surfaces is a natural, low-risk Phase 1E
candidate (see below); it is unrelated to whether the current surface
already works on mobile/PWA, which it does.

**Responsive operations surface: desktop/tablet/mobile/PWA for users with
`operations:view`.** Separate field/guide workspaces are not included in
Phase 1D.

One implementation note carried over from Phase 1C: Express matches routes
in registration order, and `/daily` and `/:id` are both single-path-segment
routes on the same router. `/daily` is registered **before** `/:id`
(`operations.ts`); if the order were reversed, every request to
`/api/operations/daily` would instead hit the `/:id` handler with
`id = "daily"` (`parseInt("daily")` is `NaN`). The Phase 1D focused test
suite asserts this ordering directly by source position, not just by
behavior, so a future reorder fails the test before it ever reaches a
running server.

## Responsive / desktop / tablet / mobile / PWA

`DailyOperationsBoard` is reached through the single `/calendar` route
described above, which is reachable on any device - it is not a
desktop-only page reusing a responsive component; the route itself, its
nav entry, and the PWA's `navigateFallback` are all device-agnostic (see
the RBAC section and the Phase 1D focused test suite's mobile/PWA-access
checks). `DailyOperationsBoard` is the same component, same data, same
markup on every viewport - there is no separate mobile implementation to
drift out of sync with desktop. The summary strip is a `grid-cols-3 sm:grid-cols-6`
row of stat tiles; the Operation cards are `grid-cols-1 lg:grid-cols-2`,
so they stack to one column on narrow viewports with no horizontal
scrolling. Each card's own Reservation list is behind a `<details>`
disclosure (the same pattern Phase 1C uses for its denser sections) so a
day with many Reservations per Operation still stays scannable on a phone;
the same information is one tap away rather than removed. Every status and
warning is rendered as Turkish text, not color alone. No new visual
language was introduced - `OPERATION_STATUS_LABELS` colors, card/border/
`text-muted-foreground` conventions, and the existing `AppShell`/Calendar
page chrome are reused as-is.

## Read-only scope - explicit proof points

- `daily-operations-read.ts` contains no `db.insert(`, `db.update(`, or
  `db.delete(` call anywhere - verified both by direct inspection and by
  the focused test suite's source-regex assertions.
- No route registered on the `/daily` path accepts `POST`/`PATCH`/`PUT`/
  `DELETE`.
- `DailyOperationsBoard.tsx` contains no `useMutation` hook and no form -
  every interactive element is either a disclosure `<summary>`, a retry
  button that only re-runs the same `GET`, or a `<Link>` to the existing
  Operation Detail route.
- No financial field (`netAmount`, `advanceAmount`, `currency`, collection
  status) is fetched or returned by the daily read model.
- No Guest row is ever fetched, inserted, or fabricated.
- No Reservation-to-Operation assignment is ever written; the read model
  only reads the existing `tourOperationId` link.

## No AI, no schema/migration change

Phase 1D calls no AI provider and contains no automated decision-making of
any kind - every warning is a fixed, deterministic condition evaluated in
plain code, listed in full above. No migration file was added: the highest
migration in `lib/db/migrations` remains `0023_sheet_import_idempotency_cutover.sql`,
exactly as it was on `main` before this branch. Migrations `0022`
(`reservation_domain_phase1a.sql`) and `0023`
(`sheet_import_idempotency_cutover.sql`) - both already present in the
repository from Phase 1A - were not modified, and neither was applied to
any database by this phase; nothing in Phase 1D's code path calls a
migration runner. The Phase 1D focused test suite asserts the migrations
directory's file list directly (0022/0023 present, nothing numbered higher)
so an accidental new migration file would fail the suite immediately.

## Blast radius

Only these files were touched: two new backend files
(`daily-operations-model.ts`, `daily-operations-read.ts`), one new frontend
component (`DailyOperationsBoard.tsx`), a two-line addition to
`operations.ts` (import + one route registration), two small additive
label-map exports in `labels.ts`, a mechanical extraction of `summarizePax`
out of `operation-detail-model.ts` (Phase 1C's own test suite re-verified
passing unchanged after the extraction), an import-only change to
`OperationDomainWorkspace.tsx` (re-pointing two inline label maps at the
new shared `labels.ts` exports, same values, same local identifier names),
and the Calendar page's day-view branch. No route file other than
`operations.ts` was touched; `sheet-import.ts`, `reservations.ts`, and
`historical-migration-promote.ts` remain completely unaware of the daily
read model, the same blast-radius guarantee Phase 1C's test suite already
enforces for the `/detail` read model.

## Explicit non-goals (Phase 1D)

- Does not apply, generate, or modify any migration; `0022`/`0023` are
  untouched and unapplied.
- Does not write to `reservations`, `booking_parties`, `guests`, or
  `operation_reservation_details` anywhere in the new code.
- Does not add any Reservation/BookingParty/Operation mutation API -
  existing mutation routes are the only way to change anything shown here.
- Does not perform automatic Reservation-to-Operation matching, merging,
  or deduplication.
- Does not call any AI provider or perform any automated action.
- Does not fetch or display Guests, or any financial field.
- Does not build a calendar/scheduling system beyond the existing
  month/day view it plugs into - no drag-and-drop, no multi-week grid
  changes.
- Does not touch accounting, CRM/customers, or multi-tenancy.

## Follow-ups explicitly excluded from Phase 1D

- Extending the same batched daily read model to the field (`/field`) and
  guide (`guide_workspace`) role-scoped surfaces, with their own
  ownership-scoped permission checks (mirroring how Phase 1C mounted
  `/detail` on all three surfaces) - Phase 1D only mounted the
  `operations`-permission surface (already fully responsive on
  desktop/tablet/mobile/PWA for that role group; this follow-up is about
  reaching the field/guide *roles*, not about reaching mobile devices).
- A shared guide/vehicle-name resolution helper: the precedence logic is
  currently duplicated (by design, to avoid a risky shared-module
  refactor mid-phase) between `OperationDomainWorkspace.tsx` and
  `daily-operations-read.ts`; unifying it into one exported helper is a
  safe, low-risk follow-up.
- Reservation/BookingParty-level audit trail - unchanged gap already
  documented in Phase 1C's own architecture note.
- Any human-approved "suggest this Reservation belongs to this Operation"
  workflow - explicitly not started, not even scaffolded, in this phase.
- A future "AI risk summary" panel on the daily board - the UI leaves
  room for one but nothing beyond that was built or wired up.
