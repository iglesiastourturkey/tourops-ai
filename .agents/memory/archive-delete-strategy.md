---
name: Archive/delete strategy
description: How each entity is archived and deleted, plus backend 409 protection rules
---

## Archive mechanism (per entity)
- **Customers**: `archivedAt` timestamp column (nullable). Set via PATCH `{archivedAt: new Date().toISOString()}`. Migration run.
- **Suppliers**: same `archivedAt` column approach. Migration run.
- **Quotations**: `status = 'archived'`. No migration needed (existing text column).
- **Operations**: `status = 'archived'`. No migration needed.
- **Tours**: `status = 'archived'`. Already existed before this batch.

## Delete protection (HTTP 409)
- Customers: blocked if active quotations (draft/sent/viewed/accepted) or active operations (status=active) exist.
- Quotations: blocked if active operations (status=active) linked via quotationId.
- Operations: no 409 block; cascades tasks; deletes receipt GCS objects best-effort then DB row.
- Suppliers: no 409 block (no FK constraint to active records worth enforcing at MVP).

## Frontend patterns
- All list pages filter out archived records by default; "Arşivlenenler" toggle button shows only archived.
- Delete uses AlertDialog (not browser confirm()) across all pages.
- 409 errors surface a Turkish toast explaining the constraint.
- Check error status with `(err as { response?: { status?: number } })?.response?.status` — axios is NOT installed in tourops-ai frontend package; do not import it.

**Why:** Soft archive preserves history; hard delete is the nuclear option for genuinely stale data. 409 prevents data integrity violations at the API level.

**How to apply:** Any new list page should follow the same showArchived toggle → client-side filter pattern. Any new entity with FK children should implement 409 in its DELETE route.
