---
name: Accounting Module
description: Sprint 3 + 3.1 accounting module — DB schema, routes, frontend pages, export services
---

## DB Schema Changes
- New `accounting_transactions` table (type, category, amount, currency, exchangeRate, amountTry, paymentStatus, accountingStatus, dates, FKs to customers/suppliers/tours/operations/receipts/profiles)
- New `accounting_documents` table (documentType, objectPath, reviewStatus, FKs)
- New `accounting_settings` table (defaultCurrency, fiscalYearStartMonth, defaultVatRate, vatRates JSON, paymentMethods JSON, documentNumberPrefix, accountantNotes)
- Added review columns to `operation_receipts`: reviewStatus, reviewNotes, reviewedByProfileId, reviewedAt
- Migration run via `pnpm --filter @workspace/db run push-force`
- After schema changes, MUST rebuild lib/db declarations: `cd lib/db && npx tsc -p tsconfig.json`

## Backend Routes
- `GET /api/accounting/dashboard` — expanded KPI stats: netCashFlow, pendingReceivables/Payables, overdue counts, vatApprovedTotal, missingInfoCount, overdueItems[]
- `GET/POST /api/accounting/transactions` — CRUD with server-side filtering
- `POST /api/accounting/transactions/:id/approve|reject|cancel|mark-missing|mark-paid`
- `GET /api/accounting/documents` — unified receipt + document queue
- `POST /api/accounting/documents/:id/review` — approve/reject/missing_information
- `POST /api/accounting/receipts/:id/review` — review operation_receipt
- `POST /api/accounting/receipts/:id/create-transaction` — duplicate check then create expense
- `GET /api/accounting/operations/:id` — full operation accounting file
- `GET/PUT /api/accounting/settings` — accounting settings CRUD
- `GET /api/accounting/receivables` — filtered income transactions pending/partial
- `GET /api/accounting/payables` — filtered expense transactions pending/partial
- `POST /api/accounting/export/pdf|excel|zip` — binary streaming responses

## Export Libraries
- pdfkit (PDF) — dynamic `await import("pdfkit")` to lazy-load
- exceljs (Excel) — dynamic import; use `import type ExcelJS from 'exceljs'` for types at top
- archiver (ZIP) — dynamic import; use `const archiverMod = await import("archiver") as any; const archiver = archiverMod.default ?? archiverMod`
- ZIP export contains: receipt images, manifest.json, **accounting-data.xlsx** (NOT CSV), missing-files.txt (if warnings)
- selectedIds in export body: `queryTransactions` filters by `inArray(id, selectedIds)` when provided

## Frontend Pages
- `/accounting` → `accounting.tsx` (dashboard: 2 rows of KPI cards, overdue section, upcoming due)
- `/accounting/transactions` → `accounting-transactions.tsx` (Alacaklar/Borçlar tabs, VAT fields, DropdownMenu actions, overdue highlights)
- `/accounting/documents` → `accounting-documents.tsx` (tabs: Makbuzlar / Belgeler, icon+text action buttons)
- `/accounting/reports` → `accounting-reports.tsx` (selectedIds export, contrast-fixed buttons)
- `/accounting/settings` → `accounting-settings.tsx` (NEW: GET/PUT settings page)
- `/accounting/operations/:id` → `accounting-operation.tsx`

## Key Patterns
- AppShell is NAMED export: `import { AppShell } from '@/components/AppShell'`
- useToast path: `@/hooks/use-toast` (NOT `@/components/ui/use-toast`)
- Export downloads use `useAuth` from `@clerk/react` to get Bearer token, then raw `fetch()`
- RBAC: admin/accounting/super_admin full access; operations read-only; guide blocked entirely
- Nav item "Muhasebe" added to AppShell for roles: super_admin, admin, accounting
- Nav item "Muhasebe Ayarları" added for roles: super_admin, admin, accounting
- Lucide icons: do NOT pass `title` prop — use `aria-label` only (title causes TS error)

**Why:** Accounting is a separate module mounted at /api/accounting and /api/accounting/export in routes/index.ts — export router must be registered BEFORE accounting router to avoid route conflicts.
