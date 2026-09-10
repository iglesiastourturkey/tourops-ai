import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const run = spawnSync('pnpm', ['--filter', '@workspace/api-server', 'exec', 'tsx', 'src/phase3h2-domain-self-test.ts'], { encoding: 'utf8' });
assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
const migration = readFileSync('lib/db/migrations/0027_operation_domain_type.sql', 'utf8');
assert.match(migration, /ADD COLUMN IF NOT EXISTS operation_type text/);
assert.match(migration, /operation_type IS NULL OR operation_type IN \('CRUISE', 'SEJOUR'\)/);
// The workspace is now a thin dispatcher over one shared /detail read model;
// the cruise-specific fields live in their own component, not behind a
// conditional in the shared workspace.
const ui = readFileSync('artifacts/tourops-ai/src/components/OperationDomainWorkspace.tsx', 'utf8');
assert.match(ui, /operation\.operationType === 'SEJOUR'/);
assert.match(ui, /<SejourOperationDetail /);
assert.match(ui, /<CruiseOperationDetail /);
const cruiseDetail = readFileSync('artifacts/tourops-ai/src/components/operation-detail/CruiseOperationDetail.tsx', 'utf8');
assert.match(cruiseDetail, /cruiseFields/);
assert.match(cruiseDetail, /'Gemi'/);
const app = readFileSync('artifacts/tourops-ai/src/App.tsx', 'utf8');
assert.match(app, /\/operations\/gemi/);
assert.match(app, /\/operations\/sejour/);
const nav = readFileSync('artifacts/tourops-ai/src/components/AppShell.tsx', 'utf8');
assert.match(nav, /Gemi Operasyonları/);
assert.match(nav, /Sejour Operasyonları/);
console.log('phase3h2 focused tests: ok');
