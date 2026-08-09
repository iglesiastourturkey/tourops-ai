-- Migration: push_subscriptions (Web Push infrastructure)
--
-- One row per browser/device that granted notification permission. The server
-- reads these in lib/notifications.ts to deliver a Web Push message alongside
-- every in-app notification row.
--
-- user_id is the Clerk user id, matching notifications.user_id. It references
-- profiles.clerk_user_id (UNIQUE) with ON DELETE CASCADE so a removed profile
-- takes its subscriptions with it.
--
-- endpoint is UNIQUE: the push service issues exactly one endpoint per browser
-- subscription, so re-subscribing the same browser upserts instead of piling up
-- duplicate rows. Dead endpoints are deleted when the push service answers
-- 404/410.
--
-- Additive and idempotent — creates a new table only, touches nothing existing.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         serial PRIMARY KEY,
  user_id    text        NOT NULL REFERENCES profiles(clerk_user_id) ON DELETE CASCADE,
  endpoint   text        NOT NULL,
  keys       jsonb       NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint UNIQUE (endpoint)
);

-- Delivery always looks subscriptions up by recipient.
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON push_subscriptions (user_id);
