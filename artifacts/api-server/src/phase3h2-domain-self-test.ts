import assert from "node:assert/strict";
import { cruiseFieldState, normalizeHistoricalPickupTime, operationTypeFromHistoricalSourceKind } from "./lib/operation-domain";
import { normalizeHistoricalEmail, normalizeHistoricalPhone, resolveCustomerIdentity, summarizeHistoricalContacts } from "./lib/historical-customer-projection";

assert.equal(operationTypeFromHistoricalSourceKind("gemi"), "CRUISE");
assert.equal(operationTypeFromHistoricalSourceKind("sejour"), "SEJOUR");
assert.equal(operationTypeFromHistoricalSourceKind("unknown"), null);
assert.equal(cruiseFieldState("SEJOUR", null), "NOT_APPLICABLE");
assert.equal(cruiseFieldState("CRUISE", "MSC"), "PRESENT");
assert.equal(normalizeHistoricalPickupTime("1899-12-30T07:15:00.000Z"), "07:15");
assert.equal(normalizeHistoricalPickupTime("08:30"), "08:30");
assert.equal(normalizeHistoricalPickupTime(null), null);
assert.equal(normalizeHistoricalPickupTime("11.15"), "11.15");
assert.equal(normalizeHistoricalPickupTime("8::30"), "8::30");
assert.equal(normalizeHistoricalPickupTime("1899-12-30T23:59:00.000Z"), "23:59");

assert.equal(normalizeHistoricalEmail(" Person@Example.COM "), "person@example.com");
assert.equal(normalizeHistoricalPhone("+90 (555) 123 45 67"), "+905551234567");
const same = resolveCustomerIdentity({ contact: { sourceKey: "a", fullName: "A", email: "A@X.COM", phone: "+90 555 1 2 3 4 5 6 7" }, customerByEmail: new Map([["a@x.com", 4]]), customerByPhone: new Map([["+905551234567", 4]]) });
assert.deepEqual(same, { outcome: "EXISTING", customerId: 4 });
const conflict = resolveCustomerIdentity({ contact: { sourceKey: "a", fullName: "A", email: "a@x.com", phone: "5551234567" }, customerByEmail: new Map([["a@x.com", 4]]), customerByPhone: new Map([["5551234567", 5]]) });
assert.equal(conflict.outcome, "CONFLICT");
assert.equal(resolveCustomerIdentity({ contact: { sourceKey: "a", fullName: "Name only", email: null, phone: null }, customerByEmail: new Map(), customerByPhone: new Map() }).outcome, "SKIPPED_NO_IDENTITY");
const summary = summarizeHistoricalContacts([
  { sourceKey: "1", fullName: "A", email: "a@x.com", phone: null },
  { sourceKey: "2", fullName: "A", email: "A@X.COM", phone: null },
]);
assert.equal(summary.uniqueNormalizedEmails, 1);
assert.equal(summary.reservationsRepresentedByRepeatIdentities, 2);
console.log("phase3h2 domain self-test: ok");
