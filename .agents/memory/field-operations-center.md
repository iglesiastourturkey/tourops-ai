---
name: Field Operations Center
description: Sprint 6 implementation — field_operations role, mobile-first field pages, DB schema, backend routes
---

## What was built
- `field_operations` is the 6th role; HomeRedirect → `/field`; ProtectedRoleRoute allows `field_operations/operations/admin`
- DB: `operation_status_history`, `field_incidents`, `operation_field_notes` tables added via `drizzle-kit push` (applied)
- Backend: `artifacts/api-server/src/routes/field.ts` — full CRUD for dashboard, operations, incidents, notes, tasks, assignments
- Frontend pages: `field-dashboard`, `field-operation-detail`, `field-incidents`, `field-incident-detail`
- `FieldShell`: wraps AppShell; adds fixed bottom nav on mobile (`lg:hidden`); content has `pb-16 lg:pb-0`
- multer added to api-server package.json for photo upload on field notes and incidents

## Key decisions
- Bottom nav: Bugün (/field), Operasyonlar (/field/operations → redirect to /field), Olaylar (/field/incidents), Bildirimler (/notifications)
- Assignment conflict: guide overlap → 409; vehicle overlap → 409 with `warnings[]` in response body
- Operation lifecycle: planned → ready → started → in_progress/delayed → completed; cancel always available

**Why:** field_operations staff need a mobile-first interface distinct from the main operations dashboard; they should not have access to financials or customer data.

## Labels added in labels.ts
- `OPERATION_STATUS_LABELS/COLORS` extended with: planned, ready, started, in_progress, delayed
- `INCIDENT_TYPE_LABELS`, `INCIDENT_SEVERITY_LABELS/COLORS`, `INCIDENT_STATUS_LABELS/COLORS`
- `FIELD_NOTE_CATEGORY_LABELS`

## multer install note
multer was NOT in api-server dependencies before Sprint 6. It bundles fine with esbuild (no need to externalize).
