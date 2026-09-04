# Phase 1B.3 — Gmail/Outlook Reservation Cutover

## Approval boundary and old paths

Gmail scanning creates a `reservation_email_imports` row with its Gmail
message/thread identity. Outlook scanning creates the same kind of row with
its Outlook message/conversation identity. Both flow through the shared
`POST /reservations/:id/create-draft` endpoint.

Before this cutover, only explicitly reviewed `approvedData` could create a
draft `operations` row. The structured passenger, language, pickup, agency,
amount, and currency values were largely discarded after approval.

AI extraction remains a suggestion. The shared writer continues to reject
attempts without `approvedData`, invalid approved data, required review fields,
a lead guest name, or a tour date. Neither mailbox scanner writes business
records itself.

## New write path and mapping

The approved shared writer now creates one hierarchy in one transaction:

`operations` → `reservations` → `booking_parties`

Operation status remains `draft`. Reservation status is deliberately `new`;
it is independent of the operational draft state and is not derived from it.
The approved customer name becomes `lead_guest_name`; if absent, the writer
fails closed. Existing email-then-phone customer resolution and creation are
unchanged, now within that transaction.

The Reservation records customer, source channel, the import ID,
booking-reference provenance, and lead identity. BookingParty records Adult,
CHD, guide language, pickup location, agency, special requests, amount,
currency, and itinerary/tour name where the Phase 1A schema supports them.
Operation records approved pickup time. No Guest rows are created; PAX remains
the stated adult count plus child count.

## Idempotency, duplicates, and provider provenance

The persisted `reservation_email_imports.id` is the approval-action identity.
The existing UNIQUE `operations.source_email_import_id` remains the durable
retry guard; the handler locks the import row and reuses the linked complete
hierarchy on a retry. No customer/date/name heuristic is used.

Gmail and Outlook remain distinct providers. Their authoritative message and
thread/conversation IDs stay on the linked import record, while audit metadata
includes the applicable provider identity. Reservation provenance stores the
same import ID, not a subject line or display name.

Booking-reference duplicates are still case/whitespace-normalized advisory
warnings. The search considers both legacy Operation references and new
Reservation references, but requires human acknowledgement and never rejects,
merges, or auto-attaches records solely because of a matching reference.

## Transaction and rollback

Customer resolution/creation, Operation, Reservation, BookingParty, and the
import's `draft_created` link are atomic. A child failure leaves no partial
Operation or successful import status. The success audit preserves its existing
event and adds operation, reservation, booking-party, and provider metadata.

Rollback is code-only: deploy the prior writer before accepting further
approvals. No schema or migration artifact was needed, and existing records
are not backfilled or deleted.

## Non-goals

This does not modify Gmail/Outlook scanning, UI, historical or sheet imports,
duplicate-analysis design, provider identity rules, operation auto-matching,
or the legacy `operation_reservation_details` table. No migration was applied.
