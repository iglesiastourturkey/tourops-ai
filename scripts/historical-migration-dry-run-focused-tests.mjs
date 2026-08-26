import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLI_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/historical-migration-dry-run.ts", import.meta.url),
  "utf8",
);
const PARSER_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/lib/historical-operation-parser.ts", import.meta.url),
  "utf8",
);
const PREPARE_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/historical-migration-prepare.ts", import.meta.url),
  "utf8",
);
const REVIEW_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/lib/historical-migration-review.ts", import.meta.url),
  "utf8",
);

for (const forbidden of ["@workspace/db", "DATABASE_URL", "googleapis", "google-auth-library", "fetch(", "axios"]) {
  assert.ok(
    !CLI_SOURCE.includes(forbidden)
      && !PARSER_SOURCE.includes(forbidden)
      && !PREPARE_SOURCE.includes(forbidden)
      && !REVIEW_SOURCE.includes(forbidden),
    `historical migration preparation must not contain ${forbidden}`,
  );
}
assert.ok(/year:\s*z\.literal\(2026\)/.test(CLI_SOURCE), "manifest must hard-limit Faz 3A to 2026");
assert.ok(/sourceKind:\s*z\.enum\(\["gemi", "sejour"\]\)/.test(CLI_SOURCE), "manifest must allow only GEMI and SEJOUR sources");
assert.ok(/databaseWrites:\s*false/.test(PARSER_SOURCE) && /driveWrites:\s*false/.test(PARSER_SOURCE), "report must declare both write channels disabled");
assert.ok(/legacy:\$\{descriptor\.sourceFileId\}:\$\{worksheet\.name\}:\$\{row\.number\}/.test(PARSER_SOURCE), "crosswalk source key must preserve file, worksheet, and row provenance");
assert.ok(/flag = args\.includes\("--overwrite"\) \? "w" : "wx"/.test(CLI_SOURCE), "report output must refuse accidental overwrite by default");
assert.ok(/idempotencyKey: candidate\.sourceKey/.test(REVIEW_SOURCE), "Phase 3B must preserve sourceKey as the idempotency key");
assert.ok(/sourceBookingReference: null/.test(REVIEW_SOURCE), "Phase 3B must not invent a booking reference");
assert.ok(/childCount: candidate\.childCount/.test(REVIEW_SOURCE), "Phase 3B must preserve a blank child count as null");
assert.ok(/duplicateContent: "manual_review"/.test(REVIEW_SOURCE), "possible duplicates must require manual review");
assert.ok(/missingCustomerName: "blocked"/.test(REVIEW_SOURCE), "missing customer names must be blocked");
assert.ok(/requiresImportApproval: true/.test(REVIEW_SOURCE), "staging output must retain the import approval gate");
assert.ok(/flag = args\.includes\("--overwrite"\) \? "w" : "wx"/.test(PREPARE_SOURCE), "Phase 3B output must refuse accidental overwrite by default");
assert.ok(/path === inputPath/.test(PREPARE_SOURCE), "Phase 3B must never overwrite its input report");

execFileSync(
  "pnpm",
  ["--filter", "@workspace/api-server", "exec", "tsx", "src/historical-migration-dry-run-self-test.ts"],
  { stdio: "inherit" },
);
execFileSync(
  "pnpm",
  ["--filter", "@workspace/api-server", "exec", "tsx", "src/historical-migration-prepare-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical migration dry-run focused tests: passed");
