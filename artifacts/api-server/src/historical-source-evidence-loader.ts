import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { buildHistoricalEvidenceSnapshot, evidenceSnapshotMatches, type HistoricalEvidenceSnapshot } from "./lib/historical-source-evidence";
import { parseHistoricalStagingRecord } from "./lib/historical-migration-stage-validation";

const CONFIRMATION = "TOURPILOT_2026_HISTORICAL_EVIDENCE_LOAD";

const manifestSchema = z.object({
  version: z.number().int().positive(),
  files: z.array(z.object({
    path: z.string().min(1),
    sourceFileId: z.string().min(1),
    sourceKind: z.enum(["gemi", "sejour"]),
    year: z.literal(2026),
    month: z.number().int().min(1).max(12),
  }).strict()),
}).strict();

interface LoaderArgs {
  archiveRoot: string;
  manifestPath: string;
  checksumsPath: string;
  apply: boolean;
}

function option(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index < 0 ? null : args[index + 1] ?? null;
}

export function parseHistoricalEvidenceLoaderArgs(args: string[]): LoaderArgs {
  const allowed = new Set(["--archive-root", "--manifest", "--checksums", "--apply", "--confirm-evidence-load"]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowed.has(flag)) throw new Error(`Desteklenmeyen bayrak: ${flag}`);
    if (flag !== "--apply") index += 1;
  }
  const archiveRoot = option(args, "--archive-root");
  const manifestPath = option(args, "--manifest");
  const checksumsPath = option(args, "--checksums");
  if (!archiveRoot || !manifestPath || !checksumsPath) {
    throw new Error("--archive-root, --manifest ve --checksums zorunludur");
  }
  const apply = args.includes("--apply");
  if (apply && option(args, "--confirm-evidence-load") !== CONFIRMATION) {
    throw new Error(`APPLY icin --confirm-evidence-load ${CONFIRMATION} zorunludur`);
  }
  if (!apply && args.includes("--confirm-evidence-load")) throw new Error("Confirmation yalnizca --apply ile kullanilabilir");
  return { archiveRoot, manifestPath, checksumsPath, apply };
}

export function validateHistoricalEvidenceTarget(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "production") throw new Error("Production ortaminda evidence loader calistirilamaz");
  const connectionString = env.HISTORICAL_STAGING_DATABASE_URL;
  const allowedHost = env.HISTORICAL_STAGING_DATABASE_HOST;
  if (!connectionString || !allowedHost) throw new Error("Historical staging URL ve host gerekli");
  const url = new URL(connectionString);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) throw new Error("Evidence target PostgreSQL olmali");
  if (url.hostname !== allowedHost || !allowedHost.endsWith(".neon.tech")) throw new Error("Evidence target host kontrolu basarisiz");
  return connectionString;
}

