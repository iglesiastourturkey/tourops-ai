-- Migration: outlook_connections table for the Microsoft Outlook OAuth connection
--
-- Mirrors google_connections (the Gmail/Drive connection table) column for
-- column, but stays a separate table rather than a generic multi-provider one.
-- Google and Microsoft token payloads, refresh semantics and revocation
-- endpoints are unrelated, and a shared table would need a provider-specific
-- branch on every read — a second table with the same shape is simpler and
-- keeps each provider's migration history independent.
--
-- This is the connection/credential layer only (Faz 2 "Outlook Integration"
-- roadmap item #4). It intentionally does not touch reservation_email_imports:
-- that table's connection_id currently references google_connections, and
-- widening it to accept either provider's id is a separate, larger decision
-- (documented as the still-undesigned "Reservation Ingestion Engine" /
-- integration_sync_state work in .claude/docs/integrations.md). Mail scanning
-- for Outlook is out of scope until that lands.
--
-- Additive and idempotent: a new table with IF NOT EXISTS is safe to re-apply
-- and touches no existing row.
--
-- NOT APPLIED. Run against the Neon staging branch first, confirm the Outlook
-- connect/disconnect flow works end to end, then apply to production.

CREATE TABLE IF NOT EXISTS outlook_connections (
  id                          serial PRIMARY KEY,
  profile_id                  integer NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider                    text NOT NULL DEFAULT 'outlook',
  outlook_account_email       text,
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

CREATE UNIQUE INDEX IF NOT EXISTS outlook_connections_profile_provider_idx
  ON outlook_connections (profile_id, provider);
