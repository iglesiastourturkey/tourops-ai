---
name: Gmail reservation intake
description: Design constraints of the Gmail → AI → draft-operation intake flow
---

Manual-only Gmail scanning limited to messages with the `TourPilot` label; no background monitoring or auto operation creation. A human reviews AI-extracted fields before draft creation.

Key rules:
- Google OAuth callback (`/api/reservations/google-connection/callback`) is intentionally public — Google redirects arrive without a Clerk session. Authorization comes from an HMAC-signed (SESSION_SECRET), 10-minute OAuth state.
- Google tokens are AES-256-GCM encrypted server-side (key derived from SESSION_SECRET); never logged.
- Email bodies are untrusted prompt input: strict Zod validation, unknown → null, size caps (50k chars, 50 messages/scan); bodies/attachments excluded from audit logs.
- Duplicate protection: unique (connection, gmailMessageId) index + unique sourceEmailImportId on operations; draft creation is idempotent inside a transaction.
- Customer matching by email or phone only — never by name alone.
- Feature is config-gated on GOOGLE_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI secrets; UI shows a clear gated message when absent. Setup steps documented in replit.md.
