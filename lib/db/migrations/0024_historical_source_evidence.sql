-- Migration 0024: Phase 3E.1 immutable historical source-evidence snapshots.
--
-- ADDITIVE ONLY. Creating this table does not change historical staging
-- payloads/statuses and does not write operations, reservations, booking
-- parties, customers, or guests. Apply first to the dedicated historical
-- staging branch only after the evidence-loader plan has been reviewed.

CREATE TABLE IF NOT EXISTS historical_source_evidence (
  id SERIAL PRIMARY KEY,
  historical_import_id INTEGER NOT NULL REFERENCES historical_operation_imports(id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  workbook_path TEXT NOT NULL,
  workbook_sha256 TEXT NOT NULL,
  worksheet_name TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  header_row INTEGER NOT NULL,
  cells JSONB NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT historical_source_evidence_workbook_sha_check
    CHECK (workbook_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT historical_source_evidence_sha_check
    CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT historical_source_evidence_source_row_check CHECK (source_row > 0),
  CONSTRAINT historical_source_evidence_header_row_check CHECK (header_row > 0 AND header_row < source_row)
);

CREATE UNIQUE INDEX IF NOT EXISTS historical_source_evidence_import_idx
  ON historical_source_evidence (historical_import_id);

CREATE UNIQUE INDEX IF NOT EXISTS historical_source_evidence_source_key_idx
  ON historical_source_evidence (source_key);

-- No UPDATE/DELETE path is introduced in Phase 3E.1. Conflicting snapshots
-- fail closed in the loader instead of overwriting original evidence.
