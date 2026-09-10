-- Phase 3H.2: durable operation domain. Additive and compatibility-safe.
-- Existing operations intentionally remain NULL; historical backfill is a
-- separately authorized operation and is not performed by this migration.
ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS operation_type text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'operations'
      AND column_name = 'operation_type'
      AND data_type <> 'text'
  ) THEN
    RAISE EXCEPTION 'operations.operation_type exists with incompatible type';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operations_operation_type_check'
      AND conrelid = 'operations'::regclass
  ) THEN
    ALTER TABLE operations
      ADD CONSTRAINT operations_operation_type_check
      CHECK (operation_type IS NULL OR operation_type IN ('CRUISE', 'SEJOUR'));
  END IF;
END $$;
