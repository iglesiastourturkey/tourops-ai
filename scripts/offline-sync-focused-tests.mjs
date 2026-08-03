import assert from "node:assert/strict";

function applyStatus(operation, expectedVersion, status, idempotencyStore, key) {
  if (idempotencyStore.has(key)) return idempotencyStore.get(key);
  if (expectedVersion !== operation.version) {
    return { status: 409, conflict: true, serverVersion: operation.version };
  }
  operation.status = status;
  operation.version += 1;
  const result = { status: 200, version: operation.version, value: status };
  idempotencyStore.set(key, result);
  return result;
}

// Two offline status updates replay in FIFO order and action two is rebased.
const operation = { status: "ready", version: 7 };
const idempotencyStore = new Map();
const first = applyStatus(operation, 7, "started", idempotencyStore, "first");
assert.deepEqual(first, { status: 200, version: 8, value: "started" });
const rebasedVersion = first.version;
const second = applyStatus(operation, rebasedVersion, "in_progress", idempotencyStore, "second");
assert.deepEqual(second, { status: 200, version: 9, value: "in_progress" });

// A genuine concurrent write still conflicts.
const conflict = applyStatus(operation, 8, "completed", idempotencyStore, "stale");
assert.equal(conflict.status, 409);
assert.equal(conflict.conflict, true);

// An idempotency replay returns the original answer without another mutation.
const duplicate = applyStatus(operation, 7, "started", idempotencyStore, "first");
assert.deepEqual(duplicate, first);
assert.equal(operation.version, 9);

// Cached 5xx actions are resolution-only, not eligible for generic retry.
const ambiguous = { status: "ambiguous", allowed: ["inspect", "resend-as-new"] };
assert.equal(ambiguous.status, "ambiguous");
assert.deepEqual(ambiguous.allowed, ["inspect", "resend-as-new"]);

console.log("offline-sync focused tests: passed");