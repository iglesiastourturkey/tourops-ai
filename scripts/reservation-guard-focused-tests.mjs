import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Focused tests for the human-approval gate on
// POST /api/reservations/:id/create-draft
// (artifacts/api-server/src/routes/reservations.ts).
//
// Same shape as offline-sync-focused-tests.mjs: the decision chain is mirrored
// as a pure function here rather than imported, because the real handler pulls
// in express + a live DB connection. The mirror is kept honest by the source
// assertions at the bottom of this file, which fail loudly if the route's guard
// order changes or the raw-AI-output fallback is reintroduced.

const ROUTE_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/reservations.ts", import.meta.url),
  "utf8",
);

// Reviewable field keys are read from the route's own zod schema so adding a
// field there does not silently desync this test.
const REVIEWABLE_FIELDS = new Set(
  [...(ROUTE_SOURCE.match(/const reservationFields = z\.object\(\{([\s\S]*?)\n\}\);/)?.[1] ?? "")
    .matchAll(/(\w+):\s*z\./g)].map((match) => match[1]),
);
assert.ok(
  REVIEWABLE_FIELDS.size >= 20,
  `reservationFields schema could not be read from the route (found ${REVIEWABLE_FIELDS.size} keys). ` +
    "If the schema was restructured, update this extraction.",
);

// 0 and false are meaningful values (childCount: 0, transferRequired: false);
// only null/undefined/blank strings count as "not filled in".
function isBlankValue(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

// Stand-in for reservationFields.safeParse. Only models the rules the guard
// chain depends on — the schema itself is zod's responsibility, not this test's.
function parseApproved(approvedData) {
  if (typeof approvedData !== "object" || approvedData === null || Array.isArray(approvedData)) {
    return { success: false };
  }
  const tourDate = approvedData.tourDate;
  if (tourDate !== null && tourDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(tourDate))) {
    return { success: false };
  }
  return { success: true, data: approvedData };
}

/** Mirror of the create-draft guard chain. Returns the response it would send. */
function decideCreateDraft(item, extraction) {
  if (!item || !extraction) return { status: 409 };
  if (item.operationId) return { status: 200, duplicate: true, operationId: item.operationId };

  if (extraction.approvedData === null || extraction.approvedData === undefined) {
    return { status: 400, code: "approval_required" };
  }
  const approved = parseApproved(extraction.approvedData);
  if (!approved.success) return { status: 400, code: "invalid_approved_data" };
  const data = approved.data;

  const unresolvedFields = (extraction.missingFields ?? []).filter(
    (field) => REVIEWABLE_FIELDS.has(field) && isBlankValue(data[field]),
  );
  if (unresolvedFields.length) {
    return { status: 400, code: "missing_fields", missingFields: unresolvedFields };
  }

  if (!data.customerName) return { status: 400, code: "customer_name_required" };
  if (isBlankValue(data.tourDate)) return { status: 400, code: "tour_date_required" };
  return { status: 201, created: true };
}

const complete = { customerName: "Ada Lovelace", tourDate: "2026-09-01" };
const noOp = { operationId: null };

// ── The happy path still works ───────────────────────────────────────────────
assert.deepEqual(
  decideCreateDraft(noOp, { approvedData: complete, missingFields: [] }),
  { status: 201, created: true },
);

// ── Duplicate short-circuit runs before every guard ──────────────────────────
// An import that already produced an operation must return that operation even
// though its extraction would fail all three new guards.
assert.deepEqual(
  decideCreateDraft({ operationId: 42 }, { approvedData: null, missingFields: ["tourDate"] }),
  { status: 200, duplicate: true, operationId: 42 },
);

// ── 1. Approval is mandatory; raw AI output is never a fallback ──────────────
assert.deepEqual(
  decideCreateDraft(noOp, { approvedData: null, extractedData: complete, missingFields: [] }),
  { status: 400, code: "approval_required" },
);
assert.deepEqual(
  decideCreateDraft(noOp, { approvedData: undefined, extractedData: complete, missingFields: [] }),
  { status: 400, code: "approval_required" },
);

// ── 2. Approved data that no longer matches the schema is rejected, not 500'd ─
assert.equal(
  decideCreateDraft(noOp, { approvedData: "not-an-object", missingFields: [] }).code,
  "invalid_approved_data",
);
assert.equal(
  decideCreateDraft(noOp, { approvedData: { ...complete, tourDate: "01/09/2026" }, missingFields: [] }).code,
  "invalid_approved_data",
);

