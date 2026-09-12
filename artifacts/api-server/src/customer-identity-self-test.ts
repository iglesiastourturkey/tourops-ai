import assert from "node:assert/strict";
import {
  buildCustomerIdentityKey,
  canonicalJson,
  identityEvidenceHash,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  pickLaneCandidate,
  sha256Hex,
} from "./lib/customer-identity";

// --- normalization: exact historical semantics ---
assert.equal(normalizeCustomerEmail("  HANS@Example.COM "), "hans@example.com");
assert.equal(normalizeCustomerEmail("not-an-email"), null);
assert.equal(normalizeCustomerEmail(null), null);
assert.equal(normalizeCustomerEmail("a@b"), null);
assert.equal(normalizeCustomerPhone("+90 544 514 92 59"), "+905445149259");
assert.equal(normalizeCustomerPhone("18653007328"), "18653007328");
assert.equal(normalizeCustomerPhone("123"), null);
assert.equal(normalizeCustomerPhone("1".repeat(16)), null);
assert.equal(normalizeCustomerPhone(null), null);

// --- identity key: names never participate ---
assert.equal(
  buildCustomerIdentityKey({ email: "A@B.CO", phone: "+1 865 300 7328" }),
  "email:a@b.co|phone:+18653007328",
);
assert.equal(buildCustomerIdentityKey({ email: "a@b.co", phone: null }), "email:a@b.co");
assert.equal(buildCustomerIdentityKey({ email: null, phone: "14073251467" }), "phone:14073251467");
assert.equal(buildCustomerIdentityKey({ email: null, phone: null }), null);
assert.equal(buildCustomerIdentityKey({ email: "bad", phone: "12" }), null);

// --- canonical JSON is key-order stable ---
assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
assert.equal(canonicalJson({ a: undefined, b: 1 }), canonicalJson({ b: 1 }));
assert.match(sha256Hex("x"), /^[0-9a-f]{64}$/);

// --- evidence hash binds provenance + identity + action ---
const binding = {
  sourceKey: "legacy:file1:ws:3",
  historicalImportId: 9,
  reservationId: 4,
  operationId: 7,
  sourceFileId: "file1",
  worksheetName: "ws",
  sourceRow: 3,
  normalizedEmail: "a@b.co",
  normalizedPhone: "+18653007328",
  identityKey: "email:a@b.co|phone:+18653007328",
  action: "CREATE" as const,
};
const hash = identityEvidenceHash(binding);
assert.match(hash, /^[0-9a-f]{64}$/);
assert.equal(identityEvidenceHash({ ...binding, action: "REUSE" }) === hash, false);
assert.equal(identityEvidenceHash({ ...binding, reservationId: 5 }) === hash, false);
assert.equal(identityEvidenceHash({ ...binding }) === hash, true);

// --- lane multiplicity: 0 none, 1 deterministic, >1 conflict (never first-row) ---
assert.deepEqual(pickLaneCandidate([]), { id: null, multiple: false });
assert.deepEqual(pickLaneCandidate([7]), { id: 7, multiple: false });
assert.deepEqual(pickLaneCandidate([7, 7]), { id: 7, multiple: false });
assert.deepEqual(pickLaneCandidate([7, 9]), { id: null, multiple: true });

console.log("customer identity self-test: passed");
