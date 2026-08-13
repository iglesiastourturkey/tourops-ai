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

// ── Re-analysis invalidates a previous approval ──────────────────────────────
// /analyze nulls approvedData on conflict, so fresh AI output can never be
// drafted on the strength of an approval that was given for the old output.
const analyzeUpsert = ROUTE_SOURCE.slice(
  ROUTE_SOURCE.indexOf("reservationExtractionsTable).values({ importId: id"),
);
const onConflictSet = analyzeUpsert.slice(
  analyzeUpsert.indexOf("onConflictDoUpdate"),
  analyzeUpsert.indexOf("});", analyzeUpsert.indexOf("onConflictDoUpdate")),
);
assert.ok(
  /approvedData:\s*null/.test(onConflictSet),
  "/analyze must clear approvedData when it overwrites an existing extraction",
);
// editedAt must survive: it is the only signal that separates "never approved"
// from "approval invalidated", which the review screen warns on.
assert.ok(
  !/editedAt:/.test(onConflictSet),
  "/analyze must not clear editedAt — the review screen needs it to warn the reviewer",
);

// Full sequence: approve → re-analyse → create-draft is refused.
const reanalyse = (extraction) => ({
  ...extraction,
  extractedData: { customerName: "Ada Lovelace", tourDate: "2026-10-05" },
  approvedData: null,          // mirrors the onConflictDoUpdate set list above
  editedAt: extraction.editedAt,
});

const approved = { approvedData: complete, extractedData: complete, missingFields: [], editedAt: "2026-08-12T09:00:00Z" };
assert.deepEqual(decideCreateDraft(noOp, approved), { status: 201, created: true });

const afterReanalysis = reanalyse(approved);
assert.equal(afterReanalysis.approvedData, null);
assert.equal(afterReanalysis.editedAt, "2026-08-12T09:00:00Z");
assert.deepEqual(
  decideCreateDraft(noOp, afterReanalysis),
  { status: 400, code: "approval_required" },
);

// Re-approving through PATCH /:id/review unblocks it again.
assert.deepEqual(
  decideCreateDraft(noOp, { ...afterReanalysis, approvedData: afterReanalysis.extractedData }),
  { status: 201, created: true },
);

// The operation must carry the import's real origin. A hardcoded "gmail" here
// mislabelled every operation built from a manually entered reservation.
assert.ok(
  !/sourceType:\s*"gmail"/.test(createDraftSource),
  "create-draft must not hardcode sourceType — manual reservations would be labelled gmail",
);
assert.ok(
  /sourceType:\s*item\.source/.test(createDraftSource),
  "create-draft must take sourceType from the import row",
);

// ── Inbox state machine ──────────────────────────────────────────────────────
// The allowed-status table is read out of the route file, so the test tracks the
// real rules rather than a second copy of them.
const allowedFromSource = ROUTE_SOURCE.match(/const ALLOWED_FROM[\s\S]*?\n\};/)?.[0];
assert.ok(allowedFromSource, "ALLOWED_FROM table not found in the route file");
// Drop the TS annotation between the name and `=` (it nests angle brackets, so
// a `[^>]*` strip would cut it in the wrong place).
const ALLOWED_FROM = new Function(
  `${allowedFromSource.replace(/const ALLOWED_FROM[^=]*=/, "const ALLOWED_FROM =")}\nreturn ALLOWED_FROM;`,
)();

const allows = (action, status) => ALLOWED_FROM[action].has(status);

// Every action the inbox exposes must be declared.
assert.deepEqual(
  Object.keys(ALLOWED_FROM).sort(),
  ["analyze", "create-draft", "reject", "reopen", "review"],
);

// A rejected record is frozen until it is explicitly reopened.
for (const action of ["analyze", "review", "create-draft"]) {
  assert.equal(allows(action, "rejected"), false, `${action} must be blocked while rejected`);
}
assert.equal(allows("reopen", "rejected"), true);

// draft_created is terminal: nothing may act on it. create-draft itself returns
// the existing operation before the guard runs (asserted separately below).
for (const action of ["analyze", "review", "create-draft", "reject", "reopen"]) {
  assert.equal(allows(action, "draft_created"), false, `${action} must be blocked after a draft exists`);
}

// Reopen is only ever a rejected → pending_review move.
for (const status of ["new", "analyzing", "pending_review", "missing_information", "error", "draft_created"]) {
  assert.equal(allows("reopen", status), false, `reopen must not be offered from ${status}`);
}

// An in-flight analysis is not restartable, but it can still be rejected.
assert.equal(allows("analyze", "analyzing"), false);
assert.equal(allows("reject", "analyzing"), true);

// Manual entry lands on pending_review, so the whole review flow must work there.
for (const action of ["analyze", "review", "create-draft", "reject"]) {
  assert.equal(allows(action, "pending_review"), true, `${action} must be available from pending_review`);
}

// A failed analysis can be retried or abandoned, but not reviewed or drafted.
assert.equal(allows("analyze", "error"), true);
assert.equal(allows("reject", "error"), true);
assert.equal(allows("review", "error"), false);
assert.equal(allows("create-draft", "error"), false);

// The idempotent replay must still be reached before the transition guard,
// otherwise an already-processed import would start answering 409.
const operationIdAt = createDraftSource.indexOf("item.operationId");
const draftGuardAt = createDraftSource.indexOf('transitionBlock("create-draft"');
assert.ok(draftGuardAt >= 0, "create-draft is missing its transition guard");
assert.ok(
  operationIdAt < draftGuardAt,
  "the duplicate replay must run before the create-draft transition guard",
);

// Every guarded endpoint answers 409 with a machine-readable code.
assert.ok(
  (ROUTE_SOURCE.match(/code: "invalid_status_transition"/g) ?? []).length >= 5,
  "each guarded endpoint should report the invalid_status_transition code",
);

console.log("create-draft guard focused tests: passed");
