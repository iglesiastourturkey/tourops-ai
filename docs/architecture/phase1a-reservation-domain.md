# Phase 1A: Reservation Domain Foundation

Status: **additive schema only, not wired into any code path**. This document
describes what Phase 1A adds, why, and exactly what it deliberately does not
do yet.

## Purpose

The real Excel-discovered operating model treats a TourOperation (one TUR
block: one physical tour departure with a date, ship, pickup time, guide,
driver, vehicle) as something that can hold more than one independently
sourced booking — a VIATOR reservation, a GetYourGuide reservation, and a
direct booking can all belong to the same TourOperation. TourPilot's current
schema cannot represent this: `operations` has a strict 1:1 child,
`operation_reservation_details`, so today "one operation" and "one booking"
are forced to be the same thing.

Phase 1A introduces the tables needed to represent this correctly —
`reservations`, `booking_parties`, `guests` — without changing anything
about how TourPilot behaves today. It is the domain foundation a later,
separately-approved Phase 1B will build on to actually move reads and
writes onto the new model.

## Entities and cardinalities

```
operations (1) ──< reservations (many) ──1:1── booking_parties ──< guests (0..many)
```

- **operations** (unchanged): the TourOperation aggregate root — one
  physical tour departure.
- **reservations** (new): one row per independently-sourced booking under a
  TourOperation. Carries the lead guest name, reservation type, lifecycle
  status, an optional rebooking link, and reservation-level provenance.
- **booking_parties** (new): strict 1:1 with a reservation. Carries exactly
  the per-booking operational and financial metadata that
  `operation_reservation_details` carries today (passenger counts, service
  inclusions, external channel, imported financial metadata) — just
  re-parented to a reservation instead of an operation.
- **guests** (new): zero or more named travelers under a booking party. See
  the Guest Model Rule below — this is the one rule a naive Phase 1B import
  implementation is most likely to violate.

`operation_reservation_details` is untouched and remains the only table any
existing write path uses.

## The Guest Model Rule

The real source data (Sheet import, historical Excel, and largely
Gmail/Outlook too) reliably gives a lead guest name, an adult count, a
child count, and a total pax count. It does **not** reliably give a full
named-passenger manifest.

Guest rows are therefore optional enrichment, never fabricated. A
`booking_parties` row with `adultCount = 3`, `childCount = 1`, and only two
named guests on file ("Richard", "Lyne") is valid. There is no constraint —
CHECK, trigger, or application code — anywhere in Phase 1A requiring
`COUNT(guests)` to equal `adultCount + childCount`, and none should ever be
added later either: doing so would force every import pipeline to fabricate
placeholder guest rows the source data never supplied.

The authoritative pax number for capacity, roster, and Daily Operations
Center purposes is always `booking_parties.adultCount + booking_parties.
childCount` — never a count of guest rows. Expected Phase 1B display
semantics: "4 PAX · 2 named."

## Operation status vs. reservation status

These two status models are independent and Phase 1A keeps them that way
structurally: `operations.status` is untouched, and nothing in the new
schema, the new migration, or anywhere else references it. A reservation's
status (`new | confirmed | completed | canceled | rebooked | no_show`) never
propagates to or is derived from the operation it belongs to, and no
trigger or code path in Phase 1A could make it do so — that wiring doesn't
exist yet, and when it is built (Phase 1B or later) it must remain a
one-way read, never a write-through.

## Provenance: which source created what

Five provenance-shaped fields exist on `operations` today
(`sourceType`, `sourceEmailImportId`, `sourceSheetImportId`,
`sourceHistoricalKey`, `sourceBookingReference`). Phase 1A adds the same
five fields to `reservations`, unpopulated, so Phase 1B has somewhere to
write without a schema change blocking it:

| Field | Operations (unchanged) | Reservations (new, Phase 1A) |
|---|---|---|
| `sourceType` | Describes what created the *operation* | Present, unpopulated — Phase 1B decides its exact semantics |
| `sourceEmailImportId` | Soft reference (no enforced FK) | Soft reference, same lack of enforcement — mirrors the operation-level column exactly |
| `sourceSheetImportId` | Soft reference; backed by `operations_source_sheet_import_idx` (UNIQUE) | Soft reference; backed by a *new*, independent `reservations_source_sheet_import_idx` (UNIQUE) |
| `sourceHistoricalKey` | Backed by `operations_source_historical_key_idx` (UNIQUE) | Plain nullable column, indexed but **not** unique yet — see below |
| `sourceBookingReference` | Advisory only, via a normalized non-unique partial index | Advisory only, same pattern, independent index |

