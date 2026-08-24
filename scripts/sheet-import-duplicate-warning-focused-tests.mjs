import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Focused tests for the Faz 2b sheet-import duplicate-warning pass:
// artifacts/api-server/src/routes/sheet-import.ts,
// artifacts/tourops-ai/src/lib/sheet-import-api.ts, and
// artifacts/tourops-ai/src/pages/sheet-import-detail.tsx. Same shape as the
// other suites here - source assertions against the real files, because the
// route mixes express + a live db.transaction() and the page's mutation
// wiring is not usefully mirrored as pure functions.
//
// Faz 2b reuses the booking-reference duplicate-warning machinery that
// already exists for POST /reservations/:id/create-draft (collectDraftWarnings
// + the 409 code:"warnings_pending" + acknowledge-to-proceed UX +
// customFetch's .data-based error extraction) for POST /sheet-import/:id/approve,
// instead of building a parallel, bespoke check. These tests pin down that
// reuse so a future edit cannot quietly fork the two flows apart.

const ROUTE_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/sheet-import.ts", import.meta.url),
  "utf8",
);
const API_SOURCE = readFileSync(
  new URL("../artifacts/tourops-ai/src/lib/sheet-import-api.ts", import.meta.url),
  "utf8",
);
const DETAIL_PAGE_SOURCE = readFileSync(
  new URL("../artifacts/tourops-ai/src/pages/sheet-import-detail.tsx", import.meta.url),
  "utf8",
);

const approveSource = ROUTE_SOURCE.slice(
  ROUTE_SOURCE.indexOf('router.post("/:id/approve"'),
  ROUTE_SOURCE.indexOf('router.post("/:id/reject"'),
);
assert.ok(approveSource.length > 0, "POST /:id/approve handler not found in sheet-import.ts");

// ── 1. the backend reuses the shared warning-validation library ──────────────
assert.ok(
  /collectDraftWarnings,\s*normalizeBookingReference,\s*parseAcknowledgedWarnings,\s*todayInIstanbul,?\s*\}\s*from\s*"\.\.\/lib\/reservation-validation"/.test(ROUTE_SOURCE),
  "sheet-import.ts must import collectDraftWarnings/normalizeBookingReference/parseAcknowledgedWarnings/todayInIstanbul from the shared ../lib/reservation-validation module, not a duplicated implementation",
);

// ── 2. duplicate lookup: case-/whitespace-insensitive, excludes the row's own operation ──
assert.ok(
  /normalizeBookingReference\(fields\.sourceBookingReference\)/.test(approveSource),
  "approve must normalize the row's own booking reference (case/whitespace) before comparing, same as create-draft",
);
assert.ok(
  /lower\(trim\(\$\{operationsTable\.sourceBookingReference\}\)\)\s*=\s*\$\{bookingReference\}/.test(approveSource),
  "approve's duplicate lookup must match source_booking_reference case-/whitespace-insensitively",
);
assert.ok(
  /\$\{operationsTable\.sourceSheetImportId\}\s*IS DISTINCT FROM\s*\$\{importRow\.id\}/.test(approveSource),
  "approve must exclude the operation this same import row already produced - a re-approval must not flag itself as its own duplicate",
);
assert.ok(
  /\.limit\(6\)/.test(approveSource) && /moreDuplicates = duplicateRows\.length > 5/.test(approveSource) && /duplicateRows\.slice\(0,\s*5\)/.test(approveSource),
  "the duplicate lookup must cap at 6, slice to 5, and flag the overflow - same capped-list pattern as create-draft",
);

