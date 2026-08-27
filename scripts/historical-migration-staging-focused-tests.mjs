import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLI = readFileSync(new URL("../artifacts/api-server/src/historical-migration-stage.ts", import.meta.url), "utf8");
const VALIDATION = readFileSync(new URL("../artifacts/api-server/src/lib/historical-migration-stage-validation.ts", import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../lib/db/src/schema/historical_operation_imports.ts", import.meta.url), "utf8");
const OPERATIONS = readFileSync(new URL("../lib/db/src/schema/operations.ts", import.meta.url), "utf8");
const MIGRATION = readFileSync(new URL("../lib/db/migrations/0019_historical_operation_staging.sql", import.meta.url), "utf8");

assert.ok(/HISTORICAL_STAGING_DATABASE_URL/.test(CLI) && /HISTORICAL_STAGING_DATABASE_HOST/.test(CLI), "loader must use a dedicated staging connection and exact host allowlist");
assert.ok(/process\.env\.NODE_ENV === "production"/.test(CLI), "loader must refuse production mode");
assert.ok(/TOURPILOT_2026_HISTORICAL_STAGE/.test(CLI), "loader must require the exact staging confirmation phrase");
assert.ok(/\.endsWith\("\.neon\.tech"\)/.test(CLI), "loader must restrict writes to Neon hosts");
assert.ok(/pg_advisory_xact_lock/.test(CLI), "loader must serialize concurrent staging runs");
assert.ok(/storedHash !== row\.payloadSha256/.test(CLI), "same sourceKey with changed content must abort");
assert.ok(/onConflictDoNothing\(\{ target: historicalOperationImportsTable\.sourceKey \}\)/.test(CLI), "same sourceKey with identical content must be a no-op");
assert.ok(!/operationsTable|customersTable|accountingTransactions/.test(CLI), "Phase 3C loader must not write operational tables");

assert.ok(/uniqueIndex\("historical_operation_imports_source_key_idx"\)/.test(SCHEMA), "staging sourceKey must be unique in the Drizzle schema");
assert.ok(/historicalImportUnique: uniqueIndex\("operations_source_historical_key_idx"\)/.test(OPERATIONS), "future operation import must have a DB unique key");
assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS historical_operation_imports_source_key_idx/.test(MIGRATION), "migration must create the staging sourceKey unique index");
assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS historical_operation_imports_provenance_idx/.test(MIGRATION), "migration must independently protect file/sheet/row provenance");
assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS operations_source_historical_key_idx/.test(MIGRATION), "migration must protect future operation writes");
assert.ok(/NOT APPLIED/.test(MIGRATION) && /Neon staging branch first/.test(MIGRATION), "migration must document the manual staging gate");

for (const forbidden of ["googleapis", "google-auth-library", "fetch(", "axios", "webhook"]) {
  assert.ok(!CLI.includes(forbidden) && !VALIDATION.includes(forbidden), `staging loader must not contain ${forbidden}`);
}

execFileSync(
  "pnpm",
  ["--filter", "@workspace/api-server", "exec", "tsx", "src/historical-migration-stage-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical migration staging focused tests: passed");
