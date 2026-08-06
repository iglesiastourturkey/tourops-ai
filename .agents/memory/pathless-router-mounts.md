---
name: Path-less router mounts leak middleware
description: Why router-level middleware on routers mounted without a path prefix guards every later route in the API
---

Routers mounted without a path prefix (e.g. `router.use(settingsRouter)` in the API route index) match **every** request path. Any `router.use(<middleware>)` inside such a router therefore intercepts all routes registered after it in the index — not just that router's own routes.

**Why:** The settings router's router-level `requireAuth` silently 401'd the public Google OAuth callback mounted later, even though the callback route itself had no auth guard. The failure looked like a bug in the callback's own router.

**How to apply:** For routers mounted at `/` or with no prefix, never add router-level middleware; put guards on each route (e.g. `requirePermission`, which itself rejects unauthenticated calls). When a public endpoint mysteriously returns 401, check earlier path-less mounts in `routes/index.ts` before suspecting the endpoint's own router.
