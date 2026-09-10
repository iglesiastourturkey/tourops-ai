import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const run = spawnSync('pnpm', ['--filter', '@workspace/api-server', 'exec', 'tsx', 'src/phase3h2-domain-self-test.ts'], { encoding: 'utf8' });
assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
const migration = readFileSync('lib/db/migrations/0027_operation_domain_type.sql', 'utf8');
assert.match(migration, /ADD COLUMN IF NOT EXISTS operation_type text/);
assert.match(migration, /operation_type IS NULL OR operation_type IN \('CRUISE', 'SEJOUR'\)/);
const ui = readFileSync('artifacts/tourops-ai/src/components/OperationDomainWorkspace.tsx', 'utf8');
assert.match(ui, /op\.operationType === 'SEJOUR' \? \[\] :/);
assert.match(ui, /\.\.\.cruiseFields/);
console.log('phase3h2 focused tests: ok');