export function parseHistoricalArchiveChecksums(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
    if (match) result.set(match[2].replace(/^\.\//, ""), match[1]);
  }
  return result;
}

async function resolveInside(root: string, path: string): Promise<string> {
  const resolvedRoot = await realpath(root);
  const resolvedPath = await realpath(resolve(root, path));
  const child = relative(resolvedRoot, resolvedPath);
  if (child.startsWith(`..${sep}`) || child === ".." || resolve(resolvedPath) === resolve(resolvedRoot)) {
    throw new Error("Archive disina path kabul edilmez");
  }
  return resolvedPath;
}

export function sha256OfExactBytes(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface VerifiedManifestIntegrity {
  manifestFile: string;
  manifestPath: string;
  manifestBytes: Buffer;
  manifestSha256Actual: string;
  manifestSha256Expected: string;
  manifestHashVerified: true;
  checksums: Map<string, string>;
}

/** Verify exact manifest bytes before parsing or trusting any mappings. */
export async function verifyHistoricalManifestIntegrity(params: {
  archiveRoot: string;
  manifestPath: string;
  checksumsPath: string;
}): Promise<VerifiedManifestIntegrity> {
  const archiveRoot = await realpath(params.archiveRoot);
  const checksumsFile = await resolveInside(archiveRoot, params.checksumsPath);
  const checksums = parseHistoricalArchiveChecksums(await readFile(checksumsFile, "utf8"));
  const manifestFile = await resolveInside(archiveRoot, params.manifestPath);
  const manifestPath = relative(archiveRoot, manifestFile).split(sep).join("/");
  const manifestSha256Expected = checksums.get(manifestPath);
  if (!manifestSha256Expected) throw new Error(`Manifest icin guvenilir SHA256 bulunamadi: ${manifestPath}`);
  const manifestBytes = await readFile(manifestFile);
  const manifestSha256Actual = sha256OfExactBytes(manifestBytes);
  if (manifestSha256Actual !== manifestSha256Expected) throw new Error(`Manifest SHA256 dogrulanamadi: ${manifestPath}`);
  return {
    manifestFile,
    manifestPath,
    manifestBytes,
    manifestSha256Actual,
    manifestSha256Expected,
    manifestHashVerified: true,
    checksums,
  };
}

export async function verifyHistoricalArchiveFile(params: {
  archiveRoot: string;
  baseDirectory: string;
  path: string;
  checksums: Map<string, string>;
}): Promise<{ file: string; bytes: Buffer; sha256: string }> {
  const archiveRoot = await realpath(params.archiveRoot);
  const file = await resolveInside(params.baseDirectory, params.path);
  const bytes = await readFile(file);
  const sha256 = sha256OfExactBytes(bytes);
  const checksumKey = relative(archiveRoot, file).split(sep).join("/");
  if (params.checksums.get(checksumKey) !== sha256) throw new Error(`Workbook SHA256 dogrulanamadi: ${params.path}`);
  return { file, bytes, sha256 };
}

async function main() {
  const args = parseHistoricalEvidenceLoaderArgs(process.argv.slice(2));
  const connectionString = validateHistoricalEvidenceTarget();
  const archiveRoot = await realpath(args.archiveRoot);
  const manifestIntegrity = await verifyHistoricalManifestIntegrity({
    archiveRoot,
    manifestPath: args.manifestPath,
    checksumsPath: args.checksumsPath,
  });
  const manifest = manifestSchema.parse(JSON.parse(manifestIntegrity.manifestBytes.toString("utf8")));
  const manifestDirectory = dirname(manifestIntegrity.manifestFile);

  process.env.DATABASE_URL = connectionString;
  const { db, pool, historicalOperationImportsTable, historicalSourceEvidenceTable } = await import("@workspace/db");
  try {
    const stagingRows = await db.select({
      id: historicalOperationImportsTable.id,
      sourceKey: historicalOperationImportsTable.sourceKey,
      sourceFileId: historicalOperationImportsTable.sourceFileId,
      sourceKind: historicalOperationImportsTable.sourceKind,
      worksheetName: historicalOperationImportsTable.worksheetName,
      sourceRow: historicalOperationImportsTable.sourceRow,
      status: historicalOperationImportsTable.status,
      payload: historicalOperationImportsTable.payload,
    }).from(historicalOperationImportsTable).where(eq(historicalOperationImportsTable.status, "pending"));
    const existing = await db.select().from(historicalSourceEvidenceTable);
    const existingByKey = new Map(existing.map(row => [row.sourceKey, row]));
    const rowsByFile = new Map<string, typeof stagingRows>();
    for (const row of stagingRows) {
      const list = rowsByFile.get(row.sourceFileId) ?? [];
      list.push(row);
      rowsByFile.set(row.sourceFileId, list);
    }

    const snapshots: Array<HistoricalEvidenceSnapshot & { historicalImportId: number }> = [];
    const verifiedWorkbooks: string[] = [];
    for (const [sourceFileId, rows] of rowsByFile) {
      const descriptor = manifest.files.find(file => file.sourceFileId === sourceFileId);
      if (!descriptor) throw new Error(`Manifest sourceFileId bulunamadi: ${sourceFileId}`);
      const verifiedWorkbook = await verifyHistoricalArchiveFile({
        archiveRoot,
        baseDirectory: manifestDirectory,
        path: descriptor.path,
        checksums: manifestIntegrity.checksums,
      });
      const workbookBytes = verifiedWorkbook.bytes;
      const workbookSha256 = verifiedWorkbook.sha256;
      verifiedWorkbooks.push(descriptor.path);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(workbookBytes as unknown as ExcelJS.Buffer);

      for (const row of rows) {
        const payload = parseHistoricalStagingRecord(row.payload);
        const expectedKey = `legacy:${row.sourceFileId}:${row.worksheetName}:${row.sourceRow}`;
        if (row.sourceKey !== expectedKey || payload.idempotencyKey !== expectedKey
          || payload.provenance.sourceFileId !== row.sourceFileId
          || payload.provenance.sourceKind !== row.sourceKind
          || payload.provenance.worksheetName !== row.worksheetName
          || payload.provenance.sourceRow !== row.sourceRow) {
          throw new Error(`Exact provenance eslesmedi: ${row.sourceKey}`);
        }
        const worksheet = workbook.getWorksheet(row.worksheetName);
        if (!worksheet) throw new Error(`Worksheet bulunamadi: ${row.sourceKey}`);
        snapshots.push({
          historicalImportId: row.id,
          ...buildHistoricalEvidenceSnapshot({
            worksheet,
            sourceKey: row.sourceKey,
            sourceFileId: row.sourceFileId,
            workbookPath: descriptor.path,
            workbookSha256,
            sourceRow: row.sourceRow,
          }),
        });
      }
    }

    const conflicts = snapshots.filter(snapshot => {
      const found = existingByKey.get(snapshot.sourceKey);
      return found ? !evidenceSnapshotMatches(found, snapshot) : false;
    });
    const alreadyPresent = snapshots.filter(snapshot => {
      const found = existingByKey.get(snapshot.sourceKey);
      return found ? evidenceSnapshotMatches(found, snapshot) : false;
    });
    const inserts = snapshots.filter(snapshot => !existingByKey.has(snapshot.sourceKey));
    const report = {
      mode: args.apply ? "historical-source-evidence-apply" : "historical-source-evidence-plan",
      databaseWrites: args.apply,
      manifestPath: manifestIntegrity.manifestPath,
      manifestSha256Actual: manifestIntegrity.manifestSha256Actual,
      manifestSha256Expected: manifestIntegrity.manifestSha256Expected,
      manifestHashVerified: manifestIntegrity.manifestHashVerified,
      stagingPayloadWrites: false,
      downstreamWrites: false,
      pendingRows: stagingRows.length,
      workbookCount: verifiedWorkbooks.length,
      candidateEvidenceCount: snapshots.length,
      verifiedWorkbooks: verifiedWorkbooks.length,
      plannedInserts: inserts.length,
      alreadyPresent: alreadyPresent.length,
      conflicts: conflicts.length,
      requiresApplyConfirmation: !args.apply,
    };
    if (conflicts.length > 0) throw new Error(`Evidence conflict bulundu: ${conflicts.length}`);
    if (!args.apply) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(2026, 7)`);
      for (const snapshot of inserts) {
        await tx.insert(historicalSourceEvidenceTable).values({
          historicalImportId: snapshot.historicalImportId,
          sourceKey: snapshot.sourceKey,
          sourceFileId: snapshot.sourceFileId,
          workbookPath: snapshot.workbookPath,
          workbookSha256: snapshot.workbookSha256,
          worksheetName: snapshot.worksheetName,
          sourceRow: snapshot.sourceRow,
          headerRow: snapshot.headerRow,
          cells: snapshot.cells,
          evidenceSha256: snapshot.evidenceSha256,
        }).onConflictDoNothing();
        const [stored] = await tx.select().from(historicalSourceEvidenceTable)
          .where(eq(historicalSourceEvidenceTable.sourceKey, snapshot.sourceKey)).limit(1);
        if (!stored || !evidenceSnapshotMatches(stored, snapshot)) throw new Error(`Concurrent evidence conflict: ${snapshot.sourceKey}`);
      }
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isEntrypoint) main().catch(error => {
  console.error(error instanceof Error ? error.message : "Historical evidence loader basarisiz");
  process.exit(1);
});
