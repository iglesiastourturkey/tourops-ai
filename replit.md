# TourOps AI

AI-powered tour operations management platform for Turkish travel agencies in the Kuşadası / Efes / Pamukkale region. Full Turkish-language UI covering the complete workflow: customer request → AI analysis → tour plan → cost calculation → quotation → operation checklist.

---

## Local Development

### Prerequisites
- Node.js 22+, pnpm 9+
- A running PostgreSQL instance (local, Docker, [Neon](https://neon.tech), or [Supabase](https://supabase.com))
- A Clerk account with an application (https://dashboard.clerk.com)

### 1 — Install dependencies
```bash
pnpm install
```

### 2 — Configure environment variables
```bash
cp .env.example .env
# Edit .env and fill in DATABASE_URL, CLERK_*, SESSION_SECRET
```

### 3 — Push the database schema
```bash
pnpm --filter @workspace/db run push
```

### 4 — Seed the database (optional but recommended)
```bash
pnpm --filter @workspace/api-server run seed
```

### 5 — Run the API server
```bash
# Runs on http://localhost:8080
pnpm --filter @workspace/api-server run dev
```

### 6 — Run the frontend
```bash
# Runs on http://localhost:5173 (or next available port)
pnpm --filter @workspace/tourops-ai run dev
```

The frontend expects the API server at the same origin via `/api`. For local development with both processes on different ports, configure a Vite proxy in `artifacts/tourops-ai/vite.config.ts` or use a reverse proxy.

### Enable AI features
Add `OPENAI_API_KEY=sk-...` to your `.env`. All four AI routes fall back to safe mock responses when the key is absent — no errors, just placeholder data.

---

## Run & Operate

| Command | Purpose |
|---|---|
| `pnpm --filter @workspace/tourops-ai run dev` | Start the frontend dev server |
| `pnpm --filter @workspace/api-server run dev` | Start the API server |
| `pnpm --filter @workspace/tourops-ai run build` | Production build of the frontend |
| `pnpm --filter @workspace/api-server run build` | Production build of the API server |
| `pnpm run typecheck` | Full typecheck across all packages |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API hooks and Zod schemas from the OpenAPI spec |
| `pnpm --filter @workspace/db run push` | Push DB schema changes (dev only, requires DATABASE_URL) |
| `pnpm --filter @workspace/api-server run seed` | Seed demo data (suppliers, customers, tours, quotations) |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | ✅ | — | Clerk backend secret key |
| `CLERK_PUBLISHABLE_KEY` | ✅ | — | Clerk publishable key (used by API server) |
| `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | — | Clerk publishable key (exposed to browser) |
| `SESSION_SECRET` | ✅ | — | Express session signing secret |
| `OPENAI_API_KEY` | ⚠️ optional | — | Enables live AI responses; absent = mock fallback |
| `OPENROUTER_API_KEY` | ⚠️ optional | — | Enables live Gmail reservation extraction through OpenRouter |
| `GOOGLE_OAUTH_CLIENT_ID` | ⚠️ Gmail/Drive | — | Google Cloud OAuth web client ID for the manual Gmail scanner and Drive connection |
| `GOOGLE_OAUTH_CLIENT_SECRET` | ⚠️ Gmail/Drive | — | Google Cloud OAuth web client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | ⚠️ Gmail/Drive | — | Must be the public API callback URL ending in `/api/reservations/google-connection/callback` |
| `GOOGLE_OAUTH_SUCCESS_URL` | optional | `/settings?google=connected` | Where to return after a successful Google authorization |
| `MICROSOFT_OAUTH_CLIENT_ID` | ⚠️ Outlook | — | Azure AD / Microsoft Entra ID app registration client ID for the Outlook mail connection |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | ⚠️ Outlook | — | Azure AD app registration client secret |
| `MICROSOFT_OAUTH_REDIRECT_URI` | ⚠️ Outlook | — | Must be the public API callback URL ending in `/api/reservations/outlook-connection/callback` |
| `MICROSOFT_OAUTH_TENANT_ID` | ⚠️ Outlook | — | Directory (tenant) ID; required because the app registration is single-tenant |
| `MICROSOFT_OAUTH_SUCCESS_URL` | optional | `/settings?outlook=connected` | Where to return after a successful Outlook authorization |
| `CONTACT_SMTP_HOST` | ⚠️ Contact form | — | SMTP server hostname for public contact-form delivery |
| `CONTACT_SMTP_PORT` | ⚠️ Contact form | — | SMTP port, usually `587` (STARTTLS) or `465` (TLS) |
| `CONTACT_SMTP_SECURE` | optional | `false` | Set `true` only for implicit TLS, normally port `465` |
| `CONTACT_SMTP_USER` | ⚠️ Contact form | — | SMTP account username |
| `CONTACT_SMTP_PASSWORD` | ⚠️ Contact form | — | SMTP account password or provider app password |
| `CONTACT_SMTP_FROM_EMAIL` | ⚠️ Contact form | — | Verified sender, for example `TourPilot <noreply@yourdomain.com>` |
| `PORT` | optional | `5173` / `8080` | Port for frontend / API server |
| `BASE_PATH` | optional | `/` | URL prefix the frontend is served from |

---

## Stack

- **Monorepo**: pnpm workspaces, Node.js 22, TypeScript 5.9
- **Frontend**: React 19 + Vite 7, Wouter (routing), TanStack Query, shadcn/ui, Tailwind CSS 4
- **Backend**: Express 5, Drizzle ORM, PostgreSQL
- **Auth**: Clerk (Replit-managed on Replit; standard Clerk on other platforms)
- **AI**: OpenAI GPT-4o-mini via direct fetch; mock fallback when key absent
- **API contract**: OpenAPI spec → Orval codegen → typed React Query hooks + Zod schemas

## Where things live

| Path | Contents |
|---|---|
| `artifacts/tourops-ai/` | React/Vite frontend |
| `artifacts/api-server/` | Express API server |
| `lib/db/` | Drizzle schema + migrations |
| `lib/api-spec/openapi.yaml` | Source-of-truth API contract |
| `lib/api-client-react/` | Generated React Query hooks (do not edit manually) |
| `lib/api-zod/` | Generated Zod schemas (do not edit manually) |
| `artifacts/tourops-ai/src/lib/labels.ts` | All Turkish label maps and formatters |

## Architecture Decisions

- **Clerk proxy via Express**: The API server proxies Clerk's Frontend API so authentication works under Replit's path-based routing without CNAME DNS changes. On non-Replit deployments this proxy is a no-op unless configured.
- **Codegen-first API**: The OpenAPI spec (`lib/api-spec/openapi.yaml`) is the single source of truth. Run `pnpm --filter @workspace/api-spec run codegen` after any schema change before editing frontend code.
- **Mock AI fallback**: All AI routes check for `OPENAI_API_KEY` at request time and return structured mock data when absent. This keeps the full UI functional without needing an API key in development.
- **PORT/BASE_PATH optional**: Both the frontend and API server use safe defaults (`5173` / `8080` / `/`) when these variables are absent, so `vite build` and `node index.js` work in any environment.

## Product

Turkish-language SPA for tour operators managing the Kuşadası / Efes / Pamukkale region. Core workflow:

1. **Yeni Talep** — paste a customer WhatsApp/email message; AI extracts travel details
2. **Müşteriler** — customer CRM with passport status and travel preferences
3. **Turlar** — tour builder with day-by-day program, cost sheet, and profit margin calculator; cruise-excursion mode with ship timing constraints
4. **Teklifler** — numbered quotations with status workflow (draft → sent → accepted) and AI email drafting
5. **Operasyonlar** — operation checklists with task completion tracking
6. **Tedarikçiler** — supplier directory (hotels, guides, transport, restaurants)
7. **Ayarlar** — agency profile, exchange rates, email templates

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen` before editing frontend pages — the generated hooks and Zod types must match the spec.
- The API server must be running for any authenticated frontend page to load. The dashboard and all data pages call `/api/*` on mount.
- `pnpm --filter @workspace/db run push` is destructive on schema changes that drop columns — review the diff before confirming in interactive mode.
- Replit-specific Vite plugins (`@replit/vite-plugin-*`) are loaded only when `REPL_ID` is set. They are skipped silently in production builds and local development.

### Gmail reservation intake setup

The Gmail reservation inbox is deliberately **manual**: it only scans messages carrying the `TourPilot` Gmail label when an authorized staff member selects **Gmail’i Tara**. It does not monitor Gmail in the background, download attachment contents, or create final operations automatically.

1. In Google Cloud Console, create (or select) a project and configure the OAuth consent screen for the connected Google Workspace account.
2. Create a **Web application** OAuth 2.0 client. Add the exact public callback URL from `GOOGLE_OAUTH_REDIRECT_URI` as an authorized redirect URI. Its path must be `/api/reservations/google-connection/callback`.
3. Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_URI` as server-side secrets. Optionally configure `GOOGLE_OAUTH_SUCCESS_URL` to return to the app’s Settings page.
4. The implementation requests only the Gmail read-only scope: `https://www.googleapis.com/auth/gmail.readonly`. The optional Drive integration uses the limited `https://www.googleapis.com/auth/drive.file` scope.
5. A super admin or admin opens **Ayarlar → Google Workspace** and connects the mailbox. Operations staff can then scan and review imports, but cannot authorize or disconnect the mailbox.

### Outlook connection setup

The Outlook connection currently covers **authorization only** — connecting/disconnecting a mailbox and storing its encrypted refresh token. Mail scanning (the Gmail-equivalent "Outlook'u Tara") is not implemented yet; it depends on the still-undesigned Reservation Ingestion Engine described in `.claude/docs/integrations.md`.

1. In the Azure Portal, register an app under **Microsoft Entra ID → App registrations** (name, e.g., "TourPilot Outlook Integration"; supported account types: single tenant).
2. Add a **Web** platform redirect URI matching `MICROSOFT_OAUTH_REDIRECT_URI` exactly. Its path must be `/api/reservations/outlook-connection/callback`.
3. Under **API permissions → Microsoft Graph → Delegated permissions**, add `Mail.Read`.
4. Under **Certificates & secrets**, create a client secret. Configure `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_REDIRECT_URI`, and `MICROSOFT_OAUTH_TENANT_ID` (the app registration's Directory/tenant ID) as server-side secrets. Optionally configure `MICROSOFT_OAUTH_SUCCESS_URL`.
5. A super admin or admin opens **Ayarlar → Outlook** and connects the mailbox, mirroring the Gmail connect/disconnect flow.

### Landing-page contact form setup

The public **İletişim** form sends messages to `info@iglesiastourturkey.com` from the API server. It uses a hidden honeypot plus per-IP rate limiting; form contents are not stored in the database or audit log.

1. Configure `CONTACT_SMTP_HOST`, `CONTACT_SMTP_PORT`, `CONTACT_SMTP_USER`, `CONTACT_SMTP_PASSWORD`, and `CONTACT_SMTP_FROM_EMAIL` as server-side secrets.
2. Use a verified sender address in `CONTACT_SMTP_FROM_EMAIL`. The visitor's email address is set as the email reply-to address, rather than being used as the sender.
3. For standard STARTTLS SMTP set `CONTACT_SMTP_PORT=587` and leave `CONTACT_SMTP_SECURE` unset or `false`. For implicit TLS set port `465` and `CONTACT_SMTP_SECURE=true`.
4. No contact-form credentials are exposed to the Vite frontend.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
