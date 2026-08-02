---
name: Sprint 7.2 Enterprise Administration
description: Permission system, system mode control, role management pages — completed implementation details and gotchas.
---

## What was built

6 new DB tables in lib/db/src/schema/: roles, permissions, role_permissions, user_permissions, system_settings, audit_logs.

Backend:
- `lib/permissions.ts` — in-memory permission cache (5-min TTL), `getPermissionsForProfile()`, `hasPermission()`, `invalidate*()`, `getSystemSettings()` (30-sec TTL)
- `lib/auth.ts` — added `requirePermission(module, action)` middleware; super_admin always bypasses
- `lib/seed-permissions.ts` — seeds 6 roles, all module×action permissions, and default role_permissions; runs on server startup, non-fatal
- `lib/audit.ts` — `createAuditLog()` helper
- `middlewares/systemMode.ts` — blocks non-active modes; super_admin bypass; pre-loads profile
- `routes/roles.ts` — GET `/roles` (full matrix), PATCH `/:roleName/permissions/:id` (toggle), user overrides CRUD
- `routes/system.ts` — GET/PATCH `/system/settings`
- `routes/audit.ts` — GET `/audit` paginated
- ALL route files updated from `requireRole`/`requireAnyRole` to `requirePermission(module, action)`

Frontend:
- `ProfileContext.tsx` — extended with `permissionSet: Set<string>`, `allPermissions: boolean`, `permissionsLoaded: boolean`; fetches `/api/profiles/me/permissions` after profile loads
- `AppShell.tsx` — permission-based nav visibility (`permissionSet.has("module.action")`); two new items: /roles and /system-control
- `pages/roles.tsx` — role permission matrix page (super_admin only)
- `pages/system-control.tsx` — system mode management page (super_admin only)
- `App.tsx` — new routes /roles and /system-control

## Key gotchas

**DB dist must be rebuilt after schema changes**: `cd lib/db && pnpm exec tsc --build`. The dist/ directory holds .d.ts files used by project references; stale dist causes "has no exported member" errors.

**api-zod dist must be rebuilt**: `cd lib/api-zod && pnpm exec tsc --build`. Same reason.

**ProfileRole generated type**: `lib/api-zod/src/generated/types/profileRole.ts` and the three role enum lines in `lib/api-zod/src/generated/api.ts` must include all 6 roles: super_admin, admin, operations, guide, accounting, field_operations. The generated file only had 4 roles.

**Seed uses `[...ROLE_DEFS]` not `ROLE_DEFS`**: Drizzle `insert().values()` requires a mutable array; `as const` tuples must be spread.

**SYSTEM_MODES for z.enum()**: Use `[...SYSTEM_MODES] as [string, ...string[]]` since `as const` arrays are readonly.

**super_admin rows NOT in role_permissions**: The bypass is code-level in `requirePermission`. No DB rows are seeded for super_admin.

**permission key format**: `"module.action"` string, e.g. `"customers.view"`, `"accounting.approve"`.

**`permissionsLoaded` prevents nav flash**: Without this flag, nav shows empty briefly while permissions fetch is in-flight after profile load.

**Why:**
- pre-existing sign-in-admin.tsx TS error (Clerk v4 authenticateWithRedirect) is unrelated to this sprint and was there before.
