import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Phase 3A gate — permission contract + detail-route + guide-scope regression.
// Offline static assertions against the real backend/client source (repo
// convention: no DB, no Clerk, no network). Any failure means the runtime
// contract drifted and the gate must stop.

const src = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const profilesRoute = src("../artifacts/api-server/src/routes/profiles.ts");
const permissionsLib = src("../artifacts/api-server/src/lib/permissions.ts");
const seedPermissions = src("../artifacts/api-server/src/lib/seed-permissions.ts");
const profileContext = src("../artifacts/tourops-ai/src/contexts/ProfileContext.tsx");
const usePermission = src("../artifacts/tourops-ai/src/hooks/usePermission.ts");
const operationsRoute = src("../artifacts/api-server/src/routes/operations.ts");
const fieldRoute = src("../artifacts/api-server/src/routes/field.ts");
const guideRoute = src("../artifacts/api-server/src/routes/guide.ts");
const workspace = src("../artifacts/tourops-ai/src/components/OperationDomainWorkspace.tsx");
const operationDetailRead = src("../artifacts/api-server/src/lib/operation-detail-read.ts");
const fieldDetailPage = src("../artifacts/tourops-ai/src/pages/field-operation-detail.tsx");
const guideDetailPage = src("../artifacts/tourops-ai/src/pages/guide-operation-detail.tsx");
const operationDetailPage = src("../artifacts/tourops-ai/src/pages/operation-detail.tsx");

// ─── 1. Backend runtime contract: GET /api/profiles/me/permissions ───
// Shape: { all: boolean, permissions: string[] } — flat allow-set of
// "module.action" strings. No grant/deny representation, no nesting, no nulls.

