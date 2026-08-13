# TourPilot

**Travel agency operations management — from customer inquiry to accounting close.**

> **Version 1.0.0** — Production release

TourPilot is a full-stack web application built for Turkish travel agencies. It consolidates the end-to-end operation lifecycle — CRM, tour planning, guide management, document handling, accounting, and AI-assisted review — into a single, role-aware platform. Every module reflects a real agency workflow, and every role sees only the data relevant to their job.

<p align="center">
  <img src="docs/screenshots/logo.png" alt="TourPilot" width="120" />
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white&style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white&style=flat-square" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white&style=flat-square" />
  <img alt="Express" src="https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white&style=flat-square" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white&style=flat-square" />
  <img alt="Drizzle ORM" src="https://img.shields.io/badge/Drizzle_ORM-latest-C5F74F?logo=drizzle&logoColor=black&style=flat-square" />
  <img alt="Clerk" src="https://img.shields.io/badge/Clerk-Auth-6C47FF?logo=clerk&logoColor=white&style=flat-square" />
  <img alt="OpenRouter" src="https://img.shields.io/badge/OpenRouter-AI-412991?style=flat-square" />
  <img alt="TailwindCSS" src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white&style=flat-square" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white&style=flat-square" />
  <img alt="AI" src="https://img.shields.io/badge/AI-Accounting_Assistant-F97316?style=flat-square" />
  <img alt="OCR" src="https://img.shields.io/badge/OCR-Receipt_Reader-10B981?style=flat-square" />
</p>

---

## Overview

TourPilot is a role-based management platform designed around the operational reality of travel agencies. Agencies typically operate across three or four distinct teams — sales and operations, field guides, accounting, and management — each with different responsibilities and different information needs. Generic tools force these teams to share the same views and manually coordinate across spreadsheets, email threads, and separate accounting software.

TourPilot replaces that fragmentation. The platform models the full agency workflow: a customer inquiry becomes a quotation, a quotation becomes a tour, a tour generates an operation with guide assignments, that operation produces receipts, and those receipts flow into an accounting module that supports approval workflows, bulk exports, and AI-assisted review. Each team member signs in once and lands on a view scoped precisely to their role.

**Problems TourPilot addresses for travel agencies:**

- Fragmented tracking of customers, suppliers, and tours across disconnected tools
- Manual, error-prone quotation and pricing workflows
- No central view of guide assignments, saha (field) receipts, and operation status
- Accounting teams working from PDFs and email attachments with no structured approval workflow
- No way to query historical financial data or get aggregated operational summaries without manual spreadsheet work
- Sensitive business data exposed to every employee regardless of role

---

## Key Features

### 🏢 CRM

- **Customer management** — full customer records with contact details, linked quotations, and operation history; soft-archive without data loss
- **Supplier management** — supplier directory with service categorization, linked to tour costs and operation expenses; archive support

### 💼 Sales

- **Quotation management** — create, update, and track quotations against customers; status lifecycle (draft → sent → accepted → rejected → archived)
- **Tour catalogue** — reusable tour definitions with pricing; link tours to quotations and operations
- **Pricing and cost tracking** — per-operation cost line items linked to suppliers

### 🗺️ Operations

- **Operation lifecycle** — create and track operations from planning through completion
- **Guide and driver assignment** — assign guides and drivers to operations with emergency contact tracking
- **Task tracking** — internal task notes and checklists attached to operations
- **Notifications** — in-app notification system for operation events, assignments, and status changes

### 📊 Accounting

- **Income and expense transactions** — manual transaction entry with categorization, linked to customers and suppliers
- **Receipt management** — structured receipt log with amount, date, and document attachments
- **Document approval workflow** — review queue with approve / reject / needs-info states, reviewer comments, and audit timestamps
- **OCR document reading** — AI-powered extraction of amount, date, and vendor from receipt images, reducing manual data entry
- **PDF export** — formatted financial reports, quotation PDFs, and operation summaries
- **Excel export** — structured spreadsheet exports for accounting reconciliation
- **ZIP export** — bulk document archives for record-keeping

### 🤖 AI

- **AI Accounting Assistant** — aggregates income, expenses, outstanding receivables, and operation profitability into a structured summary with warnings and recommendations; powered by OpenRouter (GPT-4o-mini default)
- **AI operational summaries** — context-aware narration of operation status and financial position
- **OCR receipt workflow** — image-based receipt parsing via vision model; returns structured JSON (amount, date, vendor, currency) with in-memory rate limiting

