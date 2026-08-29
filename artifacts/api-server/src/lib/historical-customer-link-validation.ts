export type CustomerLinkClassification =
  | "eligible"
  | "already_linked_same_customer"
  | "conflict_existing_customer"
  | "invalid_import_backlink"
  | "customer_not_found"
  | "customer_archived"
  | "source_not_imported"
  | "source_not_found";

export interface HistoricalImportLinkState {
  sourceKey: string;
  status: string;
  importedOperationId: number | null;
}

export interface OperationLinkState {
  id: number;
  customerId: number | null;
}

export interface CustomerLinkState {
  id: number;
  name: string;
  archivedAt: Date | null;
}

export interface CustomerLinkAssessment {
  classification: CustomerLinkClassification;
  sourceKey: string;
  requestedCustomerId: number;
  importedOperationId: number | null;
  operationId: number | null;
  operationCustomerId: number | null;
  customer: { id: number; name: string } | null;
}

export type CustomerLinkApplyKind = "linked" | "existing" | "conflict" | "failed";

/** Fixed one-target APPLY counters: no bulk or implicit retry accounting. */
export function customerLinkApplyCounts(kind: CustomerLinkApplyKind) {
  return {
    attempted: 1,
    linked: kind === "linked" ? 1 : 0,
    existing: kind === "existing" ? 1 : 0,
    conflicts: kind === "conflict" ? 1 : 0,
    failed: kind === "failed" ? 1 : 0,
  };
}

/** Pure decision table shared by the read-only PLAN and transaction re-check. */
export function assessHistoricalCustomerLink(params: {
  sourceKey: string;
  requestedCustomerId: number;
  historicalImport: HistoricalImportLinkState | null;
  operation: OperationLinkState | null;
  customer: CustomerLinkState | null;
}): CustomerLinkAssessment {
  const importedOperationId = params.historicalImport?.importedOperationId ?? null;
  const operationId = params.operation?.id ?? null;
  const operationCustomerId = params.operation?.customerId ?? null;
  const customer = params.customer ? { id: params.customer.id, name: params.customer.name } : null;
  const base = {
    sourceKey: params.sourceKey,
    requestedCustomerId: params.requestedCustomerId,
    importedOperationId,
    operationId,
    operationCustomerId,
    customer,
  };

  if (params.historicalImport === null) return { ...base, classification: "source_not_found" };
  if (params.historicalImport.status !== "imported") return { ...base, classification: "source_not_imported" };
  if (params.historicalImport.importedOperationId === null || params.operation === null) {
    return { ...base, classification: "invalid_import_backlink" };
  }
  if (params.customer === null) return { ...base, classification: "customer_not_found" };
  if (params.customer.archivedAt !== null) return { ...base, classification: "customer_archived" };
  if (params.operation.customerId === params.customer.id) {
    return { ...base, classification: "already_linked_same_customer" };
  }
  if (params.operation.customerId !== null) return { ...base, classification: "conflict_existing_customer" };
  return { ...base, classification: "eligible" };
}
