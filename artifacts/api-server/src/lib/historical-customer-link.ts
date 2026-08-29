import { db, customersTable, historicalOperationImportsTable, operationsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createAuditLog } from "./audit";
import { verifyOperatorPermission } from "./historical-migration-operator";
import {
  assessHistoricalCustomerLink,
  type CustomerLinkAssessment,
} from "./historical-customer-link-validation";

export { assessHistoricalCustomerLink } from "./historical-customer-link-validation";
export type { CustomerLinkAssessment, CustomerLinkClassification } from "./historical-customer-link-validation";

async function loadCustomerLinkState(
  executor: Pick<typeof db, "select">,
  sourceKey: string,
  customerId: number,
  lock = false,
) {
  const importQuery = executor
    .select({
      sourceKey: historicalOperationImportsTable.sourceKey,
      status: historicalOperationImportsTable.status,
      importedOperationId: historicalOperationImportsTable.importedOperationId,
    })
    .from(historicalOperationImportsTable)
    .where(eq(historicalOperationImportsTable.sourceKey, sourceKey));
  const [historicalImport] = lock
    ? await importQuery.for("update").limit(1)
    : await importQuery.limit(1);

  const operationQuery = historicalImport?.importedOperationId === null || historicalImport?.importedOperationId === undefined
    ? null
    : executor
      .select({ id: operationsTable.id, customerId: operationsTable.customerId })
      .from(operationsTable)
      .where(eq(operationsTable.id, historicalImport.importedOperationId));
  const [operation] = operationQuery === null
    ? []
    : lock ? await operationQuery.for("update").limit(1) : await operationQuery.limit(1);

  const customerQuery = executor
    .select({ id: customersTable.id, name: customersTable.name, archivedAt: customersTable.archivedAt })
    .from(customersTable)
    .where(eq(customersTable.id, customerId));
  const [customer] = lock
    ? await customerQuery.for("update").limit(1)
    : await customerQuery.limit(1);

  return { historicalImport: historicalImport ?? null, operation: operation ?? null, customer: customer ?? null };
}

export async function planHistoricalCustomerLink(params: {
  sourceKey: string;
  customerId: number;
  actorProfileId: number;
}) {
  const verification = await verifyOperatorPermission(params.actorProfileId, "historical_migration", "customer_review");
  if (!verification.ok) throw new Error(verification.message);

  const state = await loadCustomerLinkState(db, params.sourceKey, params.customerId);
  return assessHistoricalCustomerLink({
    sourceKey: params.sourceKey,
    requestedCustomerId: params.customerId,
    ...state,
  });
}

export type HistoricalCustomerLinkApplyResult =
  | { kind: "linked"; assessment: CustomerLinkAssessment }
  | { kind: "existing"; assessment: CustomerLinkAssessment }
  | { kind: "conflict"; assessment: CustomerLinkAssessment }
  | { kind: "failed"; assessment: CustomerLinkAssessment };

export async function applyHistoricalCustomerLink(params: {
  sourceKey: string;
  customerId: number;
  actorProfileId: number;
}): Promise<HistoricalCustomerLinkApplyResult> {
  const verification = await verifyOperatorPermission(params.actorProfileId, "historical_migration", "customer_link");
  if (!verification.ok) throw new Error(verification.message);

  return db.transaction(async (tx) => {
    // Dedicated Phase 3D-B.2 advisory key. The row locks below protect the
    // exact import/operation/customer records; this additionally serializes
    // link commands before any stale state can be evaluated.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(2026, 5)`);
    const state = await loadCustomerLinkState(tx, params.sourceKey, params.customerId, true);
    const assessment = assessHistoricalCustomerLink({
      sourceKey: params.sourceKey,
      requestedCustomerId: params.customerId,
      ...state,
    });

    if (assessment.classification === "already_linked_same_customer") {
      // Exact replay is a domain-write no-op: do not create a second audit row
      // for the original transition. The first NULL -> customer_id link is the
      // only audited mutation for this source/customer pair.
      return { kind: "existing", assessment };
    }
    if (assessment.classification === "conflict_existing_customer") return { kind: "conflict", assessment };
    if (assessment.classification !== "eligible") return { kind: "failed", assessment };

    const updated = await tx
      .update(operationsTable)
      .set({ customerId: params.customerId })
      .where(and(eq(operationsTable.id, assessment.operationId as number), isNull(operationsTable.customerId)))
      .returning({ id: operationsTable.id });
    if (!updated[0]) {
      return {
        kind: "conflict",
        assessment: { ...assessment, classification: "conflict_existing_customer" },
      };
    }

    await createAuditLog({
      eventType: "historical_customer_linked",
      actorProfileId: params.actorProfileId,
      module: "historical_migration",
      entityType: "operation",
      entityId: assessment.operationId as number,
      metadata: {
        sourceKey: params.sourceKey,
        operationId: assessment.operationId,
        customerId: params.customerId,
        action: "historical_customer_link",
        outcome: "linked",
      },
      description: "Historical operation mevcut musteriye insan onayi ile baglandi",
    }, tx);
    return { kind: "linked", assessment };
  });
}
