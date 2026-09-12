import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Phase 2D.2 — Personnel Management UI focused tests.
//
// The front end has no component test runner in this repo, so these are
// static-source assertions in the same style as
// scripts/historical-remediation-ui-phase3e3-focused-tests.mjs. They pin the
// safety-critical wiring for the UI built over the Phase 2D.1 canonical
// Resource/Guide-Driver identity foundation: RBAC gating (nav + route +
// in-page actions), the Personel/Kullanıcı Yönetimi separation, type
// immutability on edit, alias management, the responsive table/card
// contract, and the absence of any fabricated identity-matching data or
// invented delete/merge/auto-assignment surface.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(root, rel), 'utf8');

const appShell = read('artifacts/tourops-ai/src/components/AppShell.tsx');
const app = read('artifacts/tourops-ai/src/App.tsx');
const listPage = read('artifacts/tourops-ai/src/pages/personnel.tsx');
const detailPage = read('artifacts/tourops-ai/src/pages/personnel-detail.tsx');
const labels = read('artifacts/tourops-ai/src/lib/labels.ts');
const route = read('artifacts/api-server/src/routes/resources.ts');
const write = read('artifacts/api-server/src/lib/personnel-write.ts');
const openapi = read('lib/api-spec/openapi.yaml');
const clientApi = read('lib/api-client-react/src/generated/api.ts');

let count = 0;
const check = (condition, message) => { assert.ok(condition, message); count += 1; };

// --- A. navigation: RBAC-gated, near suppliers/tours/operations, distinct
//        from Kullanıcı Yönetimi ------------------------------------------
check(/label: 'Personel',\s*href: '\/personnel',\s*permission: \['personnel',\s*'view'\]/.test(appShell.replace(/\s+/g, ' ')),
  "A: nav item 'Personel' gated on personnel.view");
check(appShell.includes("label: 'Kullanıcı Yönetimi'") && appShell.includes("href: '/users'"),
  'A: existing Kullanıcı Yönetimi nav item is untouched');
check(!/label: '[^']*Personel[^']*',\s*href: '\/users'/.test(appShell.replace(/\s+/g, ' ')), 'A: Kullanıcı Yönetimi was not renamed to Personel');
check(appShell.includes("'/operations', '/calendar', '/field', '/external-observations', '/personnel'"),
  'A: /personnel is grouped under the Operasyon domain, alongside Operasyon Planlama/Takvim/Field');
const navBlock = appShell.slice(appShell.indexOf('const navItems'), appShell.indexOf('const navItems') + 3000);
const suppliersIdx = navBlock.indexOf("href: '/suppliers'");
const toursIdx = navBlock.indexOf("href: '/tours'");
const personnelIdx = navBlock.indexOf("href: '/personnel'");
check(suppliersIdx > -1 && toursIdx > -1 && personnelIdx > -1 && personnelIdx > suppliersIdx && personnelIdx > toursIdx,
  'A: Personel nav entry is placed after Tedarikçiler and Turlar (operations-adjacent block)');

// --- B. routing: permission-gated, lazy-loaded like other admin pages ------
check(app.includes("const PersonnelPage = lazy(() => import('@/pages/personnel'));"), 'B: PersonnelPage is lazy-loaded');
check(app.includes("const PersonnelDetailPage = lazy(() => import('@/pages/personnel-detail'));"), 'B: PersonnelDetailPage is lazy-loaded');
check(/<Route path="\/personnel" component={\(\) => <ProtectedPermissionRoute component={PersonnelPage} permission={\['personnel', 'view'\]} \/>} \/>/.test(app),
  "B: /personnel route requires personnel.view");
check(/<Route path="\/personnel\/:id" component={\(\) => <ProtectedPermissionRoute component={PersonnelDetailPage} permission={\['personnel', 'view'\]} \/>} \/>/.test(app),
  "B: /personnel/:id route requires personnel.view");

// --- C. list page: renders API records, server-side filters, GUIDE/DRIVER
//        labels, no client-side re-implementation of filtering ------------
check(listPage.includes("useListResources(params"), 'C: list page calls useListResources with server-side params');
check(listPage.includes('...(typeFilter !== \'all\' ? { type: typeFilter } : {})')
  && listPage.includes('...(activeFilter !== \'all\' ? { active: activeFilter === \'active\' } : {})')
  && listPage.includes('...(search.trim() ? { q: search.trim() } : {})'),
  'C: type/active/q are forwarded to the backend, not filtered client-side');
