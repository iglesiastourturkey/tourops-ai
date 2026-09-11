import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROD = readFileSync(new URL("../artifacts/api-server/src/historical-pickup-time-correction-production.ts", import.meta.url), "utf8");
const CLI = readFileSync(new URL("../artifacts/api-server/src/historical-pickup-time-correction.ts", import.meta.url), "utf8");
const VALIDATION = readFileSync(new URL("../artifacts/api-server/src/lib/historical-pickup-time-correction.ts", import.meta.url), "utf8");

// --- production-only target: never staging fallback, never logs ---
assert.match(PROD, /PRODUCTION_DATABASE_URL/);
assert.match(PROD, /validateProductionPickupTimeCorrectionTarget/);
assert.match(VALIDATION, /PRODUCTION_DATABASE_URL/);
assert.match(VALIDATION, /PRODUCTION_DATABASE_HOST/);
assert.match(PROD, /validateProductionPickupTimeCorrectionTarget\(\)/);
assert.match(VALIDATION, /NODE_ENV !== "production"/);
assert.doesNotMatch(PROD, /HISTORICAL_STAGING_DATABASE_URL/);
assert.doesNotMatch(PROD, /console\.log\(.*[Cc]onnection[Ss]tring|console\.log\(connectionString/);

// --- production confirmation + limits + permission ---
assert.match(PROD, /TOURPILOT_2026_PRODUCTION_PICKUP_CORRECTION/);
assert.doesNotMatch(PROD, /TOURPILOT_2026_HISTORICAL_PICKUP_CORRECTION/);
assert.match(PROD, /MAX_APPLY_LIMIT = 25/);
assert.match(PROD, /tam olarak --source-key veya --limit zorunludur/);
assert.match(PROD, /--operator-profile-id zorunludur/);
assert.match(PROD, /verifyOperatorPermission\([\s\S]*?"historical_migration",\s*"pickup_time_correct"/);
assert.doesNotMatch(PROD, /"historical_migration", "promote"|"promote"/);

// --- PLAN output contract: full candidate inspection, read-only ---
assert.match(PROD, /recordsInPackage/);
assert.match(PROD, /inspected/);
assert.match(PROD, /\.\.\.plan/);
assert.match(PROD, /requiresApplyConfirmation: true/);
// planHistoricalPickupTimeCorrection returns { classifications, assessments }.
assert.match(CLI, /const classifications: Record<string, number>/);
assert.match(CLI, /return \{ classifications, assessments \}/);
assert.match(PROD, /mode: "historical-pickup-time-correction-production-plan"/);
assert.match(PROD, /databaseWrites: false/);
assert.match(PROD, /operationWrites: false/);
assert.match(PROD, /customerWrites: false/);
assert.match(PROD, /mode: "historical-pickup-time-correction-production-apply"/);
assert.doesNotMatch(PROD, /customersTable|insert\(customers|update\(customers|delete\(customers|reservationsTable|bookingPartiesTable/);
for (const forbidden of ["googleapis", "google-auth-library", "fetch(", "axios", "webhook"]) {
  assert.ok(!PROD.includes(forbidden), `production runner must not contain ${forbidden}`);
}

// --- reuse, not duplication: shared core + shared helpers ---
assert.match(PROD, /from "\.\/historical-pickup-time-correction"/);
assert.match(PROD, /planHistoricalPickupTimeCorrection/);
assert.match(PROD, /applyHistoricalPickupTimeCorrection/);
assert.match(PROD, /selectedCandidates/);
assert.match(PROD, /parseHistoricalPickupTimeCorrectionPackage/);
assert.match(PROD, /validateProductionPickupTimeCorrectionTarget/);
assert.doesNotMatch(PROD, /assessHistoricalPickupTimeCorrection|correctedPayload|pg_advisory_xact_lock/);

// --- permission gate placement: PLAN needs none, APPLY verifies first ---
const mainBody = PROD.slice(PROD.indexOf("async function main"));
const planBody = mainBody.slice(mainBody.indexOf("if (!args.apply)"), mainBody.indexOf("const { verifyOperatorPermission"));
assert.doesNotMatch(planBody, /verifyOperatorPermission/, "PLAN must not require a permission check");
assert.ok(
  mainBody.indexOf("if (!verification.ok) throw new Error(verification.message)")
    < mainBody.indexOf("applyHistoricalPickupTimeCorrection(candidates"),
  "permission failure must stop APPLY before the correction mutation path",
);

// --- shared core exports the reuse surface; staging guard intact ---
assert.match(CLI, /export async function planHistoricalPickupTimeCorrection/);
assert.match(CLI, /export async function applyHistoricalPickupTimeCorrection/);
assert.match(CLI, /export function selectedCandidates/);
assert.match(CLI, /TOURPILOT_2026_HISTORICAL_PICKUP_CORRECTION/);
assert.match(VALIDATION, /export function validateProductionPickupTimeCorrectionTarget/);
assert.match(VALIDATION, /export function validateHistoricalPickupTimeCorrectionTarget/);

execFileSync(
  "./artifacts/api-server/node_modules/.bin/tsx",
  ["artifacts/api-server/src/historical-pickup-time-correction-production-self-test.ts"],
  { stdio: "inherit" },
);
execFileSync(
  "./artifacts/api-server/node_modules/.bin/tsx",
  ["artifacts/api-server/src/historical-pickup-time-correction-self-test.ts"],
  { stdio: "inherit" },
);
execFileSync(
  "./artifacts/api-server/node_modules/.bin/tsx",
  ["artifacts/api-server/src/historical-pickup-time-correction-package-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical production pickup-time correction focused tests: passed");
