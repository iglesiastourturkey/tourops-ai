import assert from "node:assert/strict";
import {
  assessCustomerProjection,
  buildProjectionRecords,
  parseCustomerProjectionPackage,
  resolveCreateReuseDowngrade,
  type CustomerProjectionRecord,
  type ProjectionDbState,
} from "./lib/historical-customer-projection-package";
import { identityEvidenceHash } from "./lib/customer-identity";

function makeRecord(overrides: Partial<CustomerProjectionRecord> = {}): CustomerProjectionRecord {
  const base = {
    sourceKey: "legacy:file1:ws:3",
    historicalImportId: 9,
    reservationId: 4,
    operationId: 7,
    sourceFileId: "file1",
    worksheetName: "ws",
    sourceRow: 3,
    normalizedPhone: "+18653007328",
    normalizedEmail: null,
    identityKey: "phone:+18653007328",
    action: "CREATE" as const,
    expectedReservationCustomerId: null,
    expectedReservationVersion: 1,
    expectedLeadGuestName: "Jane Doe",
  };
  const record = { ...base, ...overrides };
  const withHash = {
    ...record,
    identityEvidenceHash: identityEvidenceHash({
      sourceKey: record.sourceKey,
      historicalImportId: record.historicalImportId,
      reservationId: record.reservationId,
      operationId: record.operationId,
      sourceFileId: record.sourceFileId,
      worksheetName: record.worksheetName,
      sourceRow: record.sourceRow,
      normalizedEmail: record.normalizedEmail,
      normalizedPhone: record.normalizedPhone,
      identityKey: record.identityKey,
      action: record.action,
    }),
  };
  return parseCustomerProjectionPackage({
    mode: "historical-customer-projection",
    version: 1,
    kind: "historical-customer-projection",
    generatedAt: "2026-09-12T00:00:00.000Z",
    databaseWrites: false,
    records: [withHash],
  }).records[0];
}

const liveState = {
  reservation: {
    id: 4, customerId: null, version: 1,
    leadGuestName: "Jane Doe", sourceHistoricalKey: "legacy:file1:ws:3",
  },
  importStatus: "imported",
  customerByIdentityKey: null,
  customerByEmail: null,
  customerByPhone: null,
  laneConflict: null,
  targetCustomer: null,
};

// --- schema guards ---
assert.throws(() => makeRecord({ identityKey: "phone:wrong" }), /identityKey/);
assert.throws(() => makeRecord({ action: "REUSE" }), /hedef musteri/);
assert.throws(() => parseCustomerProjectionPackage({
  mode: "historical-customer-projection", version: 1, kind: "historical-customer-projection",
  generatedAt: "x", databaseWrites: false, records: [makeRecord(), makeRecord()],
}), /tekrar eden/);

// --- generator classifications ---
const reservationState = {
  sourceKey: "legacy:file1:ws:3", reservationId: 4, operationId: 7,
  leadGuestName: "Jane Doe", customerId: null, version: 1, historicalImportId: 9,
};
const evidenceOf = (emailRaw: string | null, phoneRaw: string | null, name: string | null = "Jane Doe") => ({
  sourceKey: "legacy:file1:ws:3", sourceFileId: "file1", worksheetName: "ws",
  sourceRow: 3, leadGuestName: name, emailRaw, phoneRaw,
});
const emptyMaps = {
  customerIdByIdentityKey: new Map<string, number>(),
  customerIdByEmail: new Map<string, number>(),
  customerIdByPhone: new Map<string, number>(),
};
let [only] = buildProjectionRecords({
  evidence: [evidenceOf(null, "+18653007328")],
  reservations: [reservationState],
  ...emptyMaps,
});
assert.equal(only.classification, "SAFE_CREATE_NEW_CUSTOMER");
assert.equal(only.record?.action, "CREATE");

[only] = buildProjectionRecords({
  evidence: [evidenceOf(null, "+18653007328")],
  reservations: [reservationState],
  customerIdByIdentityKey: new Map<string, number>([["phone:+18653007328", 11]]),
  customerIdByEmail: new Map<string, number>(),
  customerIdByPhone: new Map<string, number>(),
});
assert.equal(only.classification, "SAFE_REUSE_EXISTING_CUSTOMER");
assert.equal(only.record?.expectedReservationCustomerId, 11);

[only] = buildProjectionRecords({
  evidence: [evidenceOf("a@b.co", "+18653007328")],
  reservations: [reservationState],
  customerIdByIdentityKey: new Map<string, number>(),
  customerIdByEmail: new Map<string, number>([["a@b.co", 11]]),
  customerIdByPhone: new Map<string, number>([["+18653007328", 12]]),
});
assert.equal(only.classification, "CONFLICT_PHONE_EMAIL");
assert.equal(only.record, null);

// name-only never SAFE
[only] = buildProjectionRecords({
  evidence: [evidenceOf(null, null, "Jane Doe")],
  reservations: [reservationState],
  ...emptyMaps,
});
assert.equal(only.classification, "NAME_ONLY");