### 🔐 Administration

- **Role-based access control (RBAC)** — five roles with distinct permissions enforced at both API and UI layers
- **User management** — invite users by email; pre-creates profile stubs claimed on first sign-in
- **Agency settings** — configurable agency name, address, contact details used across all PDF and report outputs

---

## Screenshots

> Screenshots will be added to `docs/screenshots/` as the product reaches stable milestones.

| Screen | Path |
|--------|------|
| Landing page | `docs/screenshots/landing.png` |
| Dashboard | `docs/screenshots/dashboard.png` |
| Operations | `docs/screenshots/operations.png` |
| Accounting overview | `docs/screenshots/accounting.png` |
| User management | `docs/screenshots/users.png` |
| AI Accounting Assistant | `docs/screenshots/ai-assistant.png` |
| Document review centre | `docs/screenshots/documents.png` |
| Reports and exports | `docs/screenshots/reports.png` |

---

## Product Workflow

The diagram below shows the end-to-end journey of a typical agency engagement, from initial customer contact through to financial reporting.

```mermaid
flowchart TD
    A([👤 Customer]) --> B[Quotation\nDraft → Sent → Accepted]
    B --> C[Tour\nPlan and pricing]
    C --> D[Operation\nScheduled → Active → Completed]
    D --> E[Guide Assignment\nField tasks and emergency contacts]
    E --> F[Receipts\nMobile upload + OCR extraction]
    F --> G[Accounting\nTransaction log and document review]
    G --> H[AI Review\nAggregated summary, warnings, recommendations]
    H --> I([📄 Reports\nPDF / Excel / ZIP exports])
```

---

## Architecture

```mermaid
graph TD
    Browser["🌐 Browser\n(React + Vite)"]
    Clerk["🔐 Clerk\n(Authentication)"]
    API["⚙️ Express 5 API\n(Node.js)"]
    RBAC["🛡️ RBAC Middleware\n(Role enforcement)"]
    ORM["🗄️ Drizzle ORM"]
    DB[("🐘 PostgreSQL")]
    Storage["📦 Object Storage\n(Private documents)"]
    OR["🤖 OpenRouter\n(AI proxy)"]
    AI["🧠 AI Models\n(GPT-4o-mini default)"]

    Browser -->|"Bearer token (Clerk JWT)"| API
    Browser <-->|"Session management"| Clerk
    API --> RBAC
    RBAC --> ORM
    ORM --> DB
    API --> Storage
    API -->|"Aggregated data only\n(no raw documents)"| OR
    OR --> AI
```

**Key design decisions:**

- The frontend and API are separate artifacts in a pnpm monorepo, sharing typed client code generated from an OpenAPI specification.
- All API routes require a valid Clerk JWT. Role checks are applied at the route level via composable `requireRole` middleware.
- AI calls receive only aggregated numerical summaries — never raw document files, customer PII, or binary uploads.
- Object storage is private-by-default; files are served through a proxy endpoint that re-validates the caller's session before streaming.

---

## AI Features

### AI Accounting Assistant

The accounting dashboard includes an AI assistant that generates a structured financial summary for a selected date range. Before any AI call is made, the server independently computes approximately 20 deterministic aggregates across eight database tables — total income, total expenses, outstanding receivables, largest suppliers, operation profitability, receipt approval backlog, and more. Only these computed numbers are sent to the model.

The model returns a structured JSON payload validated with Zod:

```typescript
{
  summary: string;          // Narrative overview
  warnings: Warning[];      // Items requiring attention, with severity level
  recommendations: string[]; // Actionable suggestions
  generatedAt: string;      // ISO 8601 timestamp
  dataPeriod: string;       // Human-readable description of the date range
}
```

Results are cached in memory for ten minutes keyed by `role:from:to`. A `?refresh=true` query parameter bypasses the cache when a fresh analysis is needed.

### OCR Receipt Workflow

The OCR endpoint accepts a receipt image encoded as base64 JSON. The image is passed to a vision-capable model with a structured extraction prompt; the response is parsed into a validated receipt record (amount, currency, date, vendor name, description). This reduces manual data entry for field staff uploading physical receipts.

