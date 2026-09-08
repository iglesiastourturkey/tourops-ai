import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Load the real pure-logic module directly (Node's built-in TS type ──
// stripping erases the plain type annotations; no bundler/tsx involved),
// same technique as reservation-management-phase2a-focused-tests.mjs, so
// these assertions exercise the actual identity-matching logic.
const identityUrl = new URL("../artifacts/api-server/src/lib/personnel-identity.ts", import.meta.url);
const { normalizePersonName, matchResourceIdentity, levenshteinDistance, similarityRatio } = await import(identityUrl.href);

const writeUrl = new URL("../artifacts/api-server/src/lib/personnel-write.ts", import.meta.url);
const { resourceCreateSchema, resourceUpdateSchema, resourceAliasCreateSchema, RESOURCE_TYPES, RESOURCE_ALIAS_SOURCES } = await import(writeUrl.href);

function read(relPath) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

const resourcesSchemaSource = read("../lib/db/src/schema/resources.ts");
const aliasesSchemaSource = read("../lib/db/src/schema/resource_aliases.ts");
const migrationSource = read("../lib/db/migrations/0025_resource_identity_foundation.sql");
const routeSource = read("../artifacts/api-server/src/routes/resources.ts");
const routesIndexSource = read("../artifacts/api-server/src/routes/index.ts");
const seedPermissionsSource = read("../artifacts/api-server/src/lib/seed-permissions.ts");
const operationDetailReadSource = read("../artifacts/api-server/src/lib/operation-detail-read.ts");
const dailyOperationsReadSource = read("../artifacts/api-server/src/lib/daily-operations-read.ts");
const fieldRouteSource = read("../artifacts/api-server/src/routes/field.ts");
const schemaIndexSource = read("../lib/db/src/schema/index.ts");

// ─── Normalization: Turkish letters, whitespace/punctuation insensitivity ──

assert.equal(normalizePersonName("KADIRSAHIN"), "kadirsahin");
assert.equal(normalizePersonName("KADIR SAHIN"), "kadirsahin");
assert.equal(normalizePersonName("Kadir Şahin"), "kadirsahin");
assert.equal(
  normalizePersonName("KADIRSAHIN"),
  normalizePersonName("Kadir Şahin"),
  "the three brief-cited spellings of the same name must normalize identically",
);

assert.equal(normalizePersonName("Şükrü"), "sukru", "Ş folds to s and ü folds to u");
assert.equal(normalizePersonName("IŞIK"), "isik", "dotless I + Ş must fold to plain ascii, not locale-dependent casing");
assert.equal(normalizePersonName("İIışŞçÇğĞöÖüÜ"), "iiissccggoouu", "every mapped Turkish letter must fold to its documented ascii target");
assert.equal(normalizePersonName("Çiğdem Öztürk"), "cigdemozturk");
assert.equal(normalizePersonName("Bahar K."), "bahark", "punctuation is stripped, not just spaces");
assert.equal(normalizePersonName(""), "");
assert.equal(normalizePersonName(null), "");
assert.equal(normalizePersonName(undefined), "");

// ─── Matching: EXACT_MATCH, ALIAS_MATCH ────────────────────────────────────

{
  const resources = [{ id: 1, normalizedName: "kadirsahin" }];
  const aliases = [];
  const result = matchResourceIdentity("KADIR SAHIN", resources, aliases);
  assert.equal(result.status, "EXACT_MATCH");
  assert.equal(result.resourceId, 1);
}

{
  const resources = [{ id: 1, normalizedName: "kadirsahin" }];
  const aliases = [{ resourceId: 1, normalizedAlias: "ksahin" }];
  const result = matchResourceIdentity("K. Sahin", resources, aliases);
  assert.equal(result.status, "ALIAS_MATCH");
  assert.equal(result.resourceId, 1);
}

// ─── Matching: AMBIGUOUS, including identical-name collision ──────────────

{
  // Two DISTINCT real people who happen to normalize to the same name.
  // Must never be auto-picked or silently merged.
  const resources = [
    { id: 1, normalizedName: "kadirsahin" },
    { id: 2, normalizedName: "kadirsahin" },
  ];
  const result = matchResourceIdentity("Kadir Şahin", resources, []);
  assert.equal(result.status, "AMBIGUOUS", "identical normalized names must never auto-merge into a single match");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(new Set(result.candidates.map(c => c.resourceId)), new Set([1, 2]));
}

{
  // One canonical name match AND one alias match pointing at two DIFFERENT
  // resources — also ambiguous, not resolved by preferring the exact match.
  const resources = [{ id: 1, normalizedName: "gokbora" }];
  const aliases = [{ resourceId: 2, normalizedAlias: "gokbora" }];
  const result = matchResourceIdentity("GOKBORA", resources, aliases);
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.candidates.length, 2);
}

