-- Migration 0016: sheet_reservation_imports
-- Faz 4: GEMI Master Operasyon (Google Sheets) -> TourPilot review queue.
-- One-way, review-gated staging table. A row here NEVER writes to
-- operations/customers automatically - only the manual /approve action does.
-- Run this by hand in Neon's SQL Editor (per project convention, Claude never
-- runs DDL directly).

CREATE TABLE IF NOT EXISTS sheet_reservation_imports (
  id SERIAL PRIMARY KEY,

  -- Where the edit came from
  sheet_file_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  row_number INTEGER NOT NULL,

  -- Full raw row as captured by Apps Script at edit time: {"Tarih": "...",
  -- "Musteri Adi": "...", "Gemi": "...", ...} - column header -> cell value,
  -- exactly as typed in the sheet. This is the source of truth; no column is
  -- guessed/mapped at ingest time, so it always reflects exactly what staff
  -- typed, even for tabs/headers we don't otherwise recognize.
  row_data JSONB NOT NULL,

  -- Attribution: who edited the sheet, and when (from Apps Script's
  -- Session.getActiveUser() + the edit event timestamp).
  edited_by_email TEXT NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL,

  -- Review state. TourPilot's own review-queue state (distinct from any
  -- status column the human staff may type into the sheet itself).
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected

  matched_operation_id INTEGER REFERENCES operations(id) ON DELETE SET NULL,
  matched_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,

  approved_at TIMESTAMPTZ,
  approved_by INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejected_by INTEGER REFERENCES profiles(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One staging row per sheet cell-range; re-edits UPSERT onto the same row
-- instead of piling up duplicates, and reopen it for review if it had
-- already been approved/rejected (mirrors external_port_call_observations).
CREATE UNIQUE INDEX IF NOT EXISTS sheet_reservation_imports_row_idx
  ON sheet_reservation_imports (sheet_file_id, sheet_name, row_number);

CREATE INDEX IF NOT EXISTS sheet_reservation_imports_status_idx
  ON sheet_reservation_imports (status);

-- Provenance column on operations, mirroring the existing
-- source_email_import_id pattern used by the Gmail/Outlook intake. Plain
-- integer, no FK constraint - same convention as source_email_import_id.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS source_sheet_import_id INTEGER;
