import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLI = readFileSync(new URL("../artifacts/api-server/src/historical-customer-link.ts", import.meta.url), "utf8");
const SERVICE = readFileSync(new URL("../artifacts/api-server/src/lib/historical-customer-link.ts", import.meta.url), "utf8");
const VALIDATION = readFileSync(new URL("../artifacts/api-server/src/lib/historical-customer-link-validation.ts", import.meta.url), "utf8");
const PERMISSIONS = readFileSync(new URL("../artifacts/api-server/src/lib/seed-permissions.ts", import.meta.url), "utf8");
const API_PACKAGE = JSON.parse(readFileSync(new URL("../artifacts/api-server/package.json", import.meta.url), "utf8"));

assert.equal(API_PACKAGE.scripts["historical:customer-link"], "tsx src/historical-customer-link.ts");
assert.match(CLI, /TOURPILOT_2026_HISTORICAL_CUSTOMER_LINK/);
assert.match(CLI, /HISTORICAL_STAGING_DATABASE_URL/);
assert.match(CLI, /HISTORICAL_STAGING_DATABASE_HOST/);
assert.match(CLI, /NODE_ENV === "production"/);
assert.match(CLI, /url\.hostname !== allowedHost \|\| !allowedHost\.endsWith\("\.neon\.tech"\)/);
assert.match(CLI, /--operator-profile-id zorunludur/);
assert.match(CLI, /Tam olarak bir --source-key/);
assert.match(CLI, /Tam olarak bir --customer-id/);
assert.match(CLI, /Desteklenmeyen veya sinirsiz bayrak/);
assert.match(CLI, /databaseWrites: false/);
assert.match(CLI, /customerWrites: false/);
assert.match(CLI, /operationWrites: false/);
assert.match(CLI, /databaseWrites: result\.kind === "linked"/);
assert.match(CLI, /operationWrites: result\.kind === "linked"/);

assert.match(VALIDATION, /params\.historicalImport\.status !== "imported"/, "link state must require imported status");
assert.match(SERVICE, /pg_advisory_xact_lock\(2026, 5\)/, "apply must use a distinct advisory lock");
assert.equal((SERVICE.match(/\.for\("update"\)/g) ?? []).length, 3, "import, operation, and customer must be row-locked");
assert.match(SERVICE, /isNull\(operationsTable\.customerId\)/, "write must compare-and-swap a NULL customer_id");
assert.match(SERVICE, /\.set\(\{ customerId: params\.customerId \}\)/, "only operations.customer_id may be changed");
assert.doesNotMatch(SERVICE, /\.update\(customersTable\)|\.insert\(customersTable\)|\.delete\(customersTable\)/, "customers must never be mutated");
assert.doesNotMatch(SERVICE, /\.update\(historicalOperationImportsTable\)/, "historical provenance/payload state must remain untouched");
assert.match(SERVICE, /verifyOperatorPermission\(params\.actorProfileId, "historical_migration", "customer_review"\)/);
assert.match(SERVICE, /verifyOperatorPermission\(params\.actorProfileId, "historical_migration", "customer_link"\)/);
assert.equal((SERVICE.match(/createAuditLog\(/g) ?? []).length, 1, "only the first successful link may create an audit row");
assert.match(SERVICE, /eventType: "historical_customer_linked"[\s\S]*?\}, tx\)/, "the successful link audit must share the transaction");
const replayBody = SERVICE.slice(
  SERVICE.indexOf('if (assessment.classification === "already_linked_same_customer")'),
  SERVICE.indexOf('if (assessment.classification === "conflict_existing_customer")'),
);
assert.doesNotMatch(replayBody, /createAuditLog|\.insert\(|\.update\(|\.delete\(/, "same-customer replay must be a true no-op");
const conflictBody = SERVICE.slice(
  SERVICE.indexOf('if (assessment.classification === "conflict_existing_customer")'),
  SERVICE.indexOf('if (assessment.classification !== "eligible")'),
);
assert.doesNotMatch(conflictBody, /createAuditLog|\.insert\(|\.update\(|\.delete\(/, "different-customer conflict must not write");
const planBody = SERVICE.slice(SERVICE.indexOf("export async function planHistoricalCustomerLink"), SERVICE.indexOf("export type HistoricalCustomerLinkApplyResult"));
assert.doesNotMatch(planBody, /\.insert\(|\.update\(|\.delete\(/, "PLAN must remain read-only");
assert.match(PERMISSIONS, /\["historical_migration", "customer_review",\s*\["admin"\]\]/);
assert.match(PERMISSIONS, /\["historical_migration", "customer_link",\s*\["admin"\]\]/);

execFileSync(
  "./artifacts/api-server/node_modules/.bin/tsx",
  ["artifacts/api-server/src/historical-customer-link-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical customer link focused tests: passed");
