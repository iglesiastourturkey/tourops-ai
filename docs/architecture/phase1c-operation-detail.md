# Phase 1C: Operation Detail / Reservation Domain UI

Status: **read-only UI + one additive read-model API endpoint. No schema
change, no migration, no write-path change.** This document describes what
Phase 1C adds, why, and exactly what it deliberately does not do.

## Previous Operation Detail data model

Before Phase 1C, the desktop Operation Detail page (`operation-detail.tsx`),
the field/PWA page (`field-operation-detail.tsx`), and the guide page
(`guide-operation-detail.tsx`) each rendered only `operations` (plus a
handful of directly related reads: tasks, receipts, documents, field notes,
incidents, location). None of them had any notion of the Reservation domain
introduced in Phase 1A and populated in Phase 1B — a page for an operation
with three independently-sourced bookings looked identical to one with a
single booking, because nothing surfaced `reservations` /
`booking_parties` / `guests` at all. The only per-booking detail visible
anywhere was the legacy 1:1 `operation_reservation_details` row, and only on
whichever screen happened to read it directly.

## New read model

A single new backend module, `operation-detail-model.ts` (pure composition
functions) plus `operation-detail-read.ts` (the Express handler), computes
one cohesive DTO per operation and is mounted, unmodified, on all three
existing surfaces:

- `GET /api/operations/:id/detail` (desktop — `requirePermission("operations", "view")`)
- `GET /api/field/operations/:id/detail` (field/PWA — `requirePermission("field_operations", "view")`)
- `GET /api/guide/my-operations/:id/detail` (guide — `requirePermission("guide_workspace", "view")`, plus the same guide-can-only-see-their-own-operation check every other guide route already enforces)

Each existing page mounts one new shared component,
`<OperationDomainWorkspace operationId={id} surface="..." />`, that calls its
surface's `/detail` endpoint and renders the full Reservation hierarchy
underneath the page's existing content. Nothing existing on any of the three
pages was removed, replaced, or restructured — the new workspace is purely
additive markup inserted into each page.

## API contract

The `/detail` response is one object:

```
{
  operation: { id, status, startDate, endDate, pickupTime, notes, sourceType,
               guideName, guidePhone, driverName, driverPhone, vehiclePlate,
               createdAt, updatedAt },
  context: { tourName, programName, programCode, shipName, cruiseLine, portName,
             arrivalDate, arrivalTime, departureDate, departureTime,
             tourShipName, tourPortName, tourArrivalTime, tourDepartureTime,
             guideResourceName, guideResourcePhone, guideCompany, assignedGuideName,
             driverResourceName, driverResourcePhone, driverCompany,
             vehiclePlate, vehicleType, vehicleCapacity, vehicleCompany },
  reservations: [{ id, leadGuestName, status, sourceType, sourceBookingReference,
                   reservationType, rebookedIntoReservationId, customer: {id,name} | null,
                   createdAt, updatedAt,
                   bookingParty: { adultCount, childCount, totalPax, passengerLanguage,
                                   pickupPoint, externalSource, externalOperator,
                                   netAmount, advanceAmount, currency, collectionStatusRaw,
                                   mealIncluded, entranceIncluded, specialRequirements,
                                   itineraryRaw, tourCodeRaw, shipScheduleRaw,
                                   guests: [{id, name, age}] } | null }],
  summary: { reservationCount, incompleteReservationCount, totalPax },
  legacy: ({ ...operation_reservation_details row, readOnly: true, totalPax } | null),
  history: { activity: [{id, eventType, actorName, createdAt}], limit: 100, reservationHistoryAvailable: false },
}
```

`context` is one additional joined row (tour/program, ship/port-call, guide
and driver resource, vehicle) resolved from `operations`' own FK columns
(`tourId`, `tourProductId`, `portCallId`, `guideResourceId`,
`driverResourceId`, `vehicleId`) — none of these joins run per-reservation.
The whole response costs exactly five queries regardless of how many
reservations an operation has: one for the operation row, one for the joined
context row, one batched query for all `reservations`/`booking_parties`
(left-joined so a reservation with no party, or no linked customer, still
returns), one batched `inArray` query for every `guests` row across every
booking party on the operation, and one for the last 100 audit-log rows.
There is no query issued once per reservation.