Two things are deliberately asymmetric and worth calling out:

1. **`sourceSheetImportId` gets a unique index now; `sourceHistoricalKey`
   does not.** The sheet-import index is safe to add immediately because
   `reservations` is empty — creating a `UNIQUE INDEX` on an empty table can
   never conflict with anything. Doing so does not touch, weaken, or
   duplicate the guarantee `operations_source_sheet_import_idx` provides
   today; that index is untouched and keeps enforcing "one operation per
   approved sheet-import row" exactly as it always has. The new index is
   inert until Phase 1B's rewritten sheet-import approval logic actually
   starts writing to `reservations` — at that point it will enforce "one
   reservation per approved sheet-import row," which is what makes the
   1:many model safe under re-approval, the same way the original index
   protects the 1:1 model today. `sourceHistoricalKey` gets no equivalent
   unique index in Phase 1A because relocating *that* guarantee is
   explicitly a Phase 1B decision, not assumed here.
2. **`sourceEmailImportId` and `sourceSheetImportId` are soft references on
   both tables** — no `.references()` / FK constraint, matching how
   `operations.sourceEmailImportId` and `operations.sourceSheetImportId`
   are declared today. This is not an oversight; it keeps the new columns
   at the same enforcement level as the columns they mirror rather than
   introducing an inconsistency between operation-level and
   reservation-level provenance.

## Financial firewall

`booking_parties.netAmount` / `advanceAmount` are imported financial
metadata only, exactly like `operation_reservation_details.netAmount` /
`advanceAmount` today: nothing in Phase 1A (there is no writer at all yet)
creates an `accounting_transactions` row from them, and no trigger does
either. When Phase 1B or later actually populates these fields, promoting
one to a real transaction must remain an explicit, separate, human-reviewed
action — never automatic.

One deliberate schema deviation: `booking_parties.netAmount` /
`advanceAmount` use `NUMERIC(12, 2)`, not `real`. Every existing money
column in this database (`accounting_transactions`, `operation_receipts`,
`operation_reservation_details`) uses `real`. This is a direct instruction
from the Phase 1A/1B architecture review to prefer a fixed-precision type
for any *new* amount column, applied narrowly to these two new columns
only — no existing `real` column anywhere is touched or migrated.

## Legacy-table compatibility

`operation_reservation_details` is not modified in any way — no columns
added, removed, or renamed; no index or constraint touched. It remains the
only table `sheet-import.ts`, `historical-migration-promote.ts`, and the
`create-draft` reservation route read or write. The Phase 1A focused test
suite (`scripts/reservation-domain-phase1a-focused-tests.mjs`) asserts this
directly against the real source files, not just by omission.

## What Phase 1A does NOT do

- Does not wire `sheet-import.ts`'s approval logic to the new tables.
- Does not wire `historical-migration-promote.ts`'s promotion logic to the
  new tables.
- Does not add a Gmail/Outlook write path for reservations (none exists
  today at all — Phase 1B's job).
- Does not change any UI screen. Operation Detail and the Daily Operations
  Center both stay exactly as they are.
- Does not relax, drop, or otherwise touch
  `operations_source_sheet_import_idx`, `operations_source_email_import_idx`,
  `operations_source_historical_key_idx`, or
  `operations_source_booking_reference_idx`.
- Does not introduce dual-write, a compatibility view, or any other
  cutover mechanism — there is nothing to cut over to yet.
- Does not apply the migration to any database. It is written, reviewed,
  and left unapplied pending explicit approval.
- Changes no runtime behavior whatsoever. Every existing test, route, and
  screen behaves identically before and after this change.

## What Phase 1B will need to do

Phase 1B is a separate, separately-approved piece of work. At minimum it
will need to: rewrite `sheet-import.ts`'s approval handler to match-or-create
against `reservations` instead of `operations`, in the same deploy that
relaxes `operations_source_sheet_import_idx` to a plain index (moving its
guarantee to the new `reservations_source_sheet_import_idx`, which Phase 1A
already created safely on an empty table); rewrite
`historical-migration-promote.ts`'s promotion logic the same way; add the
first-ever Gmail/Outlook reservation write path; decide `sourceType`'s and
`sourceHistoricalKey`'s final placement and enforcement; run a reviewed,
hash-verified backfill of existing `operation_reservation_details` rows
into the new tables; and build the two additive read screens (Operation
Detail's reservation roster, and the Daily Operations Center) that make any
of this visible to operations staff. None of that is authorized or begun
by Phase 1A.
