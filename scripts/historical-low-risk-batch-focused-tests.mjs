import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER = readFileSync(new URL("../artifacts/api-server/src/historical-migration-low-risk-batch.ts", import.meta.url), "utf8");
const APPROVAL = readFileSync(new URL("../artifacts/api-server/src/lib/historical-migration-approval.ts", import.meta.url), "utf8");

assert.ok(/MAX_BATCH = 25/.test(RUNNER), "batch runner must hard-cap approvals at 25");
assert.ok(/missing_agency/.test(RUNNER) && /missing_child_count/.test(RUNNER), "runner must define the explicit low-risk warning allowlist");
assert.ok(/warnings\} <@/.test(RUNNER) || /warnings\} <@/.test(RUNNER.replaceAll("\n", "")), "candidate query must use a warnings containment gate");
assert.ok(/status, "pending"/.test(RUNNER), "runner must select pending rows only");
assert.ok(/process\.env\.NODE_ENV === "production"/.test(RUNNER), "runner must refuse production mode");
assert.ok(/HISTORICAL_STAGING_DATABASE_URL/.test(RUNNER) && /HISTORICAL_STAGING_DATABASE_HOST/.test(RUNNER), "runner must require the dedicated staging connection and host allowlist");
assert.ok(/\.endsWith\("\.neon\.tech"\)/.test(RUNNER), "runner must restrict target hosts to Neon");
assert.ok(/TOURPILOT_2026_HISTORICAL_LOW_RISK_APPROVAL/.test(RUNNER), "write mode must require an exact dedicated confirmation phrase");
assert.ok(/if \(!apply\)/.test(RUNNER) && /databaseWrites: false/.test(RUNNER), "default mode must be plan-only with zero writes");
assert.ok(/--approve-batch/.test(RUNNER), "writes must require an explicit approve-batch switch");
assert.ok(/verifyOperatorPermission\(operatorProfileId as number, "historical_migration", "approve"\)/.test(RUNNER), "runner must verify approve permission before the batch loop");
assert.ok(/allowedWarnings: LOW_RISK_WARNINGS/.test(RUNNER), "each approval must pass the low-risk warning allowlist to the locked-row service");
assert.ok(/failed\.push/.test(RUNNER) && /break;/.test(RUNNER), "runner must stop on the first failed approval");

assert.ok(/allowedWarnings\?: readonly string\[\]/.test(APPROVAL), "approval service must support a locked-row warning allowlist");
assert.ok(/const disallowed = warnings\.filter/.test(APPROVAL), "approval service must re-check warnings while the row is locked");
assert.ok(/if \(disallowed\.length > 0\)/.test(APPROVAL), "approval service must fail closed on a changed warning profile");
assert.ok(/\.for\("update"\)/.test(APPROVAL), "locked-row warning validation must remain inside the approval transaction");

console.log("historical low-risk batch focused tests: PASS");
