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

for (const forbidden of ["@workspace/db", "DATABASE_URL", "googleapis", "google-auth-library", "fetch(", "axios"]) {
  assert.ok(!CLI_SOURCE.includes(forbidden) && !PARSER_SOURCE.includes(forbidden), `dry-run code must not contain ${forbidden}`);
}
assert.ok(/year:\s*z\.literal\(2026\)/.test(CLI_SOURCE), "manifest must hard-limit Faz 3A to 2026");
assert.ok(/sourceKind:\s*z\.enum\(\["gemi", "sejour"\]\)/.test(CLI_SOURCE), "manifest must allow only GEMI and SEJOUR sources");
assert.ok(/databaseWrites:\s*false/.test(PARSER_SOURCE) && /driveWrites:\s*false/.test(PARSER_SOURCE), "report must declare both write channels disabled");
assert.ok(/legacy:\$\{descriptor\.sourceFileId\}:\$\{worksheet\.name\}:\$\{row\.number\}/.test(PARSER_SOURCE), "crosswalk source key must preserve file, worksheet, and row provenance");
assert.ok(/flag = args\.includes\("--overwrite"\) \? "w" : "wx"/.test(CLI_SOURCE), "report output must refuse accidental overwrite by default");

execFileSync(
  "pnpm",
  ["--filter", "@workspace/api-server", "exec", "tsx", "src/historical-migration-dry-run-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical migration dry-run focused tests: passed");
