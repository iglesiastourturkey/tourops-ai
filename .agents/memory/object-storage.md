---
name: Object Storage setup
description: Replit Object Storage provisioned; how the storage route adapts Clerk auth vs template
---

Object storage bucket provisioned (DEFAULT_OBJECT_STORAGE_BUCKET_ID, PRIVATE_OBJECT_DIR, PUBLIC_OBJECT_SEARCH_PATHS now set as secrets).

**Rule:** The template in `.local/skills/object-storage/templates/api-server/src/` uses `req.isAuthenticated()` (Replit Auth). This project uses Clerk. When copying storage templates, replace:
- `hasAuthenticatedSession(req)` → `getAuth(req).userId` (import from `@clerk/express`)
- Also: `response.json()` returns `unknown` in TS; cast as `{ signed_url: string }` in objectStorage.ts line 270.

**How to apply:** Any time new storage routes are added, use `getAuth(req)` for auth checks and cast `response.json()` return values explicitly.

Frontend storage logic is centralised in `artifacts/tourops-ai/src/lib/storage-service.ts` — do not scatter presigned URL logic in page components.
