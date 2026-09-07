import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseHistoricalEvidenceLoaderArgs,
  verifyHistoricalArchiveFile,
  verifyHistoricalManifestIntegrity,
} from "./historical-source-evidence-loader";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const root = await mkdtemp(join(tmpdir(), "tourpilot-manifest-integrity-"));
await mkdir(join(root, "authoritative", "GEMI"), { recursive: true });
const manifestPath = "authoritative/manifest.json";
const workbookPath = "authoritative/GEMI/source.xlsx";
const manifestBytes = Buffer.from('{"version":1,"files":[]}\n');
const workbookBytes = Buffer.from("test workbook bytes");
await writeFile(join(root, manifestPath), manifestBytes);
await writeFile(join(root, workbookPath), workbookBytes);
const validChecksums = `${sha(manifestBytes)}  ./${manifestPath}\n${sha(workbookBytes)}  ./${workbookPath}\n`;
await writeFile(join(root, "SHA256SUMS.txt"), validChecksums);

const verified = await verifyHistoricalManifestIntegrity({ archiveRoot: root, manifestPath, checksumsPath: "SHA256SUMS.txt" });
assert.equal(verified.manifestHashVerified, true);
assert.equal(verified.manifestSha256Actual, sha(manifestBytes));
assert.equal(verified.manifestSha256Expected, sha(manifestBytes));

await writeFile(join(root, "WRONG.txt"), `${"0".repeat(64)}  ./${manifestPath}\n`);
await assert.rejects(() => verifyHistoricalManifestIntegrity({ archiveRoot: root, manifestPath, checksumsPath: "WRONG.txt" }), /Manifest SHA256 dogrulanamadi/);
await writeFile(join(root, "MISSING.txt"), `${sha(workbookBytes)}  ./${workbookPath}\n`);
await assert.rejects(() => verifyHistoricalManifestIntegrity({ archiveRoot: root, manifestPath, checksumsPath: "MISSING.txt" }), /guvenilir SHA256 bulunamadi/);
await assert.rejects(() => verifyHistoricalManifestIntegrity({ archiveRoot: root, manifestPath: "missing.json", checksumsPath: "SHA256SUMS.txt" }));
await assert.rejects(() => verifyHistoricalManifestIntegrity({ archiveRoot: root, manifestPath: "../outside.json", checksumsPath: "SHA256SUMS.txt" }));

await writeFile(join(root, manifestPath), Buffer.concat([manifestBytes, Buffer.from(" ")]));
let workbookReached = false;
await assert.rejects(async () => {
  const integrity = await verifyHistoricalManifestIntegrity({ archiveRoot: root, manifestPath, checksumsPath: "SHA256SUMS.txt" });
  workbookReached = true;
  await verifyHistoricalArchiveFile({ archiveRoot: root, baseDirectory: join(root, "authoritative"), path: "GEMI/source.xlsx", checksums: integrity.checksums });
}, /Manifest SHA256 dogrulanamadi/);
assert.equal(workbookReached, false);

await writeFile(join(root, manifestPath), manifestBytes);
const integrity = await verifyHistoricalManifestIntegrity({ archiveRoot: root, manifestPath, checksumsPath: "SHA256SUMS.txt" });
const workbook = await verifyHistoricalArchiveFile({ archiveRoot: root, baseDirectory: join(root, "authoritative"), path: "GEMI/source.xlsx", checksums: integrity.checksums });
assert.equal(workbook.sha256, sha(workbookBytes));
assert.equal(parseHistoricalEvidenceLoaderArgs(["--archive-root", root, "--manifest", manifestPath, "--checksums", "SHA256SUMS.txt"]).apply, false);

console.log("historical manifest integrity self-test: 11 assertions passed");
