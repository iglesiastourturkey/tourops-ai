import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../artifacts/api-server/src/routes/reservations.ts", import.meta.url),
  "utf8",
);
const emailSchema = readFileSync(
  new URL("../lib/db/src/schema/gmail.ts", import.meta.url),
  "utf8",
);
const operationsSchema = readFileSync(
  new URL("../lib/db/src/schema/operations.ts", import.meta.url),
  "utf8",
);
const outlookRoute = readFileSync(
  new URL("../artifacts/api-server/src/routes/outlook.ts", import.meta.url),
  "utf8",
);

const createDraft = route.slice(
  route.indexOf('router.post("/:id/create-draft"'),
  route.indexOf("export default router"),
);
assert.ok(createDraft.includes("db.transaction(async (tx) =>"), "approved create-draft must be transactional");
assert.ok(/\.for\("update"\)/.test(createDraft), "the persisted email import must be locked for retry safety");
for (const table of ["operationsTable", "reservationsTable", "bookingPartiesTable"]) {
  assert.ok(createDraft.includes(table), `approved writer must create/reuse ${table}`);
}
assert.ok(
  /sourceEmailImportId: id/.test(createDraft)
    && /sourceEmailImportId: id/.test(createDraft.slice(createDraft.indexOf("tx.insert(reservationsTable)"))),
  "operation and reservation must retain the same approved-import identity",
);
assert.ok(
  /const leadGuestName = data\.customerName;[\s\S]*?if \(!leadGuestName\)/.test(createDraft)
    && /leadGuestName,/.test(createDraft),
  "missing lead guest must fail closed and a supplied approved name must be retained",
);
assert.ok(
  /adultCount: data\.adultCount,[\s\S]*?childCount: data\.childCount,[\s\S]*?passengerLanguage: data\.guideLanguage/.test(createDraft),
  "approved Adult/CHD counts and language must be preserved on BookingParty",
);
assert.ok(
  /pickupTime: data\.pickupTime/.test(createDraft)
    && /pickupPoint: data\.pickupLocation/.test(createDraft)
    && /netAmount: data\.amount === null \? null : String\(data\.amount\)/.test(createDraft)
    && /currency: data\.currency/.test(createDraft),
  "approved pickup and monetary fields must be retained where the schema supports them",
);
assert.ok(
  !/operationReservationDetailsTable/.test(createDraft) && !/\.insert\(guestsTable\)/.test(createDraft),
  "communications cutover must not write legacy details or fabricate Guest rows",
);
assert.ok(
  /extraction\.approvedData == null/.test(createDraft) && /code: "approval_required"/.test(createDraft),
  "human review approval remains mandatory before any business write",
);
assert.ok(
  /reservationsTable\.sourceBookingReference/.test(createDraft)
    && /draft_confirmation_required/.test(createDraft),
  "reservation booking-reference matches must remain an advisory confirmation, not rejection",
);
assert.ok(
  /gmailImportUnique: uniqueIndex\("operations_source_email_import_idx"\)/.test(operationsSchema),
  "existing operation sourceEmailImportId uniqueness remains the retry guard",
);
assert.ok(
  /gmailMessageId: text\("gmail_message_id"\)/.test(emailSchema)
    && /outlookMessageId: text\("outlook_message_id"\)/.test(emailSchema)
    && /outlookConversationId: text\("outlook_conversation_id"\)/.test(emailSchema),
  "provider message/conversation identity must remain persisted on the linked import",
);
assert.ok(
  /source: "outlook"/.test(outlookRoute)
    && /source: item\.source \?\? "gmail"/.test(createDraft)
    && /outlookMessageId: item\.outlookMessageId/.test(createDraft),
  "Gmail and Outlook must use the same writer while retaining distinct provider provenance",
);
assert.ok(
  /reservationId: result\.reservation\?\.id \?\? null,[\s\S]*?bookingPartyId: result\.bookingParty\?\.id \?\? null/.test(createDraft),
  "successful audit metadata must include reservation and booking-party IDs",
);

console.log("communications reservation Phase 1B.3 focused tests: passed");
