/**
 * CLI runner for Phase 2D.3 Personnel Master Import / Matching Dry-Run.
 *
 * Reads PERFORMANS RAPORU-2026.xlsx (or provided workbook path),
 * discovers sheets, matches against canonical resources/aliases in read-only mode,
 * and generates a deterministic review artifact.
 *
 * Guaranteed zero DB writes.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverPersonnelWorkbook,
  buildPersonnelMasterImportPlan,
  computeSha256,
} from "./lib/personnel-import-parser";
import type { ResourceCandidateRow, AliasCandidateRow } from "./lib/personnel-identity";

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

export async function runPersonnelMasterImportDryRun(args: string[] = process.argv.slice(2)) {
  const workbookArg = option(args, "--workbook") ?? "PERFORMANS RAPORU-2026.xlsx";
  const workbookPath = resolve(workbookArg);

  if (!existsSync(workbookPath)) {
    const result = {
      mode: "personnel-master-import-dry-run",
      status: "WORKBOOK_NOT_AVAILABLE",
      workbookPath,
      message: `Workbook file not found at ${workbookPath}. No discovery fabricated.`,
      databaseWrites: false,
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  const fileBuffer = await readFile(workbookPath);
  const workbookFingerprint = computeSha256(fileBuffer);

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);

  let resources: ResourceCandidateRow[] = [];
  let aliases: AliasCandidateRow[] = [];
  const resourceMetadata = new Map<number, { name: string; type?: string }>();

  const useDb = args.includes("--db");
  const resourcesJsonArg = option(args, "--resources-json");

  if (resourcesJsonArg) {
    const data = JSON.parse(await readFile(resolve(resourcesJsonArg), "utf8"));
    resources = data.resources ?? [];
    aliases = data.aliases ?? [];
  } else if (useDb) {
    if (!process.env.DATABASE_URL) {
      throw new Error("--db requires DATABASE_URL environment variable (read-only queries only)");
    }
    const { fetchIdentityCandidates } = await import("./lib/personnel-read");
    const guideCandidates = await fetchIdentityCandidates("GUIDE");
    resources = guideCandidates.resources;
    aliases = guideCandidates.aliasRows;
  }

  // Explicit, human-supplied cross-sheet identity-ambiguity review rules
  // (Phase 2D.3 safety correction). There is no built-in/hard-coded list —
  // a reviewer opts a specific pair/group in via this file, or it is never
  // flagged as REVIEW_TRUE_IDENTITY_AMBIGUITY (same-workbook similarity is
  // otherwise informational only; see sameWorkbookSimilarityNotes).
  // Expected JSON shape: an array of arrays of raw sheet names, e.g.
  // [["GOKBORA", "ERMAN GOKBORA"]]
  let humanSuppliedAmbiguityGroups: string[][] = [];
  const ambiguityGroupsJsonArg = option(args, "--human-ambiguity-groups-json");
  if (ambiguityGroupsJsonArg) {
    humanSuppliedAmbiguityGroups = JSON.parse(await readFile(resolve(ambiguityGroupsJsonArg), "utf8"));
  }

  const discovery = discoverPersonnelWorkbook(workbook, {
    sourceFilename: workbookArg,
    workbookFingerprint,
    workbookSha256: workbookFingerprint,
    humanSuppliedAmbiguityGroups,
  });

  const plan = buildPersonnelMasterImportPlan(discovery, resources, aliases, {
    resourceMetadata,
  });

  const outputArg = option(args, "--output");
  if (outputArg) {
    const flag = args.includes("--overwrite") ? "w" : "wx";
    await writeFile(resolve(outputArg), `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: "utf8",
      flag,
    });
  }

  const summary = {
    mode: "personnel-master-import-dry-run",
    status: "SUCCESS",
    databaseWrites: false,
    workbookPath,
    workbookSha256: plan.workbookSha256,
    workbookFingerprint: plan.workbookFingerprint,
    outputWritten: Boolean(outputArg),
    summary: plan.summary,
  };

  console.log(JSON.stringify(summary, null, 2));
  return { summary, plan };
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  runPersonnelMasterImportDryRun().catch(error => {
    console.error("Dry-run failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
