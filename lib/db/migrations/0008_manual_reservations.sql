-- Migration: manual reservations in the reservation inbox
--
-- Until now every row in reservation_email_imports came from a Gmail scan, so
-- connection_id and gmail_message_id were NOT NULL. M1 adds manual entry: an
-- operator types a reservation that never arrived as an email, so both columns
-- have to be droppable for those rows.
--
-- The (connection_id, gmail_message_id) unique index stays as-is. Postgres does
-- not treat NULLs as equal, so any number of manual rows coexist under it while
-- Gmail rows keep their one-row-per-message guarantee.
--
-- `source` makes the origin explicit instead of leaving it implied by
-- "connection_id IS NULL". The roadmap adds Outlook / Viator / GetYourGuide as
-- further sources, and a two-valued inference would not survive that.
--
-- Additive and idempotent. Dropping NOT NULL never rewrites the table and can be
-- re-applied safely; the new column is backfilled by its DEFAULT, so every
-- existing row keeps reading as 'gmail'.
--
-- NOT APPLIED. Run against the Neon staging branch first, verify the inbox still
-- lists and analyses Gmail rows, then apply to production.

ALTER TABLE reservation_email_imports
  ALTER COLUMN connection_id    DROP NOT NULL,
  ALTER COLUMN gmail_message_id DROP NOT NULL;

ALTER TABLE reservation_email_imports
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'gmail';
