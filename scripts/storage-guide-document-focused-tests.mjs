import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const source = readFileSync(
  new URL("../artifacts/api-server/src/routes/storage.ts", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /let assetOperationId: number;/,
  "storage authorization must normalize the owning operation id",
);
assert.match(
  source,
  /assetOperationId = document\.operationId;/,
  "document-only assets must supply their operation id",
);
assert.match(
  source,
  /eq\(operationsTable\.id, assetOperationId\)/,
  "guide authorization must use the normalized operation id",
);
assert.ok(
  !source.includes("receipt.operationId"),
  "guide document access must never dereference a missing receipt",
);

console.log("storage guide document focused tests passed");