// ─── Matching: UNMATCHED, and fuzzy similarity NEVER produces a match ─────

{
  const resources = [{ id: 1, normalizedName: "ismail" }];
  const result = matchResourceIdentity("Completely Different Name", resources, []);
  assert.equal(result.status, "UNMATCHED");
}

{
  // A one-character-off fuzzy-similar name must stay UNMATCHED — fuzzy
  // similarity is suggestion metadata only, never a match, per Section F
  // rule 4 of the architecture document.
  const resources = [{ id: 1, normalizedName: "kadirsahin" }];
  const result = matchResourceIdentity("Kadir Sahyn", resources, []); // 1-char edit distance from "kadirsahyn" vs "kadirsahin"
  assert.equal(result.status, "UNMATCHED", "fuzzy-similar input must never be auto-promoted to a match");
  assert.ok(!("resourceId" in result) || result.resourceId === undefined, "an UNMATCHED result must never carry a resourceId");
  if (result.suggestions) {
    assert.ok(result.suggestions.every(s => typeof s.score === "number" && s.score < 1), "suggestions are metadata only, never treated as a match");
  }
}

assert.equal(levenshteinDistance("kadirsahin", "kadirsahin"), 0);
assert.equal(levenshteinDistance("kadirsahin", "kadirsahyn"), 1);
assert.equal(similarityRatio("abc", "abc"), 1);
assert.ok(similarityRatio("abc", "xyz") < 0.5);

// ─── Zod schemas: optional linked profile, no forced profile requirement ──

{
  const created = resourceCreateSchema.safeParse({ type: "GUIDE", name: "Test Guide" });
  assert.ok(created.success, "a Resource must be creatable with no login/profile reference at all");
}

{
  // undefined = leave untouched; explicit null = unlink; a number = set/replace.
  const untouched = resourceUpdateSchema.safeParse({ active: false });
  assert.ok(untouched.success);
  assert.equal(untouched.data.linkedProfileId, undefined);

  const unlinked = resourceUpdateSchema.safeParse({ linkedProfileId: null });
  assert.ok(unlinked.success, "explicit null must be a valid way to unlink a profile");
  assert.equal(unlinked.data.linkedProfileId, null);

  const linked = resourceUpdateSchema.safeParse({ linkedProfileId: 7 });
  assert.ok(linked.success);
  assert.equal(linked.data.linkedProfileId, 7);
}

{
  // type is immutable after creation — not part of the update schema at all.
  const attemptTypeChange = resourceUpdateSchema.safeParse({ type: "DRIVER" });
  assert.ok(!attemptTypeChange.success, "type must not be editable via the update endpoint (schema is .strict())");
}

assert.deepEqual([...RESOURCE_TYPES], ["GUIDE", "DRIVER"], "resource type constraint must not be widened in this phase");

{
  const aliasOk = resourceAliasCreateSchema.safeParse({ source: "SHEET_IMPORT", alias: "K. Sahin" });
  assert.ok(aliasOk.success);
  const aliasBadSource = resourceAliasCreateSchema.safeParse({ source: "MADE_UP_SOURCE", alias: "K. Sahin" });
  assert.ok(!aliasBadSource.success, "alias source must be a controlled vocabulary value");
}
assert.ok(RESOURCE_ALIAS_SOURCES.includes("SHEET_IMPORT") && RESOURCE_ALIAS_SOURCES.includes("PERFORMANCE_2026")
  && RESOURCE_ALIAS_SOURCES.includes("MANUAL") && RESOURCE_ALIAS_SOURCES.includes("LEGACY_OPERATION"));

// ─── Schema/migration: additive only, no widened constraint, no destructive SQL ──

assert.ok(
  /CHECK\(\$\{table\.type\} IN \('GUIDE', 'DRIVER'\)\)|IN \('GUIDE', 'DRIVER'\)/.test(resourcesSchemaSource),
  "resources_type_check must remain GUIDE/DRIVER only in this phase",
);
assert.ok(/linkedProfileId.*references\(\(\) => profilesTable\.id, \{ onDelete: "set null" \}\)/s.test(resourcesSchemaSource),
  "linked_profile_id must ON DELETE SET NULL, never cascade-delete the Resource");
assert.ok(/uniqueIndex\("resources_linked_profile_id_uidx"\)/.test(resourcesSchemaSource),
  "linked_profile_id must be uniquely indexed (a login belongs to at most one canonical person)");
assert.ok(!/normalizedName.*unique/i.test(resourcesSchemaSource),
  "normalized_name must NOT be unique — two distinct people may share a normalized name");

