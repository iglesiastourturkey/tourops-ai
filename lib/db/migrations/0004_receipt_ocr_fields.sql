-- Migration: structured OCR/verified fields on operation_receipts
-- OCR already extracts tax, receipt time, document number, payment method and
-- category, but only amount/currency/supplierName/receiptDate had columns —
-- the rest were being concatenated into the guideNote text field. This adds
-- real columns so they can be shown as distinct editable fields and carried
-- through to accounting_transactions (which already has matching columns).
ALTER TABLE operation_receipts
  ADD COLUMN IF NOT EXISTS tax_amount real,
  ADD COLUMN IF NOT EXISTS tax_rate real,
  ADD COLUMN IF NOT EXISTS document_number text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS receipt_time text,
  ADD COLUMN IF NOT EXISTS ocr_raw_result jsonb;