assert.match(
  profilesRoute,
  /router\.get\("\/me\/permissions",\s*requireAuth,\s*requireActive\(\)/,
  "permissions endpoint must sit behind requireAuth + requireActive",
);
assert.match(
  profilesRoute,
  /if\s*\(profile\.role\s*===\s*"super_admin"\)\s*\{\s*res\.json\(\{\s*all:\s*true,\s*permissions:\s*\[\]\s*\}\)/,
  "super_admin must receive exactly { all: true, permissions: [] }",
);
assert.match(
  profilesRoute,
  /res\.json\(\{\s*all:\s*false,\s*permissions:\s*Array\.from\(perms\)\s*\}\)/,
  "non-admin must receive exactly { all: false, permissions: [...] }",
);
assert.match(
  permissionsLib,
  /const perms = new Set\(rolePerms\.map\(p => `\$\{p\.module\}\.\$\{p\.action\}`\)\)/,
  "effective set must be flat `module.action` strings",
);
assert.match(
  permissionsLib,
  /if \(up\.granted\) perms\.add\(key\);\s*\n\s*else\s+perms\.delete\(key\);/,
  "user-level denies must be resolved server-side (delete), never exposed",
);
assert.doesNotMatch(
  profilesRoute,
  /granted/,
  "permissions response must not leak any grant/deny representation",
);

// ─── 2. Client parser alignment (PWA = ProfileContext + usePermission) ───

assert.match(
  profileContext,
  /useQuery<\{\s*all:\s*boolean;\s*permissions:\s*string\[\]\s*\}>/,
  "client must type the payload as { all: boolean; permissions: string[] }",
);
assert.match(
  profileContext,
  /fetch\(`\$\{API_BASE\}\/profiles\/me\/permissions`/,
  "client must fetch the real endpoint path",
);
assert.match(
  profileContext,
  /new Set\(permissionsQuery\.data\?\.permissions \?\? \[\]\)/,
  "client must build the capability set from .permissions with empty default",
);
assert.match(
  profileContext,
  /permissionsQuery\.data\?\.all === true/,
  "client must derive allPermissions from .all === true (strict)",
);
assert.match(
  profileContext,
  /permissionsQuery\.isSuccess \|\| permissionsQuery\.isError/,
  "permissions errors must fail closed (loaded flag set, empty set → UI hidden)",
);
assert.match(
  usePermission,
  /permissionSet\.has\(`\$\{module\}\.\$\{action\}`\)/,
  "capability check must use the same `module.action` key format",
);

// ─── 3. Detail route alignment: every surface prefix hits a registered route ───

assert.match(
  operationsRoute,
  /router\.get\("\/:id\/detail",\s*requirePermission\("operations",\s*"view"\),\s*operationDetailRead\)/,
  "operations detail route must be registered",
);
assert.match(
  fieldRoute,
  /router\.get\("\/operations\/:id\/detail",\s*requirePermission\("field_operations",\s*"view"\),\s*operationDetailRead\)/,
  "field detail route must be registered",
);
assert.match(
  guideRoute,
  /router\.get\("\/my-operations\/:id\/detail",\s*requirePermission\("guide_workspace",\s*"view"\),\s*operationDetailRead\)/,
  "guide detail route must be registered",
);
assert.match(
  workspace,
  /surface === 'field' \? 'field\/operations' : surface === 'guide' \? 'guide\/my-operations' : 'operations'/,
  "workspace must map surface → the exact registered route prefixes",
);
assert.match(
  fieldDetailPage,
  /<OperationDomainWorkspace operationId=\{op\.id\} surface="field" \/>/,
  "field page must request the field surface",
);
assert.match(
  guideDetailPage,
  /<OperationDomainWorkspace operationId=\{operationId\} surface="guide" \/>/,
  "guide page must request the guide surface",
);
assert.match(
  operationDetailPage,
  /<OperationDomainWorkspace operationId=\{id\} \/>/,
  "operations page must request the default (operations) surface",
);

// ─── 4A. Guide field-operation scoping regression ───
// Guides must have no path to company-wide field reads.

for (const route of [
  'router.get("/dashboard"',
  'router.get("/operations"',
  'router.get("/operations/:id"',
  'router.get("/operations/:id/notes"',
  'router.get("/operations/:id/location"',
  'router.get("/operations/:id/detail"',
]) {
  const idx = fieldRoute.indexOf(route);
  assert.ok(idx !== -1, `field.ts must still register ${route}`);
  const snippet = fieldRoute.slice(idx, idx + 140);
  assert.match(
    snippet,
    /requirePermission\("field_operations",\s*"(view|create|update)"\)/,
    `${route} must require a field_operations permission`,
  );
}
assert.match(
  seedPermissions,
  /\["field_operations",\s*"view",\s*\["admin","operations","field_operations"\]/,
  "seed must NOT grant field_operations.view to guide",
);
assert.match(
  operationsRoute,
  /if \(role === "guide"\) \{\s*\n\s*rows = rows\.filter\(r => r\.assignedGuideUserId === userId\);/,
  "operations list must filter guides to assigned rows",
);
assert.match(
  operationsRoute,
  /if \(role === "guide" && row\.assignedGuideUserId !== userId\) \{\s*\n\s*res\.status\(403\)/,
  "operations :id must 403 guides on unassigned rows",
);
assert.match(
  operationDetailRead,
  /if \(res\.locals\.profile\.role === "guide" && operation\.assignedGuideUserId !== getAuth\(req\)\.userId\) \{\s*\n\s*res\.status\(403\)/,
  "shared detail reader must 403 guides on unassigned operations",
);

// ─── 4B. mustChangePassword clearing semantics ───

assert.match(
  profilesRoute,
  /await clerkClient\.users\.verifyPassword\(\{\s*\n?\s*userId: userId!,\s*\n?\s*password: originalTemporaryPassword,\s*\n?\s*\}\);/,
  "clear endpoint must verify the original temporary credential against Clerk",
);
assert.match(
  profilesRoute,
  /\} catch \{\s*\n\s*\/\/ Clerk rejecting the original temporary password is the authoritative/,
  "only a Clerk rejection (temp no longer valid) may clear the flag",
);
assert.match(
  profilesRoute,
  /publicMetadata: \{ mustChangePassword: false \}/,
  "clearing must reset the Clerk publicMetadata flag",
);
assert.match(
  profilesRoute,
  /The original temporary credential still works\.  Keep the account gated\./,
  "a still-valid temp credential must keep the account gated (409)",
);
assert.match(
  profilesRoute,
  /res\.status\(503\)\.json\(\{ error: "Authentication state unavailable" \}\)/,
  "Clerk timeout/error on /me must fail closed (503), never fail open",
);

console.log("phase3a-permissions-contract-focused-tests: all assertions passed");
