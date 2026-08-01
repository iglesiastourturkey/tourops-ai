---
name: RBAC implementation
description: Durable policy decisions for the 4-role RBAC (admin/operations/guide/accounting)
---

# RBAC Policy Decisions

**Why:** Four roles replace the old single-staff model. These rules must stay consistent across future changes.

## Role escalation prevention
`PATCH /profiles/me` accepts only `name`. Role and isActive changes go exclusively through `/api/users` (admin only). Enforced on both backend and frontend to prevent self-escalation.

## Child resource scoping
All nested resource mutations (task update/delete, receipt delete) must be scoped by **both** the child ID and the parent `operationId`. Using child ID alone allows cross-operation mutation.

## Guide access boundaries
- Tours: guides may only access tours linked to their assigned operations (via `assignedGuideUserId`). Never trust the tour ID alone.
- Financial data (costs, cost-summary): guides are excluded on both backend and frontend.
- Receipts: guides may delete only receipts they created (`createdByUserId`).
- Non-OCR AI endpoints: guides are excluded; OCR is allowed.

## Frontend role checks
Pages accessible to multiple roles but with mixed-permission actions must use `useProfile()` to suppress mutation controls per role. Route guards alone are insufficient when a page has both read and write actions for different roles.

**How to apply:** Use `const canEdit = ['admin', 'operations'].includes(role ?? '')` — note the `?? ''` to handle the null-while-loading state from `useProfile()`.

## DB migration
Committed SQL at `lib/db/migrations/0001_rbac_columns.sql`. Run `drizzle-kit push` for dev; apply SQL directly in production.