// missing identity
[only] = buildProjectionRecords({
  evidence: [evidenceOf(null, null, null)],
  reservations: [reservationState],
  ...emptyMaps,
});
assert.equal(only.classification, "MISSING_IDENTITY");

// invalid phone/email
[only] = buildProjectionRecords({
  evidence: [evidenceOf(null, "12")],
  reservations: [reservationState],
  ...emptyMaps,
});
assert.equal(only.classification, "INVALID_PHONE");
[only] = buildProjectionRecords({
  evidence: [evidenceOf("bad", null)],
  reservations: [reservationState],
  ...emptyMaps,
});
assert.equal(only.classification, "INVALID_EMAIL");

// multi-name phone group -> manual review, no SAFE
const multi = buildProjectionRecords({
  evidence: [
    { sourceKey: "legacy:file1:ws:3", sourceFileId: "file1", worksheetName: "ws", sourceRow: 3, leadGuestName: "Jane Doe", emailRaw: null, phoneRaw: "+18653007328" },
    { sourceKey: "legacy:file1:ws:4", sourceFileId: "file1", worksheetName: "ws", sourceRow: 4, leadGuestName: "John Doe", emailRaw: null, phoneRaw: "+18653007328" },
  ],
  reservations: [
    reservationState,
    { ...reservationState, sourceKey: "legacy:file1:ws:4", reservationId: 5 },
  ],
  ...emptyMaps,
});
assert.ok(multi.every(o => o.classification === "MANUAL_REVIEW" && o.record === null));

// already-linked reservation -> conflict existing link
[only] = buildProjectionRecords({
  evidence: [evidenceOf(null, "+18653007328")],
  reservations: [{ ...reservationState, customerId: 11 }],
  ...emptyMaps,
});
assert.equal(only.classification, "CONFLICT_EXISTING_LINK");

// --- assess decision table ---
const createRecord = makeRecord();
assert.equal(assessCustomerProjection({ record: createRecord, state: liveState }).classification, "SAFE_CREATE_NEW_CUSTOMER");
assert.equal(
  assessCustomerProjection({ record: createRecord, state: { ...liveState, customerByIdentityKey: 11 } }).classification,
  "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS",
);
assert.equal(
  assessCustomerProjection({
    record: createRecord,
    state: { ...liveState, reservation: { ...liveState.reservation, version: 2 } },
  }).classification,
  "STALE_EVIDENCE",
);
assert.equal(
  assessCustomerProjection({
    record: createRecord,
    state: { ...liveState, reservation: { ...liveState.reservation, leadGuestName: "Changed" } },
  }).classification,
  "STALE_EVIDENCE",
);
// linked to a customer the identity lane does not resolve to -> someone
// linked elsewhere, fail closed as a link conflict (not this record's result)
assert.equal(
  assessCustomerProjection({
    record: createRecord,
    state: { ...liveState, reservation: { ...liveState.reservation, customerId: 11 } },
  }).classification,
  "CONFLICT_EXISTING_LINK",
);
assert.equal(
  assessCustomerProjection({ record: createRecord, state: { ...liveState, reservation: null } }).classification,
  "SOURCE_MISMATCH",
);
assert.equal(
  assessCustomerProjection({ record: createRecord, state: { ...liveState, importStatus: "pending" } }).classification,
  "SOURCE_MISMATCH",
);
const reuseRecord = makeRecord({ action: "REUSE", expectedReservationCustomerId: 11 });
const activeTarget = { id: 11, archivedAt: null, identityKey: "phone:+18653007328" };
assert.equal(
  assessCustomerProjection({
    record: reuseRecord,
    state: { ...liveState, targetCustomer: activeTarget },
  }).classification,
  "SAFE_REUSE_EXISTING_CUSTOMER",
);
// --- successful REUSE replay: linked to 11, version exactly +1, lanes agree ---
assert.equal(
  assessCustomerProjection({
    record: reuseRecord,
    state: {
      ...liveState,
      reservation: { ...liveState.reservation, customerId: 11, version: 2 },
      customerByIdentityKey: 11,
      customerByPhone: 11,
      targetCustomer: activeTarget,
    },
  }).classification,
  "ALREADY_LINKED",
);
// --- wrong linked customer fails closed ---
assert.equal(
  assessCustomerProjection({
    record: reuseRecord,
    state: {
      ...liveState,
      reservation: { ...liveState.reservation, customerId: 12, version: 2 },
      customerByIdentityKey: 11,
      targetCustomer: activeTarget,
    },
  }).classification,
  "CONFLICT_EXISTING_LINK",
);
// --- version beyond expected+1 fails closed (unexpected drift) ---
assert.equal(
  assessCustomerProjection({
    record: reuseRecord,
    state: {
      ...liveState,
      reservation: { ...liveState.reservation, customerId: 11, version: 3 },
      customerByIdentityKey: 11,
      targetCustomer: activeTarget,
    },
  }).classification,
  "STALE_EVIDENCE",
);
// --- lane multiplicity on replay fails closed ---
assert.equal(
  assessCustomerProjection({
    record: reuseRecord,
    state: {
      ...liveState,
      reservation: { ...liveState.reservation, customerId: 11, version: 2 },
      customerByIdentityKey: 11,
      laneConflict: "phone",
      targetCustomer: activeTarget,
    },
  }).classification,
  "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS",
);
// --- lane disagreement on replay fails closed ---
assert.equal(
  assessCustomerProjection({
    record: reuseRecord,
    state: {
      ...liveState,
      reservation: { ...liveState.reservation, customerId: 11, version: 2 },
      customerByIdentityKey: 11,
      customerByPhone: 12,
      targetCustomer: activeTarget,
    },
  }).classification,
  "CONFLICT_PHONE_EMAIL",
);
// --- target identity drift fails closed ---
assert.equal(
  assessCustomerProjection({
    record: reuseRecord,
    state: {
      ...liveState,
      reservation: { ...liveState.reservation, customerId: 11, version: 2 },
      customerByIdentityKey: 11,
      targetCustomer: { id: 11, archivedAt: null, identityKey: "phone:+1999" },
    },
  }).classification,
  "STALE_EVIDENCE",
);
assert.equal(
  assessCustomerProjection({
    record: reuseRecord,
    state: { ...liveState, targetCustomer: { id: 11, archivedAt: new Date(), identityKey: "phone:+18653007328" } },
  }).classification,
  "MANUAL_REVIEW",
);
// --- successful CREATE replay: linked to the deterministic identity customer ---
const createdState = {
  ...liveState,
  reservation: { ...liveState.reservation, customerId: 21, version: 2 },
  customerByIdentityKey: 21,
};
assert.equal(
  assessCustomerProjection({ record: createRecord, state: createdState }).classification,
  "ALREADY_LINKED",
);
// --- CREATE replay linked elsewhere fails closed ---
assert.equal(
  assessCustomerProjection({
    record: createRecord,
    state: {
      ...liveState,
      reservation: { ...liveState.reservation, customerId: 22, version: 2 },
      customerByIdentityKey: 21,
    },
  }).classification,
  "CONFLICT_EXISTING_LINK",
);
// second run after CREATE behaves as reuse/existing: identity now resolves
assert.equal(
  assessCustomerProjection({
    record: createRecord,
    state: { ...liveState, customerByIdentityKey: 21 },
  }).classification !== "SAFE_CREATE_NEW_CUSTOMER",
  true,
);

