import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => readFileSync(p, 'utf8');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };

// ── §7. Structurally separate Cruise and Sejour detail experiences ─────────
const shared = read('artifacts/tourops-ai/src/components/operation-detail/operation-shared-sections.tsx');
const cruise = read('artifacts/tourops-ai/src/components/operation-detail/CruiseOperationDetail.tsx');
const sejour = read('artifacts/tourops-ai/src/components/operation-detail/SejourOperationDetail.tsx');
const workspace = read('artifacts/tourops-ai/src/components/OperationDomainWorkspace.tsx');

ok(/export function SejourOperationDetail/.test(sejour), '§7: SejourOperationDetail is its own component');
ok(/export function CruiseOperationDetail/.test(cruise), '§7: CruiseOperationDetail is its own component');

// Sejour is NOT the cruise workspace with fields hidden: it must not pull any
// cruise field from the read model, nor render a "Gemi"/"Liman" field label.
const sejourCode = sejour.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok(!/c\.(shipName|portName|cruiseLine|arrival(Date|Time)|departure(Date|Time)|tourShipName|tourPortName|tourArrivalTime|tourDepartureTime)/.test(sejourCode),
  '§7: Sejour detail reads no cruise field from the /detail context');
ok(!/\[\s*'Gemi'|\[\s*'Liman'|'Cruise hattı'|'Gemi varış'|'Gemi kalkış'/.test(sejourCode),
  '§7: Sejour detail renders no ship/port field label');
ok(/operation_services/.test(sejour) && /SEJOUR_SERVICE_STRUCTURE/.test(sejour),
  '§7: Sejour detail lays out an extensible service structure for future flight/hotel/transfer services');
ok(/Yetkili kaynak verisi bekleniyor/.test(sejour),
  '§7: Sejour service slots are explicitly pending, not fabricated');

// Cruise owns the cruise-specific section.
ok(/cruiseFields/.test(cruise) && /'Gemi'/.test(cruise) && /'Liman'/.test(cruise),
  '§7: Cruise detail owns the ship/port section');

// Both reuse ONLY the genuinely shared blocks from one shared module.
for (const [name, src] of [['Cruise', cruise], ['Sejour', sejour]]) {
  ok(/from '\.\/operation-shared-sections'/.test(src), `§7: ${name} imports the shared sections module`);
  ok(/SharedOperationSummary/.test(src) && /ReservationsSection/.test(src)
    && /LegacyReadOnlySection/.test(src) && /OperationHistorySection/.test(src),
    `§7: ${name} reuses shared reservation/guide/driver/vehicle/notes/audit blocks`);
}
ok(/SharedOperationSummary/.test(shared) && /assignmentStateLabel/.test(shared)
  && /useOperationDetail/.test(shared),
  '§7: shared blocks + assignment state + data hook live in one shared module');

// ── §7. Dispatcher: one canonical identity, no inline duplicate detail ─────
ok(/operation\.operationType === 'SEJOUR'/.test(workspace)
  && /<SejourOperationDetail /.test(workspace) && /<CruiseOperationDetail /.test(workspace),
  '§7: OperationDomainWorkspace dispatches by operationType');
ok(/useOperationDetail/.test(workspace) && !/useQuery\(/.test(workspace),
  '§7: dispatcher delegates data loading to the shared hook, no second fetch');
ok(!/adultCount|itineraryRaw|<dl/.test(workspace),
  '§7: dispatcher renders no detail fields itself - it only routes');

// Cruise + untyped keep the cruise-oriented view (backward compatible);
// only SEJOUR diverges — the Cruise return is unconditional, the Sejour one is guarded.
ok(/=== 'SEJOUR'\) return <SejourOperationDetail[^\n]*\n\s*return <CruiseOperationDetail /.test(workspace),
  '§7: CRUISE and untyped operations fall back to the cruise-oriented view');

// ── §7. Typed detail routes both resolve; legacy route preserved ──────────
const app = read('artifacts/tourops-ai/src/App.tsx');
ok(/path="\/operations\/gemi\/:id"/.test(app), '§7: /operations/gemi/:id route exists');
ok(/path="\/operations\/sejour\/:id"/.test(app), '§7: /operations/sejour/:id route exists');
ok(/path="\/operations\/:id"/.test(app), '§4: legacy /operations/:id route preserved');
// RBAC contract on the typed detail routes is unchanged.
for (const seg of ['gemi', 'sejour']) {
  const line = app.split('\n').find(l => l.includes(`/operations/${seg}/:id`));
  ok(/roles=\{\['admin', 'operations', 'accounting'\]\}/.test(line),
    `§4: /operations/${seg}/:id keeps the operations RBAC role set`);
}

// ── §2/§8. Shared domain primitive ───────────────────────────────────────
const prim = read('artifacts/tourops-ai/src/lib/operation-domain.ts');
ok(/export function operationDetailHref/.test(prim) && /export function operationDomainLabel/.test(prim),
  '§2: shared operationDetailHref + operationDomainLabel primitive');
ok(/\/operations\/gemi\/\$\{id\}/.test(prim) && /\/operations\/sejour\/\$\{id\}/.test(prim)
  && /return `\/operations\/\$\{id\}`/.test(prim),
  '§8: primitive routes CRUISE/SEJOUR to typed detail and falls back to /operations/:id');
ok(/'GEMİ'/.test(prim) && /'SEJOUR'/.test(prim) && /Tür belirlenmemiş/.test(prim),
  '§8: untyped operations are labelled, never silently classified');

// ── §8. Operasyon Planlama (/operations) ─────────────────────────────────
const opsPage = read('artifacts/tourops-ai/src/pages/operations.tsx');
ok(/<TableHead>Tür<\/TableHead>/.test(opsPage), '§8: /operations shows a Tür column');
ok(/operationDomainLabel\(op\.operationType\)/.test(opsPage), '§8: /operations renders the GEMİ/SEJOUR indicator');
ok(/href=\{operationDetailHref\(op\.id, op\.operationType\)\}/.test(opsPage),
  '§8: /operations row links to the typed detail route');
ok(/setLocation\(`\/operations\/\$\{operation\.id\}`\)/.test(opsPage),
  '§4: newly created (untyped) operation still uses the legacy route');

// ── §8. Operasyon Merkezi (/field) ──────────────────────────────────────
const fieldDash = read('artifacts/tourops-ai/src/pages/field-dashboard.tsx');
const fieldDetail = read('artifacts/tourops-ai/src/pages/field-operation-detail.tsx');
ok(/operationType: OperationType \| null/.test(fieldDash), '§8: field dashboard OpSummary carries operationType');
ok(/operationDomainLabel\(op\.operationType\)/.test(fieldDash), '§8: field dashboard card shows the type indicator');
ok(/href=\{`\/field\/operations\/\$\{op\.id\}`\}/.test(fieldDash),
  '§3/§8: field card keeps its RBAC-scoped /field/operations/:id route');
ok(/operationType: OperationType \| null/.test(fieldDetail) && /operationDomainLabel\(op\.operationType\)/.test(fieldDetail),
  '§8: field operation detail shows the operation type');
ok(/<OperationDomainWorkspace operationId=\{op\.id\} surface="field" \/>/.test(fieldDetail),
  '§7: field detail reuses the domain dispatcher (Cruise/Sejour) rather than its own detail body');

// ── §8. Takvim (daily board) uses the shared primitive ──────────────────
const board = read('artifacts/tourops-ai/src/components/DailyOperationsBoard.tsx');
ok(/operationDetailHref\(operation\.id, operation\.operationType\)/.test(board),
  '§8: daily board resolves the typed detail route via the shared primitive');
ok(/operationDomainLabel\(operation\.operationType\)/.test(board),
  '§8: daily board shows GEMİ/SEJOUR on each card');

// ── §3. Backend field RBAC + type exposure unchanged/additive ───────────
const fieldRoute = read('artifacts/api-server/src/routes/field.ts');
ok(/operationType: operationsTable\.operationType/.test(fieldRoute),
  '§8: field API selects operationType');
ok((fieldRoute.match(/requirePermission\("field_operations", "view"\)/g) ?? []).length >= 3,
  '§3: field read endpoints keep requirePermission("field_operations", "view")');

console.log(`phase3h2 operation subdomain split focused tests: ${n} assertions passed`);
