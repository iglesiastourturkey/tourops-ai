import assert from "node:assert/strict";
import { parseProductionPickupTimeCorrectionArgs } from "./historical-pickup-time-correction-production";
import { validateProductionPickupTimeCorrectionTarget } from "./lib/historical-pickup-time-correction";

// Phase 3H.3B3 — production-only guard + arg parser. Pure unit coverage, no DB.

// --- production target guard ---
assert.throws(() => validateProductionPickupTimeCorrectionTarget({}), /NODE_ENV=production/);
assert.throws(() => validateProductionPickupTimeCorrectionTarget({ NODE_ENV: "development" }), /NODE_ENV=production/);
assert.throws(() => validateProductionPickupTimeCorrectionTarget({ NODE_ENV: "production" }), /gerekli/);
assert.throws(() => validateProductionPickupTimeCorrectionTarget({
  NODE_ENV: "production",
  PRODUCTION_DATABASE_URL: "https://x.neon.tech/db",
  PRODUCTION_DATABASE_HOST: "x.neon.tech",
}), /PostgreSQL/);
assert.throws(() => validateProductionPickupTimeCorrectionTarget({
  NODE_ENV: "production",
  PRODUCTION_DATABASE_URL: "postgresql://other.neon.tech/db",
  PRODUCTION_DATABASE_HOST: "x.neon.tech",
}), /allowlist/);
assert.throws(() => validateProductionPickupTimeCorrectionTarget({
  NODE_ENV: "production",
  PRODUCTION_DATABASE_URL: "postgresql://db.example.com/db",
  PRODUCTION_DATABASE_HOST: "db.example.com",
}), /Neon/);
assert.equal(
  validateProductionPickupTimeCorrectionTarget({
    NODE_ENV: "production",
    PRODUCTION_DATABASE_URL: "postgresql://u:p@prod-1.neon.tech/db",
    PRODUCTION_DATABASE_HOST: "prod-1.neon.tech",
  }),
  "postgresql://u:p@prod-1.neon.tech/db",
  "valid production target must return the connection string without logging it",
);

// --- production arg parser ---
assert.throws(() => parseProductionPickupTimeCorrectionArgs([]), /--input/);
assert.throws(() => parseProductionPickupTimeCorrectionArgs(["--input", "p.json", "--bogus"]), /Desteklenmeyen/);
assert.throws(() => parseProductionPickupTimeCorrectionArgs(["--input", "p.json", "--limit", "5"]), /yalnizca --apply/);
assert.throws(() => parseProductionPickupTimeCorrectionArgs(["--input", "p.json", "--apply"]), /tam olarak --source-key veya --limit/);
assert.throws(() => parseProductionPickupTimeCorrectionArgs([
  "--input", "p.json", "--apply", "--limit", "3", "--source-key", "legacy:a:b:1",
  "--confirm-production-pickup-correction", "TOURPILOT_2026_PRODUCTION_PICKUP_CORRECTION",
  "--operator-profile-id", "2",
]), /tam olarak --source-key veya --limit/);
assert.throws(() => parseProductionPickupTimeCorrectionArgs([
  "--input", "p.json", "--apply", "--limit", "26",
  "--confirm-production-pickup-correction", "TOURPILOT_2026_PRODUCTION_PICKUP_CORRECTION",
  "--operator-profile-id", "2",
]), /en fazla 25/);
assert.throws(() => parseProductionPickupTimeCorrectionArgs([
  "--input", "p.json", "--apply", "--limit", "3",
  "--confirm-production-pickup-correction", "WRONG",
  "--operator-profile-id", "2",
]), /tam onay ifadesi/);
assert.throws(() => parseProductionPickupTimeCorrectionArgs([
  "--input", "p.json", "--apply", "--limit", "3",
  "--confirm-production-pickup-correction", "TOURPILOT_2026_PRODUCTION_PICKUP_CORRECTION",
]), /--operator-profile-id zorunludur/);
assert.throws(() => parseProductionPickupTimeCorrectionArgs([
  "--input", "p.json", "--apply", "--limit", "3",
  "--confirm-production-pickup-correction", "TOURPILOT_2026_HISTORICAL_PICKUP_CORRECTION",
  "--operator-profile-id", "2",
]), /tam onay ifadesi/, "staging confirmation must not authorize production APPLY");

const plan = parseProductionPickupTimeCorrectionArgs(["--input", "pkg.json"]);
assert.deepEqual(plan, { inputPath: "pkg.json", sourceKeys: [], limit: null, apply: false, operatorProfileId: null });

const apply = parseProductionPickupTimeCorrectionArgs([
  "--input", "pkg.json", "--apply", "--limit", "25",
  "--confirm-production-pickup-correction", "TOURPILOT_2026_PRODUCTION_PICKUP_CORRECTION",
  "--operator-profile-id", "7",
]);
assert.deepEqual(apply, { inputPath: "pkg.json", sourceKeys: [], limit: 25, apply: true, operatorProfileId: 7 });

console.log("historical production pickup-time correction self-test: passed");
