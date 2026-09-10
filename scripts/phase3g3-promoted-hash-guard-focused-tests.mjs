import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Phase 3G.3: migration 0020 ships a bare ADD CONSTRAINT (no IF NOT EXISTS)
// and this repo has no migration journal guaranteeing exactly-once applies.
// Migration 0026 is the additive, re-runnable guard. This test proves:
//   1. 0020 is untouched and still carries the unguarded statement
//      (documents WHY 0026 exists; history is not rewritten).
//   2. 0026 contains the three branches: add-if-missing, no-op-if-correct,
//      fail-closed-if-incompatible. No DROP/TRUNCATE/destructive ALTER.
//   3. Live idempotency: applying 0026 twice to a target that already has
//      the constraint succeeds both times with exactly one constraint.
//      Target comes from $PHASE3G3_GUARD_TEST_URL (rehearsal clone); the URL
//      is never printed.

const M20 = readFileSync(new URL("../lib/db/migrations/0020_historical_promotion_approval.sql", import.meta.url), "utf8");
assert.ok(/ADD CONSTRAINT historical_operation_imports_promoted_hash_check/.test(M20), "0020 must still carry the original statement");

const M26 = readFileSync(new URL("../lib/db/migrations/0026_historical_promoted_hash_guard.sql", import.meta.url), "utf8");
assert.ok(/pg_constraint/.test(M26) && /conname = 'historical_operation_imports_promoted_hash_check'/.test(M26), "0026 must check constraint existence");
assert.ok(/RAISE EXCEPTION/.test(M26), "0026 must fail closed on incompatible definition");
const codeOnly = M26.replace(/--[^\n]*/g, "");
assert.ok(!/DROP\s+(CONSTRAINT|TABLE)|TRUNCATE/i.test(codeOnly), "0026 must contain no destructive DDL");

const target = process.env.PHASE3G3_GUARD_TEST_URL;
assert.ok(target, "PHASE3G3_GUARD_TEST_URL required (rehearsal clone, never production)");
const apply = () => execFileSync("psql", [target, "-v", "ON_ERROR_STOP=1", "-f", "lib/db/migrations/0026_historical_promoted_hash_guard.sql"], { stdio: "pipe" });
apply();
apply();
const count = execFileSync("psql", [target, "-t", "-A", "-c",
  "select count(*) from pg_constraint where conname='historical_operation_imports_promoted_hash_check';"],
  { encoding: "utf8" }).trim();
assert.equal(count, "1", "exactly one guard constraint after double apply");

console.log("phase3g3 promoted-hash guard focused tests: passed");