// ── 3. Required fields still blank block the draft, and name the fields ──────
assert.deepEqual(
  decideCreateDraft(noOp, {
    approvedData: { ...complete, hotelName: null },
    missingFields: ["hotelName"],
  }),
  { status: 400, code: "missing_fields", missingFields: ["hotelName"] },
);
assert.deepEqual(
  decideCreateDraft(noOp, {
    approvedData: { ...complete, hotelName: "   " },
    missingFields: ["hotelName"],
  }).missingFields,
  ["hotelName"],
);
// Only the fields that are actually still blank are reported.
assert.deepEqual(
  decideCreateDraft(noOp, {
    approvedData: { ...complete, adultCount: 2, childCount: 0, hotelName: null },
    missingFields: ["adultCount", "childCount", "hotelName"],
  }).missingFields,
  ["hotelName"],
);

// ── 4. Filling the gaps in review lifts the block ────────────────────────────
// PATCH /:id/review does not recompute extraction.missingFields, so the guard
// must evaluate the stored list against the approved data. Without this, a
// record the reviewer already completed would stay blocked forever.
assert.deepEqual(
  decideCreateDraft(noOp, {
    approvedData: { ...complete, hotelName: "Hilton" },
    missingFields: ["hotelName"],
  }),
  { status: 201, created: true },
);

// ── 5. Falsy-but-valid values are not treated as missing ─────────────────────
assert.equal(isBlankValue(0), false);
assert.equal(isBlankValue(false), false);
assert.deepEqual(
  decideCreateDraft(noOp, {
    approvedData: { ...complete, childCount: 0, transferRequired: false },
    missingFields: ["childCount", "transferRequired"],
  }),
  { status: 201, created: true },
);

// ── 6. Field names with no form input cannot deadlock the record ─────────────
// The AI may put anything in missingFields; a key the reviewer has no input for
// must not block the draft permanently.
assert.equal(REVIEWABLE_FIELDS.has("voucherNumber"), false);
assert.deepEqual(
  decideCreateDraft(noOp, { approvedData: complete, missingFields: ["voucherNumber"] }),
  { status: 201, created: true },
);

// ── 7. A dateless operation is never created ─────────────────────────────────
// operations.startDate is nullable at the schema level, so this endpoint is the
// only thing standing between a null tourDate and an undated operation.
assert.deepEqual(
  decideCreateDraft(noOp, {
    approvedData: { customerName: "Ada Lovelace", tourDate: null },
    missingFields: [],
  }),
  { status: 400, code: "tour_date_required" },
);
// A whitespace tourDate is caught earlier, by the schema's YYYY-MM-DD rule, so
// it reports invalid_approved_data rather than tour_date_required. Different
// guard, same outcome: no undated operation is created. The isBlankValue check
// on tourDate is therefore only reachable for null — it stays as defence in
// depth in case the schema's date rule is ever loosened.
assert.equal(
  decideCreateDraft(noOp, {
    approvedData: { customerName: "Ada Lovelace", tourDate: "  " },
    missingFields: [],
  }).code,
  "invalid_approved_data",
);

// ── Source assertions: keep the mirror above honest ──────────────────────────
const createDraftSource = ROUTE_SOURCE.slice(ROUTE_SOURCE.indexOf('router.post("/:id/create-draft"'));
assert.ok(createDraftSource.length > 0, "create-draft handler not found in the route file");

// The regression this whole gate exists to prevent.
assert.ok(
  !/approvedData\s*\?\?\s*extraction\.extractedData/.test(createDraftSource) &&
    !/extraction\.extractedData/.test(createDraftSource.split("res.status(201)")[0]),
  "create-draft must never fall back to extraction.extractedData — human approval would be bypassed",
);

for (const code of ["approval_required", "invalid_approved_data", "missing_fields", "tour_date_required"]) {
  assert.ok(createDraftSource.includes(`"${code}"`), `create-draft no longer returns the ${code} guard`);
}

// The duplicate short-circuit must stay ahead of the guards, otherwise an
// already-processed import would start 400ing instead of returning its operation.
const duplicateGuardAt = createDraftSource.indexOf("item.operationId");
const approvalGuardAt = createDraftSource.indexOf('"approval_required"');
// Checked explicitly: indexOf returns -1 when a guard is deleted outright, and
// -1 would satisfy a bare "comes first" comparison.
assert.ok(duplicateGuardAt >= 0, "the item.operationId duplicate short-circuit is missing from create-draft");
assert.ok(approvalGuardAt >= 0, "the approval guard is missing from create-draft");
assert.ok(
  duplicateGuardAt < approvalGuardAt,
  "the item.operationId duplicate check must run before the approval guard",
);

console.log("create-draft guard focused tests: passed");
