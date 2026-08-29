import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLI = readFileSync(new URL("../artifacts/api-server/src/historical-pending-inspect.ts", import.meta.url), "utf8");
const API_PACKAGE = JSON.parse(readFileSync(new URL("../artifacts/api-server/package.json", import.meta.url), "utf8"));

assert.equal(API_PACKAGE.scripts["historical:pending-inspect"], "tsx src/historical-pending-inspect.ts");
assert.match(CLI, /DEFAULT_PENDING_INSPECT_LIMIT = 20/);
assert.match(CLI, /MAX_PENDING_INSPECT_LIMIT = 100/);
assert.match(CLI, /limit < 1 \|\| limit > MAX_PENDING_INSPECT_LIMIT/);
assert.match(CLI, /args\.length !== 2 \|\| args\[0\] !== "--limit"/);

assert.match(CLI, /HISTORICAL_STAGING_DATABASE_URL/);
assert.match(CLI, /HISTORICAL_STAGING_DATABASE_HOST/);
assert.match(CLI, /env\.NODE_ENV === "production"/);
assert.match(CLI, /\["postgres:", "postgresql:"\]/);
assert.match(CLI, /url\.hostname !== allowedHost \|\| !allowedHost\.endsWith\("\.neon\.tech"\)/);
assert.doesNotMatch(CLI, /process\.env\.DATABASE_URL\s*\?\?/);

assert.match(CLI, /const pendingOnly = eq\(historicalOperationImportsTable\.status, "pending"\)/);
assert.equal((CLI.match(/\.where\(pendingOnly\)/g) ?? []).length, 2, "count and detail queries must both be pending-only");
assert.match(CLI, /\.orderBy\(\s*historicalOperationImportsTable\.operationDate,\s*historicalOperationImportsTable\.sourceFileId,\s*historicalOperationImportsTable\.worksheetName,\s*historicalOperationImportsTable\.sourceRow,\s*historicalOperationImportsTable\.id,/s);
assert.match(CLI, /\.limit\(limit\)/);
assert.doesNotMatch(CLI, /\.select\(\)\.from\(historicalOperationImportsTable\)/);

for (const flag of ["databaseWrites", "customerWrites", "operationWrites"]) {
  assert.match(CLI, new RegExp(`${flag}: false`), `${flag} must be explicitly false`);
}
assert.match(CLI, /mode: "historical-pending-inspect"/);
assert.doesNotMatch(CLI, /\.insert\(|\.update\(|\.delete\(|\.onConflict/i, "inspection CLI must not contain a write path");
assert.doesNotMatch(CLI, /customersTable|customerId|approve|reject|promote|fuzzy|similarity|levenshtein/i, "inspection CLI must not resolve or mutate customers/operations");
assert.doesNotMatch(CLI, /payload:\s*row\.payload/, "raw payload must not be returned in review details");

execFileSync(
  "./artifacts/api-server/node_modules/.bin/tsx",
  ["artifacts/api-server/src/historical-pending-inspect-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical pending inspect focused tests: passed");
