-- Migration: reliable offline sync
-- Integer operation versions avoid timestamp precision loss in JavaScript CAS.
ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  operation_id INTEGER,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);