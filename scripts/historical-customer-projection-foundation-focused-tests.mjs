import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const IDENTITY = readFileSync(new URL("../artifacts/api-server/src/lib/customer-identity.ts", import.meta.url), "utf8");
const PACKAGE = readFileSync(new URL("../artifacts/api-server/src/lib/historical-customer-projection-package.ts", import.meta.url), "utf8");
const PROD = readFileSync(new URL("../artifacts/api-server/src/historical-customer-projection-production.ts", import.meta.url), "utf8");
const MIGRATION = readFileSync(new URL("../lib/db/migrations/0028_customer_identity_foundation.sql", import.meta.url), "utf8");
const CUSTOMERS_SCHEMA = readFileSync(new URL("../lib/db/src/schema/customers.ts", import.meta.url), "utf8");
const RESERVATIONS_SCHEMA = readFileSync(new URL("../lib/db/src/schema/reservations.ts", import.meta.url), "utf8");
const SEED = readFileSync(new URL("../artifacts/api-server/src/lib/seed-permissions.ts", import.meta.url), "utf8");

// --- single source of truth: no divergent normalization ---
assert.match(IDENTITY, /normalizeCustomerEmail/);
assert.match(IDENTITY, /normalizeCustomerPhone/);
assert.match(IDENTITY, /buildCustomerIdentityKey/);
assert.match(IDENTITY, /identityEvidenceHash/);
assert.match(IDENTITY, /trim\(\)\.toLowerCase\(\)/);
assert.match(IDENTITY, /digits\.length < 7 \|\| digits\.length > 15/);
assert.doesNotMatch(IDENTITY, /fullName|leadGuestName/);
const LEGACY = readFileSync(new URL("../artifacts/api-server/src/lib/historical-customer-projection.ts", import.meta.url), "utf8");
assert.match(LEGACY, /from "\.\/customer-identity"/);
assert.match(LEGACY, /normalizeCustomerEmail/);
assert.match(LEGACY, /normalizeCustomerPhone/);

// --- schema: additive nullable identity + reservation CAS ---
assert.match(CUSTOMERS_SCHEMA, /normalizedPhone: text\("normalized_phone"\)/);
assert.match(CUSTOMERS_SCHEMA, /normalizedEmail: text\("normalized_email"\)/);
assert.match(CUSTOMERS_SCHEMA, /identityKey: text\("identity_key"\)/);
assert.doesNotMatch(CUSTOMERS_SCHEMA, /identityKey: text\("identity_key"\)\.notNull/);
assert.match(RESERVATIONS_SCHEMA, /version: integer\("version"\)\.notNull\(\)\.default\(1\)/);

// --- migration: additive, idempotent, fail-closed uniqueness ---
assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS normalized_phone/);
assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS normalized_email/);
assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS identity_key/);
assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1/);
assert.match(MIGRATION, /customers_identity_key_active_unique/);
assert.match(MIGRATION, /WHERE archived_at IS NULL AND identity_key IS NOT NULL/);
assert.match(MIGRATION, /NOT APPLIED/);
assert.doesNotMatch(MIGRATION, /DROP (TABLE|COLUMN)/i);
assert.doesNotMatch(MIGRATION, /^UPDATE /mi);

// --- package: schema, classifications, no writes ---
assert.match(PACKAGE, /SAFE_REUSE_EXISTING_CUSTOMER/);
assert.match(PACKAGE, /SAFE_CREATE_NEW_CUSTOMER/);
assert.match(PACKAGE, /STALE_EVIDENCE/);
assert.match(PACKAGE, /SOURCE_MISMATCH/);
assert.match(PACKAGE, /MANUAL_REVIEW/);
assert.match(PACKAGE, /NAME_ONLY/);
assert.match(PACKAGE, /MISSING_IDENTITY/);
assert.match(PACKAGE, /CONFLICT_PHONE_EMAIL/);
assert.match(PACKAGE, /CONFLICT_MULTIPLE_EXISTING_CUSTOMERS/);
assert.match(PACKAGE, /CONFLICT_EXISTING_LINK/);
assert.match(PACKAGE, /ALREADY_LINKED/);
assert.match(PACKAGE, /databaseWrites: z\.literal\(false\)/);
assert.doesNotMatch(PACKAGE, /\.(insert|update|delete)\(/);

// --- production runner: guards, permissions, CAS, audit ---
// Production target guard is reused (single source of truth), never duplicated:
// the shared validator requires NODE_ENV=production + PRODUCTION_DATABASE_URL/HOST.
assert.match(PROD, /validateProductionPickupTimeCorrectionTarget/);
assert.match(PROD, /from "\.\/lib\/historical-pickup-time-correction"/);
assert.match(PROD, /const connectionString = validateProductionPickupTimeCorrectionTarget\(\)/);
assert.match(PROD, /TOURPILOT_2026_PRODUCTION_CUSTOMER_PROJECTION/);
assert.match(PROD, /MAX_APPLY_LIMIT = 25/);
assert.match(PROD, /verifyOperatorPermission\([\s\S]*?"historical_migration",\s*"customer_link_projection"/);
assert.match(PROD, /verifyOperatorPermission\([\s\S]*?"historical_migration",\s*"customer_create"/);
assert.doesNotMatch(PROD, /"historical_migration", "promote"/);
assert.match(PROD, /pg_advisory_xact_lock\(hashtext/);
assert.match(PROD, /isNull\(reservationsTable\.customerId\)/);
assert.match(PROD, /historical_customer_created/);
assert.match(PROD, /historical_customer_reused/);
assert.match(PROD, /historical_customer_linked/);
assert.match(PROD, /identityKeyHash/);
assert.doesNotMatch(PROD, /HISTORICAL_STAGING_DATABASE_URL/);
assert.doesNotMatch(PROD, /console\.log\(.*[Cc]onnection[Ss]tring|console\.log\(connectionString/);
assert.match(PROD, /mode: "historical-customer-projection-production-plan"/);
assert.match(PROD, /mode: "historical-customer-projection-production-apply"/);
for (const forbidden of ["googleapis", "google-auth-library", "fetch(", "axios", "webhook"]) {
  assert.ok(!PROD.includes(forbidden), `production runner must not contain ${forbidden}`);
}
// PLAN must not require permission; APPLY verifies before mutation.
const mainBody = PROD.slice(PROD.indexOf("async function main"));
const planBody = mainBody.slice(mainBody.indexOf("if (!args.apply)"), mainBody.indexOf("const { verifyOperatorPermission"));
assert.doesNotMatch(planBody, /verifyOperatorPermission/, "PLAN must not require a permission check");
assert.ok(
  mainBody.indexOf("if (!link.ok) throw new Error(link.message)")
    < mainBody.indexOf("applyCustomerProjection(records"),
  "permission failure must stop APPLY before the mutation path",
);

// --- 1. PLAN is read-only: no write verbs in the PLAN path ---
const planFn = PROD.slice(PROD.indexOf("export async function planCustomerProjection"), PROD.indexOf("async function main"));
assert.doesNotMatch(planFn, /\.(insert|update|delete)\(/);
assert.match(PROD, /mode: "historical-customer-projection-production-plan"[\s\S]{0,400}databaseWrites: false/);

// --- 5. real email/phone/identity DB lanes (never null placeholders) ---
assert.match(planFn, /normalizedEmail/);
assert.match(planFn, /normalizedPhone/);
assert.match(planFn, /isNull\(customersTable\.archivedAt\)/);
assert.match(planFn, /pickLaneCandidate|laneResult/);
assert.doesNotMatch(planFn, /customerByEmail: null/);
assert.doesNotMatch(planFn, /customerByPhone: null/);
const applyFn = PROD.slice(PROD.indexOf("async function applyOne"), PROD.indexOf("export async function applyCustomerProjection"));
assert.match(applyFn, /normalizedEmail/);
assert.match(applyFn, /normalizedPhone/);
assert.match(applyFn, /isNull\(customersTable\.archivedAt\)/);
assert.doesNotMatch(applyFn, /customerByEmail: null/);
assert.doesNotMatch(applyFn, /customerByPhone: null/);
// --- 6. lane multiplicity fails closed, never first-row destructuring ---
assert.match(PROD, /laneConflict/);
assert.match(PROD, /multiple/);
assert.doesNotMatch(PROD, /const \[byIdentity\]/);
assert.doesNotMatch(PROD, /const \[target\]/);
// --- 8. archived customers never auto-resolve ---
assert.match(PACKAGE, /archivedAt !== null/);
assert.match(PACKAGE, /MANUAL_REVIEW/);
// --- 9. reservation CAS stays NULL + expected version with bump ---
assert.match(applyFn, /isNull\(reservationsTable\.customerId\)/);
assert.match(applyFn, /eq\(reservationsTable\.version, record\.expectedReservationVersion\)/);
assert.match(applyFn, /version: sql`\$\{reservationsTable\.version\} \+ 1`/);
// --- 10/11/12. replay resolves existing before any audit emission ---
assert.ok(
  applyFn.indexOf('if (assessment.classification === "ALREADY_LINKED") return "existing"') !== -1
  || applyFn.indexOf("ALREADY_LINKED") < applyFn.indexOf("createAuditLog"),
  "existing short-circuits before audit emission",
);
const SELF_PACKAGE = readFileSync(new URL("../artifacts/api-server/src/historical-customer-projection-package-self-test.ts", import.meta.url), "utf8");
assert.match(SELF_PACKAGE, /successful REUSE replay/);
assert.match(SELF_PACKAGE, /successful CREATE replay/);
assert.match(SELF_PACKAGE, /wrong linked customer/);
assert.match(SELF_PACKAGE, /version beyond expected\+1/);
assert.match(SELF_PACKAGE, /lane multiplicity on replay/);
assert.match(SELF_PACKAGE, /lane disagreement on replay/);
assert.match(SELF_PACKAGE, /target identity drift/);
// --- 13/14. migration: no backfill, incompatible index fails closed ---
assert.match(MIGRATION, /RAISE EXCEPTION.*incompatible definition/);
assert.match(MIGRATION, /existing_index_def/);
assert.match(SEED, /\["historical_migration", "customer_projection_plan", \["admin"\]\]/);
assert.match(SEED, /\["historical_migration", "customer_create",\s+\["admin"\]\]/);
assert.match(SEED, /\["historical_migration", "customer_link_projection", \["admin"\]\]/);

execFileSync(
  "./artifacts/api-server/node_modules/.bin/tsx",
  ["artifacts/api-server/src/customer-identity-self-test.ts"],
  { stdio: "inherit" },
);
execFileSync(
  "./artifacts/api-server/node_modules/.bin/tsx",
  ["artifacts/api-server/src/historical-customer-projection-package-self-test.ts"],
  { stdio: "inherit" },
);
execFileSync(
  "./artifacts/api-server/node_modules/.bin/tsx",
  ["artifacts/api-server/src/historical-customer-projection-production-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical customer projection foundation focused tests: passed");
