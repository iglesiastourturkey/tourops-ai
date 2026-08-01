---
name: DB schema: operations extended
description: Operations table has guide/driver/emergency contact fields; operation_receipts table added
---

**Rule:** `operationsTable` in `lib/db/src/schema/operations.ts` now has nullable text columns: guideName, guidePhone, driverName, driverPhone, vehiclePlate, emergencyContact1Name, emergencyContact1Phone, emergencyContact2Name, emergencyContact2Phone.

New `operationReceiptsTable`: id, operationId (FK→operations, cascade), amount (real), currency (default TRY), supplierName, receiptDate, guideNote, photoObjectPath (stores object storage path), createdAt, updatedAt.

**How to apply:** DB was pushed. Any future schema changes must run `pnpm --filter @workspace/db run push` followed by `pnpm --filter @workspace/api-spec run codegen`.
