import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLI = readFileSync(new URL("../artifacts/api-server/src/historical-pickup-time-correction.ts", import.meta.url), "utf8");
const VALIDATION = readFileSync(new URL("../artifacts/api-server/src/lib/historical-pickup-time-correction.ts", import.meta.url), "utf8");
const STAGING = readFileSync(new URL("../artifacts/api-server/src/lib/historical-migration-stage-validation.ts", import.meta.url), "utf8");
const PROMOTION = readFileSync(new URL("../artifacts/api-server/src/lib/historical-migration-promote-validation.ts", import.meta.url), "utf8");
const AUDIT = readFileSync(new URL("../artifacts/api-server/src/lib/audit.ts", import.meta.url), "utf8");
const API_PACKAGE = JSON.parse(readFileSync(new URL("../artifacts/api-server/package.json", import.meta.url), "utf8"));

assert.equal(API_PACKAGE.scripts["historical:pickup-time-correction"], "tsx src/historical-pickup-time-correction.ts");
assert.match(VALIDATION, /\^1899-12-30T/);
assert.ok(VALIDATION.includes(":00\\.000Z$"), "sentinel must require exact zero seconds/milliseconds and Z");
assert.match(VALIDATION, /canonicalPickupTimeFromSentinel/);
assert.match(VALIDATION, /payloadSha256Before/);
assert.match(VALIDATION, /payloadSha256After/);
assert.match(VALIDATION, /contentFingerprintBefore/);
assert.match(VALIDATION, /contentFingerprintAfter/);
assert.match(VALIDATION, /newPickupTime oldPickupTime degerinden deterministik/);
assert.match(VALIDATION, /sha256OfHistoricalStagingRecord/);
assert.match(VALIDATION, /buildPromotionProjectionFromStaging/);
assert.match(VALIDATION, /sha256OfProjection/);
assert.match(STAGING, /export function sha256OfHistoricalStagingRecord/);
assert.match(PROMOTION, /export function sha256OfProjection/);

assert.match(VALIDATION, /HISTORICAL_STAGING_DATABASE_URL/);
assert.match(VALIDATION, /HISTORICAL_STAGING_DATABASE_HOST/);
assert.match(VALIDATION, /NODE_ENV === "production"/);
assert.match(VALIDATION, /url\.hostname !== allowedHost \|\| !allowedHost\.endsWith\("\.neon\.tech"\)/);
assert.match(CLI, /TOURPILOT_2026_HISTORICAL_PICKUP_CORRECTION/);
assert.match(CLI, /verifyOperatorPermission\([\s\S]*?"historical_migration",\s*"pickup_time_correct"/);
assert.doesNotMatch(CLI, /verifyOperatorPermission\([\s\S]*?"historical_migration", "promote"/);
assert.doesNotMatch(CLI, /REQUIRED_PERMISSION|requireDedicatedPickupTimeCorrectionPermission|APPLY devre disi/);
assert.match(CLI, /MAX_APPLY_LIMIT = 25/);
assert.match(CLI, /tam olarak --source-key veya --limit zorunludur/);
assert.match(CLI, /--operator-profile-id zorunludur/);
assert.match(CLI, /Desteklenmeyen veya sinirsiz bayrak/);
assert.match(CLI, /pg_advisory_xact_lock\(2026, 6\)/);
assert.doesNotMatch(CLI, /pg_advisory_xact_lock\(2026, [345]\)/);

assert.match(CLI, /\.for\("update"\)/);
assert.match(CLI, /eq\(operationsTable\.pickupTime, candidate\.oldPickupTime\)/);
assert.match(CLI, /\.set\(\{ pickupTime: candidate\.newPickupTime \}\)/);
assert.doesNotMatch(CLI, /customersTable|insert\(customers|update\(customers|delete\(customers/);
assert.match(CLI, /eventType: "historical_pickup_time_corrected"[\s\S]*?\}, tx\)/);
assert.match(AUDIT, /const strict = executor !== db/);
assert.match(CLI, /classification === "already_canonical"\) return "existing"/);
assert.match(CLI, /promotedContentSha256: assessment\.correctedPromotedContentSha256/);
assert.match(CLI, /pendingCorrected/);
assert.match(CLI, /importedCorrected/);
assert.match(CLI, /databaseWrites: summary\.pendingCorrected \+ summary\.importedCorrected > 0/);
assert.match(CLI, /operationWrites: summary\.importedCorrected > 0/);
assert.match(CLI, /databaseWrites: false/);
assert.match(CLI, /operationWrites: false/);
assert.match(CLI, /customerWrites: false/);

const mainBody = CLI.slice(CLI.indexOf("async function main"));
const planBody = mainBody.slice(mainBody.indexOf("if (!args.apply)"), mainBody.indexOf("const { verifyOperatorPermission"));
assert.doesNotMatch(planBody, /verifyOperatorPermission/, "PLAN must not require a permission check");
assert.ok(
  mainBody.indexOf("if (!verification.ok) throw new Error(verification.message)")
    < mainBody.indexOf("applyHistoricalPickupTimeCorrection(candidates"),
  "permission failure must stop APPLY before the correction mutation path",
);

for (const forbidden of ["googleapis", "google-auth-library", "fetch(", "axios", "webhook", "customersTable"]) {
  assert.ok(!CLI.includes(forbidden) && !VALIDATION.includes(forbidden), `correction must not contain ${forbidden}`);
}

execFileSync(
  "./artifacts/api-server/node_modules/.bin/tsx",
  ["artifacts/api-server/src/historical-pickup-time-correction-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical pickup-time correction focused tests: passed");
