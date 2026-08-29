import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const planPath = new URL("../artifacts/api-server/src/historical-customer-resolution-plan.ts", import.meta.url);
const classifierPath = new URL("../artifacts/api-server/src/lib/historical-customer-resolution.ts", import.meta.url);
const apiPackagePath = new URL("../artifacts/api-server/package.json", import.meta.url);

const [plan, classifier, apiPackageRaw] = await Promise.all([
  readFile(planPath, "utf8"),
  readFile(classifierPath, "utf8"),
  readFile(apiPackagePath, "utf8"),
]);
const apiPackage = JSON.parse(apiPackageRaw);

assert.match(plan, /isNull\(customersTable\.archivedAt\)/, "archived customers must be excluded with SQL IS NULL");
assert.doesNotMatch(plan, /inArray\(customersTable\.archivedAt,\s*\[null\]\)/, "NULL must not be tested through IN (NULL)");
assert.match(plan, /and\(importedOnly,\s*inArray\(historicalOperationImportsTable\.sourceKey, sourceKeys\)\)/s, "explicit source keys must still be restricted to imported rows");
assert.match(plan, /limit \?\? MAX_PLAN_LIMIT/, "default scans must be capped");
assert.match(plan, /missingRequestedSourceKeys/, "missing or ineligible explicit source keys must be surfaced");
assert.match(plan, /invalid_import_backlink/, "missing import backlinks must fail closed into an explicit classification");
assert.match(plan, /row\.importedOperationId === null \|\| !operationById\.has\(row\.importedOperationId\)/, "NULL and dangling operation backlinks must both be blocked");
assert.match(plan, /databaseWrites:\s*false/, "PLAN must advertise zero database writes");
assert.match(plan, /customerWrites:\s*false/, "PLAN must advertise zero customer writes");
assert.match(plan, /operationWrites:\s*false/, "PLAN must advertise zero operation writes");
assert.match(plan, /Production ortaminda historical customer resolution calistirilamaz/, "production execution must remain blocked");
assert.match(classifier, /candidates\.length === 1/, "only one exact normalized-name candidate may be classified as unique");
assert.match(classifier, /candidates\.length > 1/, "multiple exact matches must remain ambiguous");
assert.doesNotMatch(classifier, /levenshtein|similarity|fuzzy/i, "classifier must not introduce fuzzy auto-linking");
assert.equal(
  apiPackage.scripts["historical:customer-resolution-plan"],
  "tsx src/historical-customer-resolution-plan.ts",
  "API package must expose the read-only PLAN command",
);

console.log("historical customer resolution focused tests: PASS");
