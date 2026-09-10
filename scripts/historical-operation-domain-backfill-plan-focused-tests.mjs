import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const run = spawnSync(
  'pnpm',
  ['--filter', '@workspace/api-server', 'exec', 'tsx', 'src/historical-operation-domain-backfill-plan-self-test.ts'],
  { encoding: 'utf8' },
);
assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

const cli = readFileSync('artifacts/api-server/src/historical-operation-domain-backfill-plan.ts', 'utf8');
// Rehearsal only: no write/apply path, and it must reject those flags.
assert.match(cli, /yalnizca REHEARSAL\/read-only modudur/);
assert.match(cli, /--\(apply\|execute\|confirm\|write\|run\)/);
assert.ok(!/db\.(insert|update|delete)\(/.test(cli), 'the rehearsal CLI must not call a mutating drizzle builder');
assert.match(cli, /databaseWrites: false/);
// It must go through the staging target guard before importing the DB module.
assert.match(cli, /validateBackfillPlanTarget\(\)/);
assert.match(cli, /\.endsWith\("\.neon\.tech"\)/);

// The migration it rehearses stays additive + fail-closed.
const migration = readFileSync('lib/db/migrations/0027_operation_domain_type.sql', 'utf8');
assert.match(migration, /ADD COLUMN IF NOT EXISTS operation_type text/);
assert.match(migration, /operation_type IS NULL OR operation_type IN \('CRUISE', 'SEJOUR'\)/);
assert.ok(!/\bDROP\b|\bTRUNCATE\b/i.test(migration.replace(/--[^\n]*/g, '')));

console.log('historical operation domain backfill plan focused tests: ok');
