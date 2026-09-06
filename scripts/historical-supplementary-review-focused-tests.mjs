import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLI = readFileSync(new URL("../artifacts/api-server/src/historical-supplementary-review.ts", import.meta.url), "utf8");
const WORKFLOW = readFileSync(new URL("../artifacts/api-server/src/lib/historical-supplementary-review.ts", import.meta.url), "utf8");

for (const forbidden of ["@workspace/db", "DATABASE_URL", "googleapis", "google-auth-library", "fetch(", "axios"]) {
  assert.ok(!CLI.includes(forbidden) && !WORKFLOW.includes(forbidden), `supplementary review must not contain ${forbidden}`);
}
assert.match(WORKFLOW, /identity: "preserve_sourceKey"/);
assert.match(WORKFLOW, /automaticDropDeleteMerge: false/);
assert.match(WORKFLOW, /decision\.approved !== true/);
assert.match(WORKFLOW, /buildHistoricalStagingRecord\(\{ \.\.\.primary/);
assert.match(WORKFLOW, /sourceKeys: group\.sourceKeys/);
assert.match(CLI, /databaseWrites: false/);
assert.match(CLI, /driveWrites: false/);
assert.match(CLI, /flag = args\.includes\("--overwrite"\) \? "w" : "wx"/);

execFileSync(
  "pnpm",
  ["--filter", "@workspace/api-server", "exec", "tsx", "src/historical-supplementary-review-self-test.ts"],
  { stdio: "inherit" },
);

console.log("historical supplementary review focused tests: passed");
