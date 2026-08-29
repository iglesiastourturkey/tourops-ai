import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLI = readFileSync(new URL("../artifacts/api-server/src/historical-migration-promote.ts", import.meta.url), "utf8");
const VALIDATION = readFileSync(new URL("../artifacts/api-server/src/lib/historical-migration-promote-validation.ts", import.meta.url), "utf8");
const APPROVAL = readFileSync(new URL("../artifacts/api-server/src/lib/historical-migration-approval.ts", import.meta.url), "utf8");
const OPERATOR = readFileSync(new URL("../artifacts/api-server/src/lib/historical-migration-operator.ts", import.meta.url), "utf8");
const REVIEW_CLI = readFileSync(new URL("../artifacts/api-server/src/historical-migration-review-action.ts", import.meta.url), "utf8");
const AUDIT = readFileSync(new URL("../artifacts/api-server/src/lib/audit.ts", import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../lib/db/src/schema/historical_operation_imports.ts", import.meta.url), "utf8");
const MIGRATION = readFileSync(new URL("../lib/db/migrations/0020_historical_promotion_approval.sql", import.meta.url), "utf8");
const SEED_PERMISSIONS = readFileSync(new URL("../artifacts/api-server/src/lib/seed-permissions.ts", import.meta.url), "utf8");
const STAGE_MIGRATION = readFileSync(new URL("../lib/db/migrations/0019_historical_operation_staging.sql", import.meta.url), "utf8");

// ── CLI env/host/confirmation gates (mirrors historical-migration-staging-focused-tests.mjs) ──
assert.ok(/HISTORICAL_STAGING_DATABASE_URL/.test(CLI) && /HISTORICAL_STAGING_DATABASE_HOST/.test(CLI), "CLI must use the dedicated staging connection and exact host allowlist");
assert.ok(!/DATABASE_URL\s*\?\?=.*process\.env\.DATABASE_URL/.test(CLI), "CLI must not fall back to a plain DATABASE_URL");
assert.ok(/process\.env\.NODE_ENV === "production"/.test(CLI), "CLI must refuse production mode");
assert.ok(/function validatePromotionTarget/.test(CLI), "CLI must validate its target before connecting");
assert.ok(/TOURPILOT_2026_HISTORICAL_PROMOTION/.test(CLI), "CLI must require the exact promotion confirmation phrase");
assert.ok(/\.endsWith\("\.neon\.tech"\)/.test(CLI), "CLI must restrict writes to Neon hosts");
assert.ok(/pg_advisory_xact_lock\(2026, 4\)/.test(CLI), "CLI must use an advisory lock key distinct from Phase 3C staging's (2026, 3)");
assert.ok(!/pg_advisory_xact_lock\(2026, 3\)/.test(CLI), "promotion must not reuse Phase 3C's staging lock key");

// ── Targeting restrictions ────────────────────────────────────────────────────
assert.ok(/--source-key veya --limit zorunludur/.test(CLI), "apply without --source-key/--limit must be rejected");
assert.ok(/MAX_APPLY_LIMIT = 25/.test(CLI), "apply must have a documented, reasonable hard maximum for --limit");
assert.ok(/limit > MAX_APPLY_LIMIT/.test(CLI) && /sourceKeys\.length > MAX_APPLY_LIMIT/.test(CLI), "both --limit and --source-key count must be capped");

// ── Per-record transactions, not one batch transaction ───────────────────────
assert.ok(/for \(const sourceKey of sourceKeys\)/.test(CLI), "apply must loop per record");
const applyPromotionBody = CLI.slice(CLI.indexOf("async function applyPromotion"), CLI.indexOf("async function main"));
assert.ok(applyPromotionBody.includes("for (const sourceKey"), "applyPromotion must contain the per-record loop");
assert.ok(!applyPromotionBody.includes("db.transaction"), "applyPromotion must not wrap the per-record loop in a single batch transaction - each record's own transaction lives inside promoteOne");
assert.ok(/attempted:\s*0.*inserted:\s*0.*existing:\s*0.*conflicts:\s*0.*blocked:\s*0.*failed:\s*0/s.test(CLI), "batch summary must report attempted/inserted/existing/conflicts/blocked/failed");

// ── State machine ─────────────────────────────────────────────────────────────
assert.ok(/approve: new Set\(\["pending"\]\)/.test(VALIDATION), "approve must only be allowed from pending");
assert.ok(/reject: new Set\(\["pending"\]\)/.test(VALIDATION), "reject must only be allowed from pending");
assert.ok(/promote: new Set\(\["approved"\]\)/.test(VALIDATION), "promote must only be allowed from approved");

// ── Payload integrity + conflict = fail closed, never overwrite ──────────────
assert.ok(/verifyStagedPayloadIntegrity/.test(CLI), "promotion must verify payload_sha256 before promoting");
assert.ok(/PromotionRollback/.test(CLI), "a payload mismatch or content conflict must roll back the record's transaction");
assert.ok(/outcome === "conflict"/.test(CLI), "promotion must detect the conflict case explicitly");
assert.ok(!/tx\.update\(operationsTable\)/.test(CLI), "promotion must never UPDATE an existing operation - insert-or-nothing only");

// ── Customer / master-data safety ─────────────────────────────────────────────
assert.ok(!/customersTable/.test(CLI) && !/customersTable/.test(VALIDATION), "Faz 3D-A must not touch the customers table at all");
assert.ok(/customerId: null/.test(VALIDATION), "the target promotion projection must always set customerId to null");
for (const fk of ["tourId", "portCallId", "tourProductId", "guideResourceId", "driverResourceId", "vehicleId"]) {
  assert.ok(new RegExp(`${fk}: null`).test(VALIDATION), `the target promotion projection must always set ${fk} to null`);
}
assert.ok(!/tx\.insert\(operationsTable\)\.values\(\{[^}]*customerId/.test(CLI), "the operation insert must never set customerId");

// ── Audit atomicity ────────────────────────────────────────────────────────────
assert.ok(/const strict = executor !== db/.test(AUDIT), "createAuditLog must support a strict, non-swallowing mode for an active transaction");
assert.ok(/if \(strict\) throw error/.test(AUDIT), "a strict-mode audit failure must propagate and roll back its transaction");
assert.ok(/createAuditLog\(\{[\s\S]*?\}, tx\)/.test(CLI), "the successful-promotion audit must be written with the active transaction, not after commit");
assert.ok(/createAuditLog\(\{[\s\S]*?\}, tx\)/.test(APPROVAL), "approve/reject audit rows must be written with the active transaction");

// ── RBAC ───────────────────────────────────────────────────────────────────────
for (const action of ["review", "approve", "reject", "promote"]) {
  assert.ok(
    new RegExp(`\\["historical_migration", "${action}",\\s*\\["admin"\\]\\]`).test(SEED_PERMISSIONS),
    `historical_migration.${action} must be seeded as admin-only`,
  );
}
assert.ok(/historicalImportTransitionBlock/.test(APPROVAL), "approve/reject services must enforce the same state machine as promotion");
assert.ok(/\.for\("update"\)/.test(APPROVAL), "approve/reject must lock the row to guard against a concurrent race");
assert.ok(/approvalVersion,\s*row\.approvalVersion/.test(APPROVAL) || /eq\(historicalOperationImportsTable\.approvalVersion, row\.approvalVersion\)/.test(APPROVAL), "approve/reject must use approval_version as a compare-and-swap token");

// ── Migration 0020 / schema ────────────────────────────────────────────────────
for (const column of [
  "approved_by_operator_id", "approved_at", "rejected_by_operator_id", "rejected_at",
  "rejection_reason", "imported_operation_id", "imported_at", "last_error",
  "review_notes", "approval_version", "promoted_content_sha256",
]) {
  assert.ok(MIGRATION.includes(column), `migration 0020 must add ${column}`);
}
assert.ok(/REFERENCES profiles\(id\)/.test(MIGRATION), "approver/rejecter columns must reference profiles(id) - verified as the actual integer PK type");
assert.ok(/REFERENCES operations\(id\)/.test(MIGRATION), "imported_operation_id must reference operations(id) - verified as the actual integer PK type");
assert.ok(/NOT APPLIED/.test(MIGRATION), "migration 0020 must document that it has not been applied anywhere");
assert.ok(!/DROP TABLE|DROP COLUMN|TRUNCATE/i.test(MIGRATION), "migration 0020 must contain no destructive statements");
assert.ok(/approvedByOperatorId: integer\("approved_by_operator_id"\)\.references\(\(\) => profilesTable\.id\)/.test(SCHEMA), "Drizzle schema must mirror the migration's approver FK");
assert.ok(/importedOperationId: integer\("imported_operation_id"\)\.references\(\(\) => operationsTable\.id\)/.test(SCHEMA), "Drizzle schema must mirror the migration's imported-operation FK");

// Phase 3C must remain untouched by this phase.
assert.ok(/NOT APPLIED/.test(STAGE_MIGRATION) && /Neon staging branch first/.test(STAGE_MIGRATION), "Phase 3C migration 0019 must remain unmodified");

// ── Required change 2: server-side operator verification, no second RBAC system ──
assert.ok(/import { hasPermission } from "\.\/permissions"/.test(OPERATOR), "operator verification must reuse the existing hasPermission() policy, not invent a second RBAC system");
assert.ok(/if \(!profile\)/.test(OPERATOR) && /operator_not_found/.test(OPERATOR), "a nonexistent operator profile must be rejected");
assert.ok(/!profile\.isActive/.test(OPERATOR) && /operator_inactive/.test(OPERATOR), "an inactive operator profile must be rejected");
assert.ok(/hasPermission\(profile\.id, profile\.role, module, action\)/.test(OPERATOR), "operator verification must check the requested (module, action) via hasPermission()");
assert.ok(/forbidden/.test(OPERATOR), "an operator lacking the permission must be rejected");

// approve()/reject() must call verifyOperatorPermission with the correct action before any write.
assert.ok(/verifyOperatorPermission\(params\.actorProfileId, "historical_migration", "approve"\)/.test(APPROVAL), "approveHistoricalImport must verify historical_migration.approve before writing");
assert.ok(/verifyOperatorPermission\(params\.actorProfileId, "historical_migration", "reject"\)/.test(APPROVAL), "rejectHistoricalImport must verify historical_migration.reject before writing");
// The verification must gate execution (an early return), not just be called and ignored.
const approveFnBody = APPROVAL.slice(APPROVAL.indexOf("export async function approveHistoricalImport"), APPROVAL.indexOf("export async function rejectHistoricalImport"));
assert.ok(/if \(!verification\.ok\) return verification;/.test(approveFnBody), "approveHistoricalImport must return early when the operator is not verified");
const rejectFnBody = APPROVAL.slice(APPROVAL.indexOf("export async function rejectHistoricalImport"));
assert.ok(/if \(!verification\.ok\) return verification;/.test(rejectFnBody), "rejectHistoricalImport must return early when the operator is not verified");

// ── Required change 6/7: approve/reject audit rows carry the operator ────────
assert.ok(/actorProfileId: params\.actorProfileId/.test(approveFnBody), "the approval audit event must carry the operator's actorProfileId");
assert.ok(/actorProfileId: params\.actorProfileId/.test(rejectFnBody), "the rejection audit event must carry the operator's actorProfileId");
assert.ok(/approvedByOperatorId: params\.actorProfileId/.test(approveFnBody), "approval must persist approved_by_operator_id");
assert.ok(/rejectedByOperatorId: params\.actorProfileId/.test(rejectFnBody), "rejection must persist rejected_by_operator_id");

// ── Required change 3: promotion apply requires and verifies an operator ────
assert.ok(/operatorProfileId === null/.test(CLI) && /Apply modu icin --operator-profile-id zorunludur/.test(CLI), "apply without --operator-profile-id must be rejected");
assert.ok(/verifyOperatorPermission\(operatorProfileId, "historical_migration", "promote"\)/.test(CLI), "promotion apply must verify historical_migration.promote before writing");
assert.ok(!/promoteOne\(sourceKey, null\)/.test(CLI), "applyPromotion must no longer pass a null actor to promoteOne");
assert.ok(/promoteOne\(sourceKey, operatorProfileId\)/.test(CLI), "applyPromotion must thread the verified operator through to promoteOne");
// operator verification must run before the batch, not be skippable per-record.
const mainFnBody = CLI.slice(CLI.indexOf("async function main"));
assert.ok(mainFnBody.indexOf("verifyOperatorPermission") < mainFnBody.indexOf("applyPromotion(targetKeys"), "operator verification must happen before the promotion batch runs");

// ── Required change 1: dedicated single-record review CLI, no bulk path ─────
assert.ok(/HISTORICAL_STAGING_DATABASE_URL/.test(REVIEW_CLI) && /HISTORICAL_STAGING_DATABASE_HOST/.test(REVIEW_CLI), "review CLI must use the dedicated staging connection and exact host allowlist");
assert.ok(/process\.env\.NODE_ENV === "production"/.test(REVIEW_CLI), "review CLI must refuse production mode before connecting");
assert.ok(/TOURPILOT_2026_HISTORICAL_REVIEW/.test(REVIEW_CLI), "review CLI must require the exact review confirmation phrase");
assert.ok(/\.endsWith\("\.neon\.tech"\)/.test(REVIEW_CLI), "review CLI must restrict writes to Neon hosts");
assert.ok(/sourceKeys\.length !== 1/.test(REVIEW_CLI), "review CLI must accept exactly one --source-key (no bulk approval/rejection path)");
assert.ok(!/optionAll\(args, "--approve"\)/.test(REVIEW_CLI), "there must be no way to pass multiple approve targets");
assert.ok(/approve === reject/.test(REVIEW_CLI), "review CLI must require exactly one of --approve/--reject");
assert.ok(/reject && !reason\?\.trim\(\)/.test(REVIEW_CLI), "review CLI must require a non-empty --reason for --reject");
assert.ok(/if \(!operatorRaw\)/.test(REVIEW_CLI), "review CLI must refuse a missing --operator-profile-id");
assert.ok(/if \(!parsed\.confirmed\)/.test(REVIEW_CLI), "review CLI must refuse to write without the exact confirmation phrase");
assert.ok(/await approveHistoricalImport\(/.test(REVIEW_CLI) && /await rejectHistoricalImport\(/.test(REVIEW_CLI), "review CLI must reuse the existing approval service, not duplicate its logic");
// The confirmation check (zero writes) must run before the CLI ever imports @workspace/db.
const reviewMainBody = REVIEW_CLI.slice(REVIEW_CLI.indexOf("async function main"));
assert.ok(
  reviewMainBody.indexOf("if (!parsed.confirmed)") < reviewMainBody.indexOf('import("@workspace/db")'),
  "a wrong/missing confirmation phrase must make zero writes - checked before any DB import",
);

for (const forbidden of ["googleapis", "google-auth-library", "fetch(", "axios", "webhook"]) {
  assert.ok(
    !CLI.includes(forbidden) && !VALIDATION.includes(forbidden) && !APPROVAL.includes(forbidden)
      && !OPERATOR.includes(forbidden) && !REVIEW_CLI.includes(forbidden),
    `historical promotion code must not contain ${forbidden}`,
  );
}

execFileSync(
  "pnpm",
  ["--filter", "@workspace/api-server", "exec", "tsx", "src/historical-migration-promote-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical migration Phase 3D-A promotion focused tests: passed");
