import assert from "node:assert/strict";
import {
  MAX_APPLY_LIMIT,
  customerProjectionWriteFlags,
  parseProductionCustomerProjectionArgs,
  selectedProjectionRecords,
  summarizeCustomerProjectionApply,
} from "./historical-customer-projection-production";

assert.equal(MAX_APPLY_LIMIT, 25);

// --- PLAN needs only --input ---
assert.deepEqual(
  parseProductionCustomerProjectionArgs(["--input", "package.json"]),
  { inputPath: "package.json", sourceKeys: [], limit: null, apply: false, operatorProfileId: null },
);

// --- APPLY targeting strictness ---
const key = "legacy:file1:ws:3";
assert.throws(
  () => parseProductionCustomerProjectionArgs(["--input", "p.json", "--apply", "--source-key", key]),
  /tam onay/,
);
assert.throws(
  () => parseProductionCustomerProjectionArgs([
    "--input", "p.json", "--apply", "--confirm-production-customer-projection",
    "TOURPILOT_2026_PRODUCTION_CUSTOMER_PROJECTION", "--source-key", key,
  ]),
  /--operator-profile-id zorunludur/,
);
assert.throws(
  () => parseProductionCustomerProjectionArgs([
    "--input", "p.json", "--apply", "--confirm-production-customer-projection",
    "WRONG", "--source-key", key, "--operator-profile-id", "1",
  ]),
  /tam onay/,
);
assert.throws(
  () => parseProductionCustomerProjectionArgs([
    "--input", "p.json", "--apply", "--confirm-production-customer-projection",
    "TOURPILOT_2026_PRODUCTION_CUSTOMER_PROJECTION", "--limit", "26", "--operator-profile-id", "1",
  ]),
  /en fazla/,
);
assert.throws(
  () => parseProductionCustomerProjectionArgs([
    "--input", "p.json", "--apply", "--confirm-production-customer-projection",
    "TOURPILOT_2026_PRODUCTION_CUSTOMER_PROJECTION", "--source-key", "not-a-key",
    "--operator-profile-id", "1",
  ]),
  /canonical legacy/,
);
assert.throws(
  () => parseProductionCustomerProjectionArgs([
    "--input", "p.json", "--apply", "--confirm-production-customer-projection",
    "TOURPILOT_2026_PRODUCTION_CUSTOMER_PROJECTION", "--source-key", key,
    "--source-key", key, "--operator-profile-id", "1",
  ]),
  /Tekrar eden/,
);
const parsed = parseProductionCustomerProjectionArgs([
  "--input", "p.json", "--apply", "--confirm-production-customer-projection",
  "TOURPILOT_2026_PRODUCTION_CUSTOMER_PROJECTION", "--source-key", key, "--operator-profile-id", "2",
]);
assert.equal(parsed.operatorProfileId, 2);
assert.deepEqual(parsed.sourceKeys, [key]);

// --- selection: PLAN inspects everything, APPLY targets exactly ---
const records = [
  { sourceKey: "legacy:a:b:1" },
  { sourceKey: "legacy:a:b:2" },
] as never[];
const pkg = { records } as never;
assert.equal(selectedProjectionRecords(pkg, { inputPath: "p", sourceKeys: [], limit: null, apply: false, operatorProfileId: null }).length, 2);
assert.deepEqual(
  selectedProjectionRecords(pkg, { inputPath: "p", sourceKeys: ["legacy:a:b:2"], limit: null, apply: true, operatorProfileId: 1 }).map(r => (r as { sourceKey: string }).sourceKey),
  ["legacy:a:b:2"],
);
assert.throws(
  () => selectedProjectionRecords(pkg, { inputPath: "p", sourceKeys: ["legacy:a:b:9"], limit: null, apply: true, operatorProfileId: 1 }),
  /bulunamadi/,
);

// --- summary + write flags: reuse/create never claim operation writes ---
assert.deepEqual(summarizeCustomerProjectionApply(["reused", "created", "existing", "conflict", "blocked", "failed"]), {
  attempted: 6, reused: 1, created: 1, existing: 1, conflict: 1, blocked: 1, failed: 1,
});
assert.deepEqual(customerProjectionWriteFlags({ attempted: 1, reused: 0, created: 1, existing: 0, conflict: 0, blocked: 0, failed: 0 }), {
  databaseWrites: true, operationWrites: false, customerWrites: true, reservationWrites: true,
});
assert.deepEqual(customerProjectionWriteFlags({ attempted: 1, reused: 1, created: 0, existing: 0, conflict: 0, blocked: 0, failed: 0 }), {
  databaseWrites: true, operationWrites: false, customerWrites: false, reservationWrites: true,
});
assert.deepEqual(customerProjectionWriteFlags({ attempted: 1, reused: 0, created: 0, existing: 1, conflict: 0, blocked: 0, failed: 0 }), {
  databaseWrites: false, operationWrites: false, customerWrites: false, reservationWrites: false,
});

console.log("customer projection production self-test: passed");
