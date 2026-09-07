import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [migration, schema, loader, route, service, app, shell] = await Promise.all([
  read('lib/db/migrations/0024_historical_source_evidence.sql'),
  read('lib/db/src/schema/historical_source_evidence.ts'),
  read('artifacts/api-server/src/historical-source-evidence-loader.ts'),
  read('artifacts/api-server/src/routes/historical-remediation.ts'),
  read('artifacts/api-server/src/lib/historical-remediation-read.ts'),
  read('artifacts/tourops-ai/src/App.tsx'),
  read('artifacts/tourops-ai/src/components/AppShell.tsx'),
]);
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };
check(migration.includes('CREATE TABLE IF NOT EXISTS historical_source_evidence'), 'additive evidence table');
check(schema.includes('uniqueIndex("historical_source_evidence_source_key_idx")'), 'idempotency key');
check(schema.includes('cells: jsonb'), 'cell snapshot storage');
check(loader.includes('const apply = args.includes("--apply")'), 'plan default');
check(loader.includes('TOURPILOT_2026_HISTORICAL_EVIDENCE_LOAD'), 'apply confirmation');
check(loader.includes('env.NODE_ENV === "production"'), 'production guard');
check(loader.includes('params.checksums.get(checksumKey) !== sha256'), 'workbook verification');
check(loader.includes('sha256OfExactBytes(manifestBytes)'), 'exact-byte manifest verification');
check(loader.includes('Manifest SHA256 dogrulanamadi'), 'manifest mismatch fails closed');
check(loader.includes('manifestHashVerified: manifestIntegrity.manifestHashVerified'), 'safe manifest integrity output');
check(loader.includes('Exact provenance eslesmedi'), 'exact provenance gate');
check(loader.includes('Evidence conflict bulundu'), 'conflict gate');
check(route.includes('requirePermission("historical_migration", "review")'), 'server RBAC');
check((route.match(/router\.get\(/g) ?? []).length === 2, 'exactly two GET endpoints');
check(route.includes('requirePermission("historical_migration", "remediate")'), 'mutation RBAC is separate from review');
check((route.match(/router\.post\(/g) ?? []).length === 1 && route.includes('router.post("/:sourceKey/remediate"'), 'exactly one controlled mutation endpoint');
check(!/router\.(put|patch|delete)\(/.test(route), 'no uncontrolled mutation endpoints');
check(service.includes('"UNRESOLVED" | "READY_FOR_REVIEW"'), 'derived states');
check(!migration.includes('remediation_state'), 'derived states not persisted');
check(app.includes('ProtectedPermissionRoute') && app.includes("['historical_migration', 'review']"), 'client route RBAC');
check(shell.includes("label: 'Yönetim'") && shell.includes("href: '/historical-remediation'"), 'management navigation');

const tsx = new URL('../artifacts/api-server/node_modules/.bin/tsx', import.meta.url).pathname;
const selfTest = new URL('../artifacts/api-server/src/historical-source-evidence-self-test.ts', import.meta.url).pathname;
const result = spawnSync(tsx, [selfTest], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused' } });
assert.equal(result.status, 0, result.stderr || result.stdout);
check(result.stdout.includes('7 assertions passed'), 'B105/C105 and state regressions');
const manifestTest = new URL('../artifacts/api-server/src/historical-manifest-integrity-self-test.ts', import.meta.url).pathname;
const manifestResult = spawnSync(tsx, [manifestTest], { encoding: 'utf8' });
assert.equal(manifestResult.status, 0, manifestResult.stderr || manifestResult.stdout);
check(manifestResult.stdout.includes('11 assertions passed'), 'manifest integrity regressions');
console.log(`historical remediation focused tests: ${assertions + 18} assertions passed`);