check(!/\.filter\(\s*\w+\s*=>\s*\w+\.name\.toLowerCase\(\)/.test(listPage), 'C: no client-side name-search re-implementation');
check(listPage.includes('rows.map(p =>') , 'C: table body maps live API rows');
check(labels.includes("GUIDE: 'Rehber'") && labels.includes("DRIVER: 'Şoför'"), 'C: GUIDE/DRIVER labels defined');
check(listPage.includes('RESOURCE_TYPE_LABELS[p.type] ?? p.type'), 'C: list renders type via the label map with a safe fallback');

// --- D. create respects personnel.create; no login/account is created ----
check(listPage.includes("usePermission('personnel', 'create')"), 'D: create button gated on personnel.create');
check(/canCreate && \(\s*<Button onClick={\(\) => setDialogOpen\(true\)}/.test(listPage), 'D: "Yeni Personel" button only renders when canCreate');
check(!listPage.split('createMutation.mutate({')[1].split('}, {')[0].includes('linkedProfileId'), 'D: create payload never sets linkedProfileId (create schema does not accept it)');
check(!/clerk|Clerk|invite|Invite/.test(listPage), 'D: personnel creation never touches login/invite machinery');
check(write.includes('resourceCreateSchema') && !write.split('resourceCreateSchema =')[1].split('.strict();')[0].includes('linkedProfileId'),
  'D: backend create schema itself excludes linkedProfileId (creation ≠ account linking)');

// --- E. edit: type is immutable, never rendered as an editable control ---
check(!/<Select[^>]*value={form\.type}/.test(detailPage), 'E: no editable Select bound to a type field on the detail page');
check(detailPage.includes("data-testid=\"input-personnel-type-readonly\"") && /Input value={RESOURCE_TYPE_LABELS\[resource\.type\]/.test(detailPage),
  'E: type is rendered as a disabled, read-only Input');
check(/disabled\s*$|disabled>/m.test(detailPage.split('input-personnel-type-readonly')[0].split('\n').slice(-3).join('\n')) || detailPage.includes('disabled data-testid="input-personnel-type-readonly"'),
  'E: the type input is disabled');
check(!write.split('resourceUpdateSchema =')[1].split('.strict();')[0].includes('type:'),
  'E: backend update schema itself has no `type` field (matches personnel-write.ts immutability contract)');

// --- F. aliases render; add/delete are permission-gated and confirmed ----
check(detailPage.includes('resource.aliases.map(a =>'), 'F: aliases list renders from the detail response');
check(detailPage.includes("Takma Adlar ({resource.aliases.length})"), 'F: alias count shown is the real length of the returned array, not fabricated');
check(detailPage.includes("usePermission('personnel', 'update')"), 'F: alias mutation actions gated on personnel.update');
check(/canUpdate && \(\s*<Button onClick={\(\) => setAliasDialogOpen\(true\)}/.test(detailPage), 'F: "Takma Ad Ekle" only renders when canUpdate');
check(detailPage.includes('{canUpdate && (') && detailPage.includes('setDeleteAliasTarget({ id: a.id, alias: a.alias })'), 'F: delete-alias action gated on canUpdate');
check(detailPage.includes('<AlertDialog') && detailPage.includes('confirmDeleteAlias'), 'F: alias deletion requires an explicit confirmation dialog, not a bare click');
check(detailPage.includes('useDeleteResourceAlias') && detailPage.includes('deleteAliasMutation.mutate({ id, aliasId }'),
  'F: alias delete calls DELETE /resources/:id/aliases/:aliasId, not a personnel-delete endpoint');

// --- G. no personnel deletion anywhere -------------------------------------
check(!/useDeleteResource\b(?!Alias)/.test(listPage) && !/useDeleteResource\b(?!Alias)/.test(detailPage), 'G: no personnel (resource) delete mutation is used anywhere (useDeleteResourceAlias is a distinct, allowed hook)');
check(!route.includes('router.delete("/:id"'), 'G: backend exposes no DELETE /resources/:id (deactivation via active=false only)');
check(!clientApi.includes('useDeleteResource ') && !/export const useDeleteResource\b/.test(clientApi), 'G: no generated useDeleteResource hook exists (no such endpoint was ever specified)');

// --- H. no fabricated identity-matching data --------------------------------
const stripLeadingComment = src => src.replace(/^\/\*[\s\S]*?\*\//, '');
check(!/EXACT_MATCH|ALIAS_MATCH|AMBIGUOUS|UNMATCHED/.test(stripLeadingComment(listPage))
  && !/EXACT_MATCH|ALIAS_MATCH|AMBIGUOUS|UNMATCHED/.test(stripLeadingComment(detailPage)),
  'H: no matching-status column/badge is rendered anywhere in this phase\'s actual code (file-header documentation explaining the deferral is fine)');

// --- I. empty / loading / error / no-results states -------------------------
check(listPage.includes('trulyEmpty') && listPage.includes('noResultsFromFilter'), 'I: list distinguishes a truly-empty list from a filtered no-results state');
check(listPage.includes('isError') && listPage.includes('Yeniden Dene'), 'I: list has a distinct error state with retry');
check(listPage.includes('Array.from({ length:') && listPage.includes('<Skeleton'), 'I: list has a loading skeleton state');
check(detailPage.includes('isLoading') && detailPage.includes('<Skeleton') && detailPage.includes('isError || !resource'), 'I: detail page has loading and not-found/error states');

// --- J. responsive contract: real cards on mobile, not a squeezed table ---
check(listPage.includes('hidden sm:block') && listPage.includes('sm:hidden'), 'J: list renders a desktop table (hidden on mobile) and a separate mobile card list, not one squeezed table');
check(!/overflow-x-auto/.test(listPage.split('sm:hidden')[0]) || listPage.includes('hidden sm:block border rounded-lg overflow-hidden'),
  'J: desktop table uses progressive column hiding rather than relying on horizontal scroll');

// --- K. backend contract is exposed, not re-invented -----------------------
check(openapi.includes('operationId: listResources') && openapi.includes('operationId: createResource')
  && openapi.includes('operationId: getResource') && openapi.includes('operationId: updateResource')
  && openapi.includes('operationId: createResourceAlias') && openapi.includes('operationId: deleteResourceAlias'),
  'K: openapi.yaml declares exactly the six existing Phase 2D.1 endpoints, nothing invented');
check(!openapi.includes('operationId: deleteResource\n') && !/operationId: deleteResource[^A]/.test(openapi),
  'K: no deleteResource operation was invented in the spec');
check(clientApi.includes('export function useListResources') && clientApi.includes('export const useCreateResource')
  && clientApi.includes('export function useGetResource') && clientApi.includes('export const useUpdateResource')
  && clientApi.includes('export const useCreateResourceAlias') && clientApi.includes('export const useDeleteResourceAlias'),
  'K: codegen produced exactly the six expected hooks');

// --- L. migration/database safety: this phase touches no migration --------
const migrationFiles = readdirSync(path.join(root, 'lib/db/migrations'));
check(migrationFiles.includes('0025_resource_identity_foundation.sql'), 'L: Phase 2D.1 migration baseline (0025) still present, untouched by this UI-only phase');
// Phase 2D.2 itself ships no migration file. Later migrations from OTHER
// workstreams are permitted only when explicitly acknowledged below, so a new
// migration can never slip in unreviewed while this guard stays green.
const KNOWN_POST_0025_MIGRATIONS = new Set([
  '0026_historical_promoted_hash_guard.sql', // 3G.3 production preflight (non-personnel, additive guard)
  '0027_operation_domain_type.sql', // 3H.2 operation subdomains (non-personnel, additive nullable column + CHECK)
  '0028_customer_identity_foundation.sql', // 3H.4B customer identity substrate (non-personnel, additive nullable columns + partial unique index + version default)
]);
const post0025Migrations = migrationFiles.filter(name => /^002[6-9]|^00[3-9]\d/.test(name));
check(post0025Migrations.every(name => KNOWN_POST_0025_MIGRATIONS.has(name)), 'L: Phase 2D.2 adds no migration of its own (only explicitly acknowledged non-personnel migrations may exist beyond 0025)');

console.log(`personnel-management-ui-phase2d2 focused tests: ${count} assertions passed`);