// ── 3. warnings are scoped to duplicate_booking_reference only (Faz 2b's stated scope) ──
// Sheet imports carry no reliable adult/child/guest-count split at this
// layer, so every other DraftWarningInput field is deliberately nulled -
// collectDraftWarnings then only ever has grounds to emit the one warning
// this feature is scoped to.
assert.ok(
  /collectDraftWarnings\(\s*\{\s*tourDate:\s*null,\s*guestCount:\s*null,\s*adultCount:\s*null,\s*childCount:\s*null,?\s*\}/.test(approveSource),
  "approve must call collectDraftWarnings with tourDate/guestCount/adultCount/childCount all null, scoping its output to duplicate_booking_reference only",
);

// ── 4. unacknowledged warnings re-block a repeated request, mirroring create-draft's 409 ──
assert.ok(
  /const acknowledgedWarnings = parseAcknowledgedWarnings\(/.test(ROUTE_SOURCE),
  "approve must read acknowledgedWarnings off the request body via parseAcknowledgedWarnings",
);
assert.ok(
  /const unacknowledged = warnings\.filter\(w => !acknowledgedWarnings\.includes\(w\.code\)\);/.test(approveSource),
  "approve must re-check the full CURRENT warning set against acknowledgedWarnings, not just trust a bare boolean - a warning that appeared since the 409 must still block",
);
assert.ok(
  /if\s*\(unacknowledged\.length > 0\)\s*\{\s*return\s*\{\s*kind:\s*"warnings_pending"\s*as const,\s*warnings\s*\};/.test(approveSource),
  "approve must return the full current warning set (not just the unacknowledged ones) when anything is unacknowledged",
);
assert.ok(
  /result\.kind === "warnings_pending"/.test(ROUTE_SOURCE)
    && /res\.status\(409\)\.json\(\{\s*error:[^}]*code:\s*"warnings_pending",\s*warnings:\s*result\.warnings,?\s*\}\)/.test(ROUTE_SOURCE),
  'the warnings_pending result must be surfaced as an HTTP 409 with { code: "warnings_pending", warnings }',
);
{
  const idx409 = ROUTE_SOURCE.indexOf('result.kind === "warnings_pending"');
  const idxAlready = ROUTE_SOURCE.indexOf('result.kind === "already_reviewed"');
  const idxNotFound = ROUTE_SOURCE.indexOf('result.kind === "not_found"');
  assert.ok(
    idxNotFound >= 0 && idxNotFound < idx409 && idx409 < idxAlready,
    "the warnings_pending check must run after not_found but before already_reviewed in the response handling",
  );
}

// ── 5. frontend api client: approve() forwards acknowledgedWarnings, defaults to [] ──
assert.ok(
  /approve:\s*\(id:\s*number,\s*acknowledgedWarnings:\s*DraftWarning\['code'\]\[\]\s*=\s*\[\]\)\s*=>/.test(API_SOURCE),
  "sheetImportApi.approve must accept acknowledgedWarnings with a [] default, same signature shape as reservationApi.createDraft",
);
assert.ok(
  /body:\s*JSON\.stringify\(\{\s*acknowledgedWarnings\s*\}\)/.test(API_SOURCE),
  "approve() must send acknowledgedWarnings in the POST body",
);
assert.ok(
  /export function approveWarningsError\(error: unknown\): ApproveWarningsErrorBody \| null\s*\{/.test(API_SOURCE),
  "sheet-import-api.ts must export approveWarningsError, mirroring reservation-api.ts's createDraftError",
);
assert.ok(
  /return body\.code === 'warnings_pending' \? body : null;/.test(API_SOURCE),
  "approveWarningsError must only surface a body when the server actually responded with code warnings_pending - any other shape must return null so the generic error toast still fires",
);

// ── 6. frontend detail page: state, mutation wiring, and the confirm dialog ──
assert.ok(
  /import type \{ DraftWarning \} from '@\/lib\/reservation-api';/.test(DETAIL_PAGE_SOURCE),
  "sheet-import-detail.tsx must import the shared DraftWarning type from reservation-api, not redeclare it",
);
assert.ok(
  DETAIL_PAGE_SOURCE.includes("const [approveWarnings, setApproveWarnings] = useState<DraftWarning[]>([]);"),
  "sheet-import-detail.tsx must hold the server's warnings in state, same pattern as reservation-detail.tsx's draftWarnings",
);
assert.ok(
  DETAIL_PAGE_SOURCE.includes("mutationFn: (acknowledgedWarnings: DraftWarning['code'][] = []) => sheetImportApi.approve(id, acknowledgedWarnings),"),
  "the approve mutation must forward acknowledgedWarnings through to sheetImportApi.approve",
);
assert.ok(
  DETAIL_PAGE_SOURCE.includes("const warningsBody = approveWarningsError(error);"),
  "the approve mutation's onError must check for a warnings_pending body before falling through to the generic failure toast",
);
{
  const onErrorIdx = DETAIL_PAGE_SOURCE.indexOf("const warningsBody = approveWarningsError(error);");
  const branchIdx = DETAIL_PAGE_SOURCE.indexOf("if (warningsBody?.warnings) {", onErrorIdx);
  const setWarningsIdx = DETAIL_PAGE_SOURCE.indexOf("setApproveWarnings(warningsBody.warnings);", branchIdx);
  const returnIdx = DETAIL_PAGE_SOURCE.indexOf("return;", setWarningsIdx);
  assert.ok(
    onErrorIdx >= 0 && branchIdx > onErrorIdx && branchIdx - onErrorIdx < 100
      && setWarningsIdx > branchIdx && returnIdx > setWarningsIdx && returnIdx - setWarningsIdx < 100,
    "onError must populate approveWarnings and return early when warnings are pending, skipping the generic error toast below",
  );
  const genericToastIdx = DETAIL_PAGE_SOURCE.indexOf("Onaylanamadı");
  assert.ok(genericToastIdx > returnIdx, "the generic failure toast must remain reachable for a real (non-warning) approve failure");
}
assert.ok(
  DETAIL_PAGE_SOURCE.includes("<AlertDialog open={approveWarnings.length > 0}"),
  "the warnings confirm dialog's open state must be driven directly by approveWarnings.length, not a separate boolean flag that could drift out of sync with it",
);
assert.ok(
  DETAIL_PAGE_SOURCE.includes("onOpenChange={open => { if (!open) setApproveWarnings([]); }}"),
  "cancelling (or closing) the dialog must clear approveWarnings - the next attempt re-runs the checks server-side, so a stale acknowledgement must never carry forward",
);
assert.ok(
  DETAIL_PAGE_SOURCE.includes("approve.mutate(approveWarnings.map(warning => warning.code))"),
  "confirming the dialog must resubmit only the warning codes actually shown to the reviewer, not a blanket acknowledgement of every known code",
);
assert.ok(
  /warning\.detail\?\.operations\?\.length/.test(DETAIL_PAGE_SOURCE) && /warning\.detail\.operations\.map\(operation =>/.test(DETAIL_PAGE_SOURCE),
  '"there is a duplicate" is not actionable on its own - the dialog must list which operation(s), from warning.detail.operations',
);

console.log("sheet-import duplicate-warning focused tests: passed");
