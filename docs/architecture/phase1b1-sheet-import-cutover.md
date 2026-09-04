# Phase 1B.1 — Sheet Import Cutover

## Write path

Before this cutover, approving a reviewed `sheet_reservation_imports` row
created or updated `operations`, then created or updated the legacy 1:1
`operation_reservation_details` row. `operations.source_sheet_import_id` was
the unique source-row key.

After this cutover, the same approval transaction creates or reuses:

`operations` → `reservations` → `booking_parties`

The importer still creates a new Operation by default. It reuses an Operation
only when the source row already has its explicit historical
`matched_operation_id`, or when its existing idempotent Reservation points to
one. It does not match, group, or attach rows by tour, date, guest, booking
reference, or other fuzzy/silent criteria.

No `guests` rows are written. PAX is the supplied `adult_count + child_count`;
blank source counts remain unknown rather than becoming zero. Booking
references remain advisory and non-unique.

## Idempotency and transaction boundary

`reservations.source_sheet_import_id` is the unique idempotency owner. The
approval transaction locks the source import row, looks up that Reservation,
then updates/reuses its Operation, Reservation, and one BookingParty. On a
first approval it inserts the three records. Any failure rolls back all three
(as well as the approval-state update and any customer creation in that
transaction), so no partial approved Operation remains.

`operations.source_sheet_import_id` remains populated as provenance/search
data but is not the identity owner after the cutover.

## Deployment order

1. Apply the already-approved Phase 1A migration `0022_reservation_domain_phase1a.sql` and verify `reservations_source_sheet_import_idx` is UNIQUE.
2. Deploy the Phase 1B.1 application writer and verify approved sheet rows produce an Operation, Reservation, and BookingParty.
3. Apply `0023_sheet_import_idempotency_cutover.sql`. Its database guard aborts unless the reservation-level UNIQUE index exists; it then relaxes the operation index to a plain index.

The code and migration in this repository are artifacts only; neither was
applied by this change.

## Rollback order

1. Quiesce or replace the Phase 1B.1 writer.
2. Verify no non-null duplicate exists in `operations.source_sheet_import_id`.
3. Replace the plain `operations_source_sheet_import_idx` with its UNIQUE form.
4. Only then redeploy the legacy writer. Keep
   `reservations_source_sheet_import_idx` UNIQUE throughout.

This order never leaves source-row idempotency unprotected.

## Non-goals

No database migration was run. This does not backfill or delete
`operation_reservation_details`, modify historical promotion, ingest Gmail or
Outlook, change UI, add operation auto-matching, create guests, or introduce
multi-tenancy work.