// --- Phase 3H.4B1: CREATE→REUSE downgrade decision table (pure) ---
const downgradeState = (overrides: Partial<ProjectionDbState> = {}): ProjectionDbState => ({
  reservation: {
    id: 4, customerId: null, version: 1,
    leadGuestName: "Jane Doe", sourceHistoricalKey: "legacy:file1:ws:3",
  },
  importStatus: "imported",
  customerByIdentityKey: 21,
  customerByEmail: null,
  customerByPhone: null,
  laneConflict: null,
  targetCustomer: null,
  ...overrides,
});
// A/B. sequential/concurrent loser: single agreeing identity lane -> reuse id
assert.equal(
  resolveCreateReuseDowngrade({
    record: createRecord,
    state: downgradeState(),
    classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS",
    reservationCustomerId: null,
  }),
  21,
);
// lanes agreeing with the identity customer also permit downgrade
assert.equal(
  resolveCreateReuseDowngrade({
    record: createRecord,
    state: downgradeState({ customerByPhone: 21 }),
    classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS",
    reservationCustomerId: null,
  }),
  21,
);
// F. lane disagreement never downgrades
assert.equal(
  resolveCreateReuseDowngrade({
    record: createRecord,
    state: downgradeState({ customerByPhone: 22 }),
    classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS",
    reservationCustomerId: null,
  }),
  null,
);
// G. multiplicity never downgrades
assert.equal(
  resolveCreateReuseDowngrade({
    record: createRecord,
    state: downgradeState({ laneConflict: "identity" }),
    classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS",
    reservationCustomerId: null,
  }),
  null,
);
// non-CREATE records never downgrade
assert.equal(
  resolveCreateReuseDowngrade({
    record: reuseRecord,
    state: downgradeState(),
    classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS",
    reservationCustomerId: null,
  }),
  null,
);
// non-conflict classifications never downgrade
assert.equal(
  resolveCreateReuseDowngrade({
    record: createRecord,
    state: downgradeState(),
    classification: "SAFE_CREATE_NEW_CUSTOMER",
    reservationCustomerId: null,
  }),
  null,
);
// already-linked reservations never downgrade (replay owns that path)
assert.equal(
  resolveCreateReuseDowngrade({
    record: createRecord,
    state: downgradeState(),
    classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS",
    reservationCustomerId: 21,
  }),
  null,
);
// missing identity lane never downgrades
assert.equal(
  resolveCreateReuseDowngrade({
    record: createRecord,
    state: downgradeState({ customerByIdentityKey: null }),
    classification: "CONFLICT_MULTIPLE_EXISTING_CUSTOMERS",
    reservationCustomerId: null,
  }),
  null,
);

console.log("customer projection package self-test: passed");
