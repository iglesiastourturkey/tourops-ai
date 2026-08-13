-- Migration: index behind the M3 booking-reference duplicate check
--
-- create-draft now asks "does another operation already carry this booking
-- reference?" before building an operation from a reviewed reservation. The
-- comparison is case- and whitespace-insensitive, because the same reference
-- reaches us written differently by different agencies ("GYG-1234", "gyg-1234 "),
-- so a plain column index would not be used for it — the expression has to match
-- the query exactly.
--
-- Partial on purpose: operations without a booking reference (manual entries,
-- quote-sourced work) are never searched, and excluding them keeps the index to
-- the rows that can actually match.
--
-- Additive and idempotent: creating an index neither rewrites the table nor
-- changes any row, and IF NOT EXISTS makes re-application a no-op. No column,
-- constraint or type is touched, so nothing here can fail a running deployment.
--
-- CONCURRENTLY is deliberately not used: it cannot run inside a transaction
-- block, and the operations table is small enough that a plain CREATE INDEX
-- takes milliseconds. If this is ever applied to a much larger table, switch to
-- CREATE INDEX CONCURRENTLY and run it outside a transaction.
--
-- NOT APPLIED. Run against the Neon staging branch first, confirm create-draft
-- still returns its duplicate warning (create two operations sharing a booking
-- reference and check the second conversion warns), then apply to production.
--
-- The same index is declared in lib/db/src/schema/operations.ts. Both are
-- required: drizzle-kit push reads the schema file as the source of truth and
-- would drop an index that exists only in the database.

CREATE INDEX IF NOT EXISTS operations_source_booking_reference_idx
  ON operations (lower(trim(source_booking_reference)))
  WHERE source_booking_reference IS NOT NULL;
