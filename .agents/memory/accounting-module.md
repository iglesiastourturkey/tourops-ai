---
name: Accounting Module
description: Sprint 3 accounting module — DB schema, routes, frontend pages, export services
---

## DB Schema Changes
- New `accounting_transactions` table (type, category, amount, currency, exchangeRate, amountTry, paymentStatus, accountingStatus, dates, FKs to customers/suppliers/tours/operations/receipts/profiles)
- New `accounting_documents` table (documentType, objectPath, reviewStatus, FKs)
- Added review columns to `operation_receipts`: reviewStatus, reviewNotes, reviewedByProfileId, reviewedAt
- Migration run via `pnpm --filter @workspace/db run push-force`

## Backend Routes
- `GET /api/accounting/dashboard` — KPI stats, monthly chart, category breakdown
- `GET/POST /api/accounting/transactions` — CRUD with server-side filtering
- `POST /api/accounting/transactions/:id/approve|reject|cancel`
- `GET /api/accounting/documents` — unified receipt + document queue
- `POST /api/accounting/documents/:id/review` — approve/reject/missing_information
- `POST /api/accounting/receipts/:id/review` — review operation_receipt
- `POST /api/accounting/receipts/:id/create-transaction` — duplicate check then create expense
- `GET /api/accounting/operations/:id` — full operation accounting file
- `POST /api/accounting/export/pdf|excel|zip` — binary streaming responses

## Export Libraries
- pdfkit (PDF) — dynamic `await import("pdfkit")` to lazy-load
- exceljs (Excel) — dynamic import; use `import type ExcelJS from 'exceljs'` for types at top
- archiver (ZIP) — dynamic import; use `const archiverMod = await import("archiver") as any; const archiver = archiverMod.default ?? archiverMod`

## Frontend Pages
- `/accounting` → `accounting.tsx` (dashboard + monthly chart)
- `/accounting/transactions` → `accounting-transactions.tsx`
- `/accounting/documents` → `accounting-documents.tsx` (tabs: Makbuzlar / Belgeler)
- `/accounting/reports` → `accounting-reports.tsx` (filters + PDF/Excel/ZIP download)
- `/accounting/operations/:id` → `accounting-operation.tsx`

## Key Patterns
- AppShell is NAMED export: `import { AppShell } from '@/components/AppShell'`
- useToast path: `@/hooks/use-toast` (NOT `@/components/ui/use-toast`)
- Export downloads use `useAuth` from `@clerk/react` to get Bearer token, then raw `fetch()`
- RBAC: admin/accounting/super_admin full access; operations read-only; guide blocked entirely
- Nav item "Muhasebe" added to AppShell for roles: super_admin, admin, accounting

**Why:** Accounting is a separate module mounted at /api/accounting and /api/accounting/export in routes/index.ts — export router must be registered BEFORE accounting router to avoid route conflicts.
