-- Migration: Outlook / Microsoft Graph reservation source
--
-- Mirrors google_connections exactly, for the same reason: one row per
-- (profile, provider), refresh/access tokens stored encrypted (same
-- credential-encryption.ts helper, provider-agnostic), granted scopes tracked
-- as JSON so future Microsoft 365 services (e.g. Teams) can extend the same
-- row shape without a new table. `provider` defaults to 'outlook' and is kept
-- even though only one value is used today, for parity with google_connections'
-- multi-provider design.
--
-- reservation_email_imports gets additive, nullable columns only — the
-- existing Gmail columns (connection_id, gmail_message_id, gmail_thread_id)
-- are untouched. `source` already accepts free text ('gmail' | 'manual' as of
-- 0008_manual_reservations.sql); 'outlook' is a new value written by
-- application code, not a schema change.
--
-- The partial unique index on (microsoft_connection_id, outlook_message_id)
-- mirrors reservation_import_connection_message_idx: Postgres does not treat
-- NULLs as equal, so Gmail and manual rows (where microsoft_connection_id is
-- NULL) are unaffected, while Outlook rows get the same one-row-per-message
-- dedupe guarantee enforced via ON CONFLICT DO NOTHING at insert time.
--
-- Additive and idempotent throughout: new table, new nullable columns, new
-- index. Nothing here rewrites or locks an existing table for more than the
-- brief duration of adding a nullable column, and IF NOT EXISTS / re-runnable
-- guards make re-application a no-op.
--
-- NOT APPLIED. Run against the Neon staging branch first, verify the existing
-- Gmail connect / scan / disconnect flow in Settings still works unchanged,
-- then apply to production.
--
-- The same table and columns are declared in lib/db/src/schema/microsoft.ts
-- and lib/db/src/schema/gmail.ts. Both are required: drizzle-kit push reads
-- the schema files as the source of truth and would drop anything that exists
-- only in the database.

CREATE TABLE IF NOT EXISTS microsoft_connections (
  id                          serial PRIMARY KEY,
  profile_id                  integer NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider                    text NOT NULL DEFAULT 'outlook',
  microsoft_account_email     text,
  access_token_encrypted      text,
  refresh_token_encrypted     text,
  token_expires_at            timestamptz,
  granted_scopes              jsonb NOT NULL DEFAULT '[]',
  last_successful_access_at   timestamptz,
  status                      text NOT NULL DEFAULT 'connected',
  last_error                  text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_connections_profile_provider_idx
  ON microsoft_connections (profile_id, provider);

ALTER TABLE reservation_email_imports
  ADD COLUMN IF NOT EXISTS microsoft_connection_id integer REFERENCES microsoft_connections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS outlook_message_id text,
  ADD COLUMN IF NOT EXISTS outlook_conversation_id text;

CREATE UNIQUE INDEX IF NOT EXISTS reservation_import_microsoft_message_idx
  ON reservation_email_imports (microsoft_connection_id, outlook_message_id)
  WHERE microsoft_connection_id IS NOT NULL;