## Reservation hierarchy

`operationsTable` is unchanged and remains the aggregate root.
`reservations[]` is a flat array under the operation — a `Reservation !=
Operation` operation with three independently-sourced bookings (VIATOR,
GetYourGuide, direct) returns three separate entries, each with its own
`leadGuestName`, `status`, `sourceType`/`sourceBookingReference`, and its own
`bookingParty`. Nothing on the backend or in `OperationDomainWorkspace`
merges reservations together; the UI renders one card per reservation.

## PAX semantics

For each `bookingParty`, `totalPax = adultCount + childCount`, computed by
the pure function `partyPax()` — never `COUNT(guests)`. If either count is
`null`, `totalPax` is `null` (represented in the UI as "Eksik yolcu sayısı" /
missing passenger count), not zero. `summary.totalPax` is the sum of every
reservation's `bookingParty.totalPax` across the operation, and is itself
`null` — not a partial sum — whenever any reservation on the operation has
an incomplete count, so the UI never shows a total that silently excludes an
unknown-sized party; `summary.incompleteReservationCount` tells the UI (and
the person reading it) how many reservations that affects, and the
workspace surfaces it as an explicit warning banner rather than a silently
wrong number.

## Guest semantics

`guests[]` under a `bookingParty` are exactly the real, on-file `guests`
rows for that party — nothing is added or removed to make the array's length
match `totalPax`. A `bookingParty` with `adultCount: 3, childCount: 1` and
only two named guests ("Richard", "Lyne") on file is valid and renders as
"4 PAX" with a collapsed "Kayıtlı misafirler (2)" detail section labeled
"Misafir kayıt sayısı PAX değildir" (guest-record count is not PAX). A
`bookingParty` with zero guest rows renders "Kayıtlı misafir yok" (no guests
on file) — never a fabricated placeholder.

## Legacy compatibility

An operation that predates the Reservation model has zero rows in
`reservations`. `operation-detail-read.ts` only queries the legacy
`operation_reservation_details` table (`SELECT`, never write) when
`reservations` for that operation is empty; if even one reservation exists,
the legacy table is not queried at all, because a real hierarchy already
exists. When the legacy row is returned it is tagged `readOnly: true` and
rendered by `OperationDomainWorkspace` in its own amber-bordered "Eski
rezervasyon verisi · Salt okunur" section, explicitly stated not to count
toward the operation's Reservation-based PAX total. No operation, legacy or
not, can crash this endpoint: an operation with neither reservations nor a
legacy row simply renders "Bu operasyona bağlı Reservation kaydı yok" (no
Reservation records for this operation).

## RBAC

Every `/detail` route reuses its surface's existing permission exactly as
written on the sibling routes in the same file — no new permission was
introduced and no existing one was broadened. The guide surface additionally
re-checks, inside the shared handler, that a caller with role `guide` can
only load an operation whose `assignedGuideUserId` matches their own Clerk
user id (the same rule `checkGuideOwnership()` already enforces on every
other guide-facing route in `operations.ts`); it is not re-checked for the
`operations` or `field_operations` permissions, since neither of those roles
is ownership-scoped today. No RBAC decision is made or trusted client-side.

Granting `field_operations.view` to a profile whose role remains `guide`
does not broaden that guide's operation scope. The shared handler derives
ownership from the verified Clerk user id and compares it with
`operations.assignedGuideUserId`; names are never used as identity.

## Response sensitivity and mobile boundary

The Phase 1C DTO intentionally preserves the full detail required by its
existing PWA consumers. It includes booking financial fields (`netAmount`,
`advanceAmount`, currency and collection source text), named guests and ages,
operation notes, special requirements and raw itinerary/tour/ship text. The
legacy fallback can contain equivalent financial and raw fields. Receipt rows
and receipt images are not part of this shared DTO.

