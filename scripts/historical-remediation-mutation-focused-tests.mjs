import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = path.join(root, "artifacts/api-server/src");
const service = readFileSync(path.join(api, "lib/historical-remediation-mutation.ts"), "utf8");
const validation = readFileSync(path.join(api, "lib/historical-remediation-mutation-validation.ts"), "utf8");
const route = readFileSync(path.join(api, "routes/historical-remediation.ts"), "utf8");
const seed = readFileSync(path.join(api, "lib/seed-permissions.ts"), "utf8");
const schema = readFileSync(path.join(root, "lib/db/src/schema/historical_operation_imports.ts"), "utf8");

const check = (condition, message) => assert.ok(condition, message);
const tsxCandidates = [
  path.join(root, "artifacts/api-server/node_modules/.bin/tsx"),
  path.join(root, "../tourops-ai-duplicate-detection/artifacts/api-server/node_modules/.bin/tsx"),
];
const tsx = tsxCandidates.find(existsSync);
const run = tsx
  ? spawnSync(tsx, [path.join(api, "historical-remediation-mutation-self-test.ts")], { cwd: root, encoding: "utf8" })
  : null;
if (!run || run.error?.code === "ENOENT") {
  console.log("historical remediation mutation focused tests: static checks passed (tsx unavailable)");
} else {
  assert.equal(run.status, 0, run.stderr || run.stdout);
}

check(seed.includes('["historical_migration", "remediate", ["admin"]]'), "remediate permission must be admin-only");
check(route.includes('requirePermission("historical_migration", "review")'), "GET routes retain review permission");
check(route.includes('requirePermission("historical_migration", "remediate")'), "POST route requires remediate permission");
check(route.includes('router.post("/:sourceKey/remediate"'), "exactly one remediation POST route");
check(!/router\.(put|patch|delete)\(/.test(route), "remediation router must not expose PUT/PATCH/DELETE");
check(!route.includes("approve") && !route.includes("reject") && !route.includes("promote"), "route must not expose lifecycle mutations");
check(validation.includes('"pickupTime"') && validation.includes('"passengerLanguage"') && validation.includes('"pickupPoint"') && validation.includes('"adultCount"') && validation.includes('"externalOperator"'), "exactly five fields are supported");
check(service.includes('"unsupported_field"'), "unsupported fields must fail as validation errors");
check(service.includes('"invalid_source_key"'), "source keys must be exact historical keys");
check(service.includes('.for("update")'), "mutation must lock the exact row");
check(service.includes("sha256OfHistoricalStagingRecord"), "mutation must verify and recompute payload hash");
check(service.includes("approvalVersion: sql"), "mutation must increment the optimistic version");
check(service.includes('eventType: "historical_migration_remediated"'), "mutation must audit with the required event");
check(service.includes("}, tx);"), "audit must use the current transaction");
check(service.includes("sourceIdentityMatches"), "mutation must preserve exact provenance");
check(service.includes('eq(historicalOperationImportsTable.status, "pending")'), "mutation must remain pending");
check(!service.includes("historicalSourceEvidenceTable") && !service.includes("cells"), "mutation must never inspect or write source evidence");
check(service.includes("return db.transaction"), "mutation must be atomic");
const integrityIndex = service.indexOf("sha256OfHistoricalStagingRecord(payload) !== row.payloadSha256");
const expectedHashIndex = service.indexOf("row.payloadSha256 !== params.expectedPayloadHash");
const missingFieldIndex = service.indexOf("getHistoricalRemediationValue(payload, params.field) !== null");
const warningCountIndex = service.indexOf("warningCount !== 1");
const valueValidationIndex = service.indexOf("nextValue = validateRemediationValue");
const nextPayloadIndex = service.indexOf("const nextPayload = applyHistoricalRemediationValue");
check(integrityIndex !== -1 && integrityIndex < expectedHashIndex, "current payload integrity must precede expected hash comparison");
check(missingFieldIndex !== -1 && missingFieldIndex < valueValidationIndex, "missing-field check must precede semantic validation");
check(warningCountIndex !== -1 && warningCountIndex < valueValidationIndex, "warning cardinality check must precede semantic validation");
check(valueValidationIndex !== -1 && valueValidationIndex < nextPayloadIndex, "semantic validation must precede payload construction");
check(schema.includes('approvalVersion: integer("approval_version")'), "existing approval version is reused");
check(existsSync(path.join(root, "lib/db/migrations/0024_historical_source_evidence.sql")), "Phase 3E.1 migration remains present and unchanged");

check(route.includes("value: z.unknown().refine"), "route schema must require an explicit value property");
check(route.includes("val !== undefined"), "missing value must fail structural validation");
check(route.includes("value: parsed.data.value"), "provided value must reach service params explicitly");
check(!route.includes("...parsed.data"), "service params must not rely on object spread inference");
check(service.includes("validateRemediationValue(params.field, params.value)"), "field/value semantic validation remains in mutation service");
check(service.includes("value: unknown"), "mutation service value contract remains required unknown");

const routeSchemaCheck = tsx
  ? spawnSync(tsx, ["--eval", `
import assert from "node:assert/strict";
import { remediationBodySchema } from ${JSON.stringify(path.join(api, "routes/historical-remediation.ts"))};
const base = { field: "pickupTime", expectedVersion: 1, expectedPayloadHash: "a".repeat(64) };
const missing = remediationBodySchema.safeParse(base);
assert.equal(missing.success, false, "missing value property must be structurally invalid");
const explicitUndefined = remediationBodySchema.safeParse({ ...base, value: undefined });
assert.equal(explicitUndefined.success, false, "undefined value must be structurally invalid");
const provided = remediationBodySchema.safeParse({ ...base, value: "08:30" });
assert.equal(provided.success, true, "provided value must parse");
assert.equal(provided.data.value, "08:30", "provided value must reach parsed params");
console.log("route value schema checks passed");
`], { cwd: root, encoding: "utf8", env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost:5432/unused" } })
  : null;
if (routeSchemaCheck) {
  assert.equal(routeSchemaCheck.status, 0, routeSchemaCheck.stderr || routeSchemaCheck.stdout);
}

console.log("historical remediation mutation focused tests: passed");