Per-user in-memory rate limiting prevents abuse. The endpoint is accessible to all authenticated roles.

### Deterministic Fallback

All AI endpoints implement a non-AI fallback. When `OPENROUTER_API_KEY` is not configured, or when an AI call fails after a 30-second timeout, the server returns a deterministically computed response built entirely from database aggregates. The application remains fully functional without any AI credentials configured.

### Privacy Model

> **Raw document files are never sent to AI models.**

The AI accounting assistant receives only aggregated numeric summaries. The OCR endpoint processes images you explicitly submit for extraction — no documents are sent automatically. No customer names, personal details, or full transaction records are included in AI payloads.

---

## Security

### Authentication

All routes — including file proxy endpoints — require a valid Clerk session token. The frontend obtains a short-lived JWT from Clerk and attaches it as a Bearer token to every API request. Token verification on the server uses the `@clerk/express` SDK.

### Role-Based Access Control

Five roles define what each user can see and do. Role checks are enforced in Express middleware (`requireRole`, `requireAnyRole`) on every protected route. The UI mirrors these restrictions: navigation items, page sections, and action buttons are conditionally rendered based on the authenticated user's role.

Super admin is a universal-pass role that bypasses all role checks and has exclusive access to user management.

### Protected APIs

Every API endpoint that reads or writes data requires authentication. Unauthenticated requests receive `401 Unauthorized`. Requests from authenticated users attempting to access routes outside their role receive `403 Forbidden`. There are no publicly writable endpoints.

### Private Document Storage

Uploaded receipts and accounting documents are stored in a private object storage bucket. Files are never served via a public URL. All download requests pass through a server-side proxy endpoint that re-validates the caller's Clerk session and role before streaming the file.

### Role Isolation

- **Guides** see only the operations they are assigned to. They cannot access customer records, financial data, or other users' assignments.
- **Accounting** users access financial data and document review but cannot manage users or modify operational settings.
- **Operations** users manage the full customer-to-operation workflow but have no access to accounting internals.
- **Admin** users have access to all functional modules but cannot manage users (super admin only).

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend framework** | React 18 + TypeScript | Client-side SPA |
| **Frontend router** | Wouter | Lightweight client-side routing |
| **Build tool** | Vite 6 | Path-based base URL support |
| **UI components** | shadcn/ui + Radix UI | Accessible, unstyled primitives |
| **Styling** | Tailwind CSS 4 | Utility-first; dark sidebar theme |
| **Charts** | Recharts | KPI charts on dashboard and accounting |
| **Animations** | Framer Motion | Reduced-motion safe |
| **Forms** | React Hook Form + Zod | Schema-validated forms throughout |
| **Data fetching** | TanStack React Query | Auto-generated hooks from OpenAPI spec |
| **API client** | Orval (OpenAPI codegen) | Type-safe client generated from `openapi.yaml` |
| **Backend framework** | Express 5 + TypeScript | REST API |
| **Runtime** | Node.js 22 | |
| **ORM** | Drizzle ORM | Type-safe queries; schema-as-code |
| **Database** | PostgreSQL 16 | Replit managed or self-hosted |
| **Authentication** | Clerk (`@clerk/express`, `@clerk/react`) | JWT + session management |
| **AI / LLM** | OpenRouter | Proxy to GPT-4o-mini (configurable) |
| **PDF generation** | pdfmake (frontend) + pdfkit (backend) | Quotation, operation, and report PDFs |
| **Excel export** | ExcelJS | Structured accounting spreadsheet exports |
| **Archive export** | archiver | ZIP bundles of accounting documents |
| **Object storage** | `@google-cloud/storage` | Private document storage |
| **Logging** | pino + pino-http | Structured JSON logging |
| **Monorepo** | pnpm workspaces | Shared libs: `api-spec`, `api-client-react`, `api-zod`, `db` |

---

## Repository Structure