These fields are broad and may contain financial, personal or internal data.
Phase 1C does not narrow them because doing so would silently remove existing
PWA detail. A native mobile client must not fetch this broad response and hide
fields locally. Phase 3A needs a server-side mobile projection that returns
only the fields allowed by the caller's effective permission policy while
reusing this read model's operation, reservation and PAX semantics.

## Provenance

`reservation.sourceType` / `sourceBookingReference` and `operation.sourceType`
are shown separately and labeled in the UI (Manual / Gmail / Outlook / Sheet
Import / Historical Migration) rather than as raw enum values. Internal
numeric import ids (`sourceEmailImportId`, `sourceSheetImportId`) are not
rendered at all — they exist in the schema for traceability, not for this
screen. No provenance field, index, or write behavior on `operations` or
`reservations` was touched.

## Audit / history

The `history.activity` list reuses the exact same `audit_logs` query shape
already used by the pre-existing `GET /api/operations/:id/activity`
endpoint (`metadata->>'entityType' = 'operation'`), embedded directly in the
`/detail` response so the frontend does not have to issue a second request.
This is operation-level history only. **Gap, explicitly not invented
around:** Reservation and BookingParty changes are not written to
`audit_logs` anywhere yet (Phase 1B's writers do not call
`createAuditLog` with `entityType: "reservation"` or `"booking_party"`), so
there is no reservation-level change history to show. The response marks
this honestly with `history.reservationHistoryAvailable: false` and the UI
renders "Rezervasyon / BookingParty değişiklik geçmişi henüz bağlantılı
değil" rather than fabricating or silently omitting it.

## Desktop / mobile / PWA

`OperationDomainWorkspace` is the same component, same data, same markup on
all three surfaces — there is no separate mobile implementation to drift
out of sync with the desktop one. Layout uses a single responsive grid
(`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) for field rows so it reflows
to one column on narrow viewports without horizontal scrolling, and the
denser detail (guest list, record timestamps, activity history) is behind
`<details>` disclosure elements so the field/guide views stay scannable on a
phone while the same information remains available on desktop.

## Accessibility

Sections carry `aria-label`s ("Operasyon ve rezervasyon çalışma alanı", one
per reservation card), the loading state uses `role="status"`, the error
state uses `role="alert"` with a retry button, disclosure `<summary>`
elements and the retry button have visible `focus-visible` outlines, and
every status is rendered as text (Turkish label) in addition to any color —
never color alone.

## Explicit non-goals (Phase 1C)

- Does not apply, generate, or modify any migration. Migrations `0022` and
  `0023` are untouched; no new migration file was added.
- Does not write to `reservations`, `booking_parties`, `guests`, or
  `operation_reservation_details` anywhere in the new code — `/detail` is
  `SELECT`-only.
- Does not change `sheet-import.ts`, `historical-migration-promote.ts`, the
  Gmail/Outlook communications writer, or `reservations.ts` — verified both
  by `git diff` (untouched) and by the focused test suite asserting none of
  them reference the new read model.
- Does not change duplicate-detection or operation-matching logic.
- Does not add a Reservation/BookingParty mutation API. Existing operation
  mutation routes (tasks, receipts, documents, assignments, status) are
  unchanged and remain the only way to edit anything on this screen.
- Does not redesign accounting, customers/CRM, or introduce multi-tenancy.
- Does not fabricate Guest rows under any circumstance.

## Remaining gaps for Phase 1D

- Reservation- and BookingParty-level audit trail: nothing writes
  `entityType: "reservation"` / `"booking_party"` audit rows today. Adding
  that (and then surfacing it here) is separate, scoped work.
- No Reservation/BookingParty edit UI exists. If Phase 1D wants inline
  editing, it needs a new mutation API — deliberately out of scope here to
  keep Phase 1C a trustworthy read surface first.
- `operation_status_history` (a real, already-existing table) is not
  consulted by this endpoint; the history section currently reuses the
  generic `audit_logs` feed instead. Worth revisiting once Reservation
  audit events exist, so both can be merged into one timeline.
- Legacy operations (zero Reservations) still have no path to actually gain
  a Reservation hierarchy short of a Phase 1D-scoped backfill — Phase 1C
  only makes their current legacy data visible, it does not migrate it.
