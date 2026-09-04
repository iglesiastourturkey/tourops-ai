# Phase 1B.2 — Historical Promotion Cutover

## Write path

Before this cutover, the reviewed `historical:promote` CLI created an
`operations` row followed by a legacy `operation_reservation_details` row.

The new writer creates, in the same per-record transaction:

`operations` → `reservations` → `booking_parties`

It does not create `guests` or new `operation_reservation_details` rows. The
staging table remains the approval/control plane; only `approved` records
(and explicitly targeted `imported` replays) reach promotion.

## Idempotency and provenance

`operations.source_historical_key` remains the existing UNIQUE idempotency
guard. A Reservation also records that same authoritative source key as its
provenance. The key comes unchanged from the staged `source_key`, not a
workbook display name, worksheet label, or temporary semantic-analysis key.

On a replay, promotion locks the staged record and its existing operation,
reconstructs the projection from the Reservation and BookingParty, and either
returns an idempotent existing result or fails closed on content conflict.
For records promoted before Phase 1B.2, a read-only legacy-details comparison
preserves prior replay behavior; this cutover does not backfill them.

## Mapping and customer behavior

The staged `customer.fullName` is the required Reservation lead guest name.
Adult and child counts, language, tour type, itinerary, pickup point, source,
operator, and collection status move to Reservation/BookingParty fields.
PAX continues to mean `adultCount + childCount`; no Guest count is inferred.

Phase 3D-B customer linking is unchanged: initial promotion does not create
or match a customer, and the separately reviewed customer-link service remains
the only process that changes `operations.customer_id`.

## Transaction, cancellation, and rollback

Operation, Reservation, BookingParty, imported staging status, provenance hash,
and successful audit event are one transaction. A child-write or audit failure
rolls back the operation and leaves the staging record retryable. The existing
historical status treatment is retained: promoted operations are `draft` and
reservations are `new`; the staging payload has no separate cancellation field,
so no cancellation inference or dropping is introduced.

Rollback is a code rollback only: stop the Phase 1B.2 writer before restoring
the legacy writer. No schema migration was needed or created. Existing
Phase-1B.2-created hierarchy rows are not converted or deleted by rollback.

## Non-goals

No migration was applied, no staging/production database was written, and no
parser, UI, Gmail/Outlook, duplicate-analysis, source Excel, auto-deduplication,
supplementary-row consolidation, customer-resolution, or legacy-reader behavior
was changed.