```
tourpilot/
├── artifacts/
│   ├── tourops-ai/                 # React + Vite frontend
│   │   ├── public/
│   │   │   ├── logo.svg            # TourPilot compass mark
│   │   │   └── favicon.svg
│   │   ├── src/
│   │   │   ├── App.tsx             # Router, auth gates, route definitions
│   │   │   ├── main.tsx
│   │   │   ├── components/
│   │   │   │   ├── AppShell.tsx    # Authenticated layout (sidebar + header)
│   │   │   │   ├── ErrorBoundary.tsx
│   │   │   │   └── ui/             # shadcn/ui component library
│   │   │   ├── contexts/
│   │   │   │   └── ProfileContext.tsx  # Role and profile state
│   │   │   ├── hooks/              # Custom React hooks
│   │   │   ├── lib/
│   │   │   │   ├── pdf-export.ts
│   │   │   │   ├── operation-pdf-export.ts
│   │   │   │   ├── ocr-service.ts
│   │   │   │   └── storage-service.ts
│   │   │   └── pages/
│   │   │       ├── landing.tsx
│   │   │       ├── dashboard.tsx
│   │   │       ├── customers.tsx / customer-detail.tsx
│   │   │       ├── suppliers.tsx / supplier-detail.tsx
│   │   │       ├── tours.tsx / tour-detail.tsx / tour-new.tsx
│   │   │       ├── quotations.tsx / quotation-detail.tsx / quotation-new.tsx
│   │   │       ├── operations.tsx / operation-detail.tsx
│   │   │       ├── accounting.tsx
│   │   │       ├── accounting-transactions.tsx
│   │   │       ├── accounting-documents.tsx
│   │   │       ├── accounting-document-detail.tsx
│   │   │       ├── accounting-operation.tsx
│   │   │       ├── accounting-reports.tsx
│   │   │       ├── accounting-export.ts
│   │   │       ├── accounting-settings.tsx
│   │   │       ├── notifications.tsx
│   │   │       ├── settings.tsx
│   │   │       ├── users.tsx
│   │   │       └── new-request.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   │
│   └── api-server/                 # Express 5 backend
│       └── src/
│           ├── app.ts              # Express app, middleware, route mounting
│           ├── index.ts            # HTTP server entry point
│           ├── seed.ts             # Database seeding
│           ├── lib/                # Shared server utilities
│           ├── middlewares/        # Auth, RBAC, request parsing
│           └── routes/
│               ├── accounting.ts   # Transactions, documents, exports, AI summary
│               ├── ai.ts           # OCR, email generation, AI assist
│               ├── customers.ts
│               ├── suppliers.ts
│               ├── tours.ts
│               ├── quotations.ts
│               ├── operations.ts
│               ├── notifications.ts
│               ├── profiles.ts
│               ├── users.ts        # Invite flow, user management
│               ├── settings.ts     # Agency settings
│               ├── storage.ts      # Private file proxy
│               └── health.ts
│
├── lib/
│   ├── api-spec/
│   │   └── openapi.yaml            # Single source of truth for the API contract
│   ├── api-client-react/           # Auto-generated React Query hooks (Orval)
│   ├── api-zod/                    # Auto-generated Zod schemas (Orval)
│   └── db/                         # Drizzle schema definitions and migrations
│
├── .env.example                    # Environment variable reference
├── pnpm-workspace.yaml
└── README.md
```

---

## Installation

### Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL 16 (or a managed instance)
- A [Clerk](https://clerk.com) application (for authentication)
- An [OpenRouter](https://openrouter.ai) API key (optional — AI features degrade gracefully without it)

### 1. Clone the repository

```bash
git clone https://github.com/your-org/tourpilot.git
cd tourpilot
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

See the [Environment Variables](#environment-variables) section below for a description of each variable.

### 4. Set up the database

Push the Drizzle schema to your PostgreSQL instance:

```bash
pnpm --filter @workspace/db run push
```

Optionally seed initial data (agency settings, demo records):

```bash
pnpm --filter @workspace/api-server run seed
```

### 5. Start the development servers

Run both the frontend and API server concurrently:

```bash
# API server (default port 8080)
pnpm --filter @workspace/api-server run dev

# Frontend (default port 5173)
pnpm --filter @workspace/tourops-ai run dev
```

On Replit, the configured workflows start both services automatically.

### 6. Production build

```bash
pnpm --filter @workspace/tourops-ai run build
pnpm --filter @workspace/api-server run build
```

Built output is written to `artifacts/tourops-ai/dist/` and `artifacts/api-server/dist/` respectively.

---

## Environment Variables

Copy `.env.example` to `.env` for local development. On Replit, all variables are managed via the Secrets pane — do not commit a populated `.env` file.

```env
# ── Database ──────────────────────────────────────────────────────────────────
# PostgreSQL connection string.
DATABASE_URL=postgresql://user:password@localhost:5432/tourpilot

# ── Clerk Authentication ──────────────────────────────────────────────────────
# Backend secret key — never expose this to the browser.
CLERK_SECRET_KEY=sk_test_...

# Publishable key used by the API server.
CLERK_PUBLISHABLE_KEY=pk_test_...

# Publishable key exposed to the Vite frontend (VITE_ prefix required).
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# ── Session ───────────────────────────────────────────────────────────────────
# Any long random string. Generate with: openssl rand -base64 32
SESSION_SECRET=replace-with-a-long-random-string

# ── AI (optional) ─────────────────────────────────────────────────────────────
# When absent, all AI endpoints return deterministic mock responses.
OPENROUTER_API_KEY=sk-or-...

# Override the default model for general AI features (default: openai/gpt-4o-mini).
# Accepts a comma-separated fallback chain: the models are tried in order, and
# the next one runs when the previous times out, returns 4xx/5xx, or answers
# with JSON that does not match the expected schema. A single value (no comma)
# behaves exactly as before.
AI_MODEL=nvidia/nemotron-nano-9b-v2:free,openai/gpt-oss-20b:free

# Override the model used specifically for the AI Accounting Assistant.
# Also accepts a comma-separated chain; falls back to AI_MODEL when unset.
AI_ACCOUNTING_MODEL=openai/gpt-4o-mini

# Ceiling for one fallback chain, in milliseconds (default: 75000). Each model
# gets its own 30s attempt; later attempts are clamped to what is left of this
# budget, and models that can no longer finish are reported as skipped.
AI_TOTAL_TIMEOUT_MS=75000

# ── Object Storage ────────────────────────────────────────────────────────────
# Bucket ID for private document storage.
DEFAULT_OBJECT_STORAGE_BUCKET_ID=your-bucket-id

# Directory prefix for private (access-controlled) files.
PRIVATE_OBJECT_DIR=private/

# Comma-separated path prefixes that are publicly readable.
PUBLIC_OBJECT_SEARCH_PATHS=public/

# ── Server (optional) ─────────────────────────────────────────────────────────
# Injected automatically on Replit. Set manually for local/Docker deployments.
PORT=8080
BASE_PATH=/
```

---

## User Roles

TourPilot enforces five roles. Role assignment is managed by super admin users through the User Management page.

| Role | Description | Key Permissions |
|------|-------------|----------------|
| **Super Admin** | Platform administrator | All permissions + user management + universal role bypass |
| **Admin** | Agency manager | All functional modules (CRM, operations, accounting, settings) — cannot manage users |
| **Operations** | Operations team | CRM, tours, quotations, operations, tour planning, guide assignments, notifications |
| **Accounting** | Finance team | Accounting transactions, document review, PDF/Excel/ZIP exports, AI assistant, reports |
| **Guide** | Field guide | View assigned operations only; upload field receipts |

Role checks are applied:
- **API layer** — `requireRole()` / `requireAnyRole()` middleware on every protected route
- **UI layer** — `ProfileContext` drives conditional rendering of navigation, page sections, and action buttons
- **Data layer** — guide-scoped queries filter by `userId` so guides cannot retrieve other users' assignments even via direct API calls

---

## Accounting Module

The accounting module is the most comprehensive part of TourPilot. It is accessible to `admin`, `accounting`, and `super_admin` roles.

### Manual Transactions

Users can record income and expense transactions with full metadata: amount, currency, category, date, linked customer or supplier, description, and optional document attachment.

### Receipt Management

Receipts are submitted by operations staff and field guides. Each receipt carries an amount, date, vendor, linked operation, and optional document scan. The OCR feature can pre-populate receipt fields from an uploaded image, reducing manual entry time.

### Document Review Centre

Uploaded accounting documents flow into a review queue. Reviewers can:

- **Approve** a document with an optional comment
- **Reject** a document with a mandatory explanation
- **Mark as needs more information** with a request note

Each state transition is timestamped and attributed to the reviewing user. The full review history is visible on the document detail page.

### Approval Workflow

Documents move through states: `pending → approved | rejected | needs_info`. The dashboard shows a live count of documents awaiting review so accounting staff can prioritise their queue.

### Bulk Exports

| Format | Contents |
|--------|----------|
| **PDF** | Formatted transaction report for a date range; includes agency branding from Settings |
| **Excel** | Spreadsheet with one row per transaction; suitable for reconciliation and further analysis |
| **ZIP** | Archive containing all document files attached to transactions in a date range |

All exports are generated server-side on demand and streamed directly to the browser.

### AI Assistance

The AI Accounting Assistant analyses the current financial position by aggregating data across all accounting tables and presenting a structured briefing with:

- A plain-language narrative summary
- Warnings (colour-coded by severity) for items requiring attention
- Actionable recommendations
- The date range and generation timestamp

The assistant result is cached for ten minutes. The `?refresh=true` parameter triggers a fresh analysis.

---

## Reports

TourPilot provides structured financial reporting through the Accounting Reports page.

**Available export types:**

| Export | Format | Scope |
|--------|--------|-------|
| Transaction report | PDF | Date range, all or filtered by type |
| Accounting summary | Excel | Date range, full transaction table |
| Document archive | ZIP | Date range, all attached document files |
| Quotation | PDF | Individual quotation with line items and agency branding |
| Operation summary | PDF | Individual operation with guide, driver, and task details |

All PDF outputs use agency name, address, and contact details configured in Accounting Settings. Changing the agency settings propagates immediately to all subsequent exports.

---

## Roadmap

### Completed

- [x] Five-role RBAC with super admin universal-pass
- [x] CRM — customers and suppliers with archive/restore
- [x] Tours, quotations, and operations lifecycle
- [x] Guide and driver assignment
- [x] In-app notification system
- [x] Accounting transactions (income and expense)
- [x] Receipt management and document upload
- [x] Document review centre with approval workflow
- [x] PDF exports (quotations, operations, financial reports)
- [x] Excel and ZIP bulk exports
- [x] OCR receipt reader (AI-powered)
- [x] AI Accounting Assistant with deterministic fallback and caching
- [x] User invite flow with email-based profile claiming
- [x] Agency settings (used across all PDF outputs)
- [x] TourPilot landing page
- [x] Production build pipeline (pnpm monorepo + Vite)

### Upcoming

- [ ] Mobile app for guides (field receipt capture, offline support)
- [ ] CEO / executive dashboard (high-level KPIs across all agencies)
- [ ] Sales analytics (conversion rates, quotation win/loss analysis)
- [ ] Calendar integration (operation scheduling, guide availability)
- [ ] Multi-agency / multi-tenant support
- [ ] Customer-facing quotation portal

---

## Contributing

TourPilot is currently in active development as a private repository. Contributions are by invitation only.

If you have been given access, please follow these guidelines:

### Branch naming

```
feature/short-description
fix/short-description
chore/short-description
```

### Commit style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(accounting): add ZIP export for document archives
fix(auth): correct Bearer token forwarding in dev proxy
chore(deps): bump drizzle-orm to 0.30.0
```

### Before opening a pull request

1. Run the frontend typecheck: `cd artifacts/tourops-ai && npx tsc --noEmit`
2. Run the backend typecheck: `pnpm --filter @workspace/api-server run typecheck`
3. Run the production build: `pnpm --filter @workspace/tourops-ai run build`
4. Confirm no new `TourOps` references are introduced (the brand is TourPilot)
5. Confirm no secrets, API keys, or credentials are committed
6. Update this README if you add a new module, role, or environment variable

### Code style

- TypeScript strict mode is enabled on all packages
- Zod is used for all API request validation on the backend
- All new Express routes must use `requireRole` or `requireAnyRole` middleware
- New AI calls must implement a deterministic fallback for when `OPENROUTER_API_KEY` is absent
- React components are functional; no class components
- Tailwind utility classes only — no inline `style` objects except for dynamic values that cannot be expressed as utilities

### Environment variables

Never hardcode values that vary between environments. Add new variables to `.env.example` with a comment.

---

## License

This is a private repository. All rights reserved. Unauthorised copying, distribution, or use of this software is prohibited.

---

## Contact

- **Website:** [tourpilot.com.tr](https://tourpilot.com.tr)
- **Email:** hello@tourpilot.com.tr

---

<p align="center">
  Built for Turkish travel agencies &nbsp;·&nbsp; Active development
</p>