assert.ok(/onDelete: "cascade"/.test(aliasesSchemaSource), "alias rows are owned by their resource (cascade), same convention as tour_product_aliases");
assert.ok(!/normalizedAlias.*unique/i.test(aliasesSchemaSource) || /resource_source_alias_uidx/.test(aliasesSchemaSource),
  "an alias string must be allowed to map to more than one resource (ambiguity is preserved, not blocked)");

for (const forbidden of [/\bDROP\s+TABLE/i, /\bDROP\s+COLUMN/i, /\bDELETE\s+FROM/i, /\bTRUNCATE/i]) {
  assert.ok(!forbidden.test(migrationSource), `migration must not contain ${forbidden}`);
}
assert.ok(/NOT APPLIED/.test(migrationSource), "migration file must explicitly document it has not been applied");
assert.ok(!/ALTER TABLE operations/.test(migrationSource), "migration must not touch the operations table");
assert.ok(!/ALTER TABLE profiles/.test(migrationSource), "migration must not touch the profiles table (only a REFERENCES pointer)");
assert.ok(/ADD COLUMN IF NOT EXISTS/.test(migrationSource) && /CREATE TABLE IF NOT EXISTS resource_aliases/.test(migrationSource),
  "migration must be purely additive (IF NOT EXISTS everywhere)");

assert.ok(/export \* from "\.\/resource_aliases"/.test(schemaIndexSource), "new schema file must be exported from the schema barrel");

// ─── API / RBAC wiring ──────────────────────────────────────────────────

assert.ok(/requirePermission\("personnel", "view"\)/.test(routeSource) && /requirePermission\("personnel", "create"\)/.test(routeSource) && /requirePermission\("personnel", "update"\)/.test(routeSource),
  "every /resources route must be gated by the personnel permission, server-side");
assert.ok(!/profilesTable\.clerkUserId/.test(routeSource) && !/profilesTable\.clerkUserId/.test(read("../artifacts/api-server/src/lib/personnel-read.ts")),
  "no route or read model may select/expose profiles.clerkUserId or other auth-session data");
assert.ok(/router\.use\("\/resources", resourcesRouter\)/.test(routesIndexSource), "resources router must be mounted");
assert.ok(/\["personnel", "view",\s*\["admin","operations"\]\]/.test(seedPermissionsSource)
  && /\["personnel", "create",\s*\["admin","operations"\]\]/.test(seedPermissionsSource)
  && /\["personnel", "update",\s*\["admin","operations"\]\]/.test(seedPermissionsSource),
  "personnel permission matrix must be seeded for admin/operations");
assert.ok(!/\["personnel", "delete"/.test(seedPermissionsSource), "no destructive delete permission for personnel in this phase — deactivate via update instead");

// ─── Backward compatibility: existing assignment/read paths untouched ─────

assert.ok(/guideResourceId/.test(operationDetailReadSource) && /driverResourceId/.test(operationDetailReadSource),
  "operation-detail-read.ts must keep reading guideResourceId/driverResourceId exactly as before");
assert.ok(/guideResourceId/.test(dailyOperationsReadSource) && /driverResourceId/.test(dailyOperationsReadSource),
  "daily-operations-read.ts must keep reading guideResourceId/driverResourceId exactly as before");
assert.ok(
  /guideName,\s*\n\s*guidePhone,\s*\n\s*assignedGuideUserId,\s*\n\s*driverName,\s*\n\s*driverPhone,\s*\n\s*vehiclePlate,/.test(fieldRouteSource),
  "PATCH /field/operations/:id/assignments must remain untouched in this phase — the write-path canonicalization fix is explicitly Phase 2C's job, not 2D.1's",
);
// Superseded by Phase 2C (scripts/canonical-operation-assignment-phase2c-focused-tests.mjs),
// which was explicitly tasked with wiring the manual assignment endpoint to
// guide_resource_id/driver_resource_id — exactly what this 2D.1-era guard
// used to forbid. The invariant 2D.1 actually cared about (assignedGuideUserId,
// the separate login-access field, is never conflated with the canonical
// resource FK) is what's re-asserted here instead of the now-obsolete "not yet
// wired" placeholder.
assert.ok(/guideResourceId\?: number \| null;/.test(fieldRouteSource) && /driverResourceId\?: number \| null;/.test(fieldRouteSource),
  "Phase 2C: guideResourceId/driverResourceId are now accepted as optional, independent fields on this endpoint");
assert.ok(!/guideResourceId\s*=\s*assignedGuideUserId|assignedGuideUserId\s*=\s*guideResourceId/.test(fieldRouteSource),
  "the canonical resource FK and the login-access field must never be assigned from one another");

console.log("personnel-identity-phase2d1: all focused assertions passed");
