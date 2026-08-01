---
name: OCR receipt feature
description: How receipt OCR works end-to-end; key constraints and design decisions
---

## Endpoint
`POST /api/ai/ocr-receipt` (in `artifacts/api-server/src/routes/ai.ts`)

## Request
```json
{ "imageBase64": "<raw base64, no data URL prefix>", "mimeType": "image/jpeg" }
```
- Max raw image size: 5 MB (base64 ≈ 6.7 MB, within the 10 MB JSON body limit).
- Allowed MIME types: jpeg, png, gif, webp, heic, heif.
- Rate limit: 10 req/minute per Clerk userId (in-memory, resets on restart).

## Response
Zod-validated `OcrReceiptResult`:
- `amount`, `currency`, `supplierName`, `receiptDate`, `receiptTime`, `taxAmount`, `invoiceNumber`, `paymentMethod`, `expenseCategory`
- `confidence` object with 0–1 scores per field
- Fields with confidence < 0.7 are flagged "Kontrol Et" in the UI.

## Frontend flow (`operation-detail.tsx`)
1. User selects photo → `receiptPhoto` state set.
2. "Makbuzu Tara" button appears.
3. Click → `handleOcrScan()` → reads File as base64, posts to backend, fills empty form fields.
4. Fields already filled by user → stored in `ocrConflicts` with "Kabul Et" button.
5. Low-confidence fields → amber "Kontrol Et" badge on the label.
6. User edits, confirms, clicks "Kaydet" → normal receipt save flow.
7. OCR state cleared on dialog close, photo remove, or successful save.

## Client utility
`artifacts/tourops-ai/src/lib/ocr-service.ts` — exports `ocrReceiptImage(file, token)` and `OCR_LOW_CONFIDENCE_THRESHOLD = 0.7`.

**Why:** Backend-only AI keeps the API key off the client. Mock response when no key means dev works without billing.

**How to apply:** OCR_LOW_CONFIDENCE_THRESHOLD is the single constant that controls "Kontrol Et" visibility — adjust there to tune UX.
