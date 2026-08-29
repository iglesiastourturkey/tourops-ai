import assert from "node:assert/strict";
import { parseHistoricalCustomerLinkArgs, validateHistoricalCustomerLinkTarget } from "./historical-customer-link";
import { assessHistoricalCustomerLink, customerLinkApplyCounts } from "./lib/historical-customer-link-validation";

const sourceKey = "legacy:file-1:01:3";
const baseArgs = ["--source-key", sourceKey, "--customer-id", "7", "--operator-profile-id", "9"];
assert.deepEqual(parseHistoricalCustomerLinkArgs(baseArgs), {
  sourceKey, customerId: 7, actorProfileId: 9, apply: false,
});
assert.deepEqual(parseHistoricalCustomerLinkArgs([
  ...baseArgs, "--apply", "--confirm-customer-link", "TOURPILOT_2026_HISTORICAL_CUSTOMER_LINK",
]), { sourceKey, customerId: 7, actorProfileId: 9, apply: true });
for (const args of [
  ["--source-key", sourceKey, "--customer-id", "7"],
  ["--source-key", sourceKey, "--customer-id", "7", "--operator-profile-id", "9", "--apply"],
  [...baseArgs, "--apply", "--confirm-customer-link", "wrong"],
  [...baseArgs, "--limit", "1"],
  [...baseArgs, "--customer-id", "8"],
  [...baseArgs, "--source-key", "legacy:other:01:3"],
]) {
  assert.throws(() => parseHistoricalCustomerLinkArgs(args), /operator|onay|Desteklenmeyen|Tam olarak/i);
}

const target = {
  HISTORICAL_STAGING_DATABASE_URL: "postgresql://user:password@branch-123.neon.tech/neondb",
  HISTORICAL_STAGING_DATABASE_HOST: "branch-123.neon.tech",
};
assert.equal(validateHistoricalCustomerLinkTarget(target), target.HISTORICAL_STAGING_DATABASE_URL);
assert.throws(() => validateHistoricalCustomerLinkTarget({ ...target, NODE_ENV: "production" }), /Production/);
assert.throws(() => validateHistoricalCustomerLinkTarget({ ...target, HISTORICAL_STAGING_DATABASE_HOST: "other.neon.tech" }), /allowlist/);

const imported = { sourceKey, status: "imported", importedOperationId: 11 };
const activeCustomer = { id: 7, name: "Existing Customer", archivedAt: null };
const emptyOperation = { id: 11, customerId: null };
const assess = (overrides: Partial<Parameters<typeof assessHistoricalCustomerLink>[0]>) => assessHistoricalCustomerLink({
  sourceKey,
  requestedCustomerId: 7,
  historicalImport: imported,
  operation: emptyOperation,
  customer: activeCustomer,
  ...overrides,
});
assert.equal(assess({}).classification, "eligible");
assert.equal(assess({ historicalImport: null }).classification, "source_not_found");
assert.equal(assess({ historicalImport: { ...imported, status: "pending" } }).classification, "source_not_imported");
assert.equal(assess({ historicalImport: { ...imported, importedOperationId: null } }).classification, "invalid_import_backlink");
assert.equal(assess({ operation: null }).classification, "invalid_import_backlink");
assert.equal(assess({ customer: null }).classification, "customer_not_found");
assert.equal(assess({ customer: { ...activeCustomer, archivedAt: new Date() } }).classification, "customer_archived");
assert.equal(assess({ operation: { id: 11, customerId: 7 } }).classification, "already_linked_same_customer");
assert.equal(assess({ operation: { id: 11, customerId: 8 } }).classification, "conflict_existing_customer");

assert.deepEqual(customerLinkApplyCounts("linked"), { attempted: 1, linked: 1, existing: 0, conflicts: 0, failed: 0 });
assert.deepEqual(customerLinkApplyCounts("existing"), { attempted: 1, linked: 0, existing: 1, conflicts: 0, failed: 0 });
assert.deepEqual(customerLinkApplyCounts("conflict"), { attempted: 1, linked: 0, existing: 0, conflicts: 1, failed: 0 });

console.log("historical customer link self-test: passed");
