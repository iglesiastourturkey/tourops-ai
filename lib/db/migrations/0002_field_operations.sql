-- Migration: Field Operations (Sprint 6)
-- Adds operation_status_history, field_incidents, and operation_field_notes tables.
-- All idempotent (IF NOT EXISTS).

-- 1. Operation lifecycle status history
CREATE TABLE IF NOT EXISTS operation_status_history (
  id SERIAL PRIMARY KEY,
  operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_profile_id INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Field incidents / emergency events
CREATE TABLE IF NOT EXISTS field_incidents (
  id SERIAL PRIMARY KEY,
  operation_id INTEGER REFERENCES operations(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'other',
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reported_by_profile_id INTEGER,
  assigned_to_profile_id INTEGER,
  photo_object_path TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Field notes on operations (timeline, categorized)
CREATE TABLE IF NOT EXISTS operation_field_notes (
  id SERIAL PRIMARY KEY,
  operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  author_profile_id INTEGER,
  photo_object_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
