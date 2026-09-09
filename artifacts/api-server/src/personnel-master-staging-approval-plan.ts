/**
 * CLI runner for Phase 2D.4A Personnel Master Data Staging Execution
 * Foundation.
 *
 * Reads the real workbook, runs the existing Phase 2D.3 discovery/matching
 * pipeline (personnel-import-parser.ts), optionally reads *already-fetched*
 * staging `resources` / `resource_aliases` rows (read-only, via --db or
 * --resources-json), and produces a deterministic staging approval plan
 * (personnel-staging-execution-planner.ts). This CLI NEVER writes to any
 * database — it has no write code path at all.
 *
 * Safety:
 *   - Never prints a connection string, username, or password. --db mode
 *     prints only a redacted identity summary (hostname + database name).
 *   - The generated approval-plan JSON is written to an explicit --output
 *     path (defaulting to a /tmp path) and is never committed to git.
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
import {
  buildStagingApprovalPlan,
  type HumanSuppliedAliasApproval,
} from "./lib/personnel-staging-execution-planner";
import type { ResourceCandidateRow, AliasCandidateRow } from "./lib/personnel-identity";

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

/** Never returns anything containing credentials — hostname/dbname only. */
function describeDatabaseIdentitySafely(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    const dbName = u.pathname.replace(/^\//, "") || "(unknown)";
    return `host=${u.hostname} db=${dbName} neonHost=${u.hostname.endsWith(".neon.tech")}`;
  } catch {
    return "(unparseable DATABASE_URL — identity not confirmed)";
  }
}

export async function runPersonnelMasterStagingApprovalPlan(args: string[] = process.argv.slice(2)) {
  const workbookArg = option(args, "--workbook") ?? "PERFORMANS RAPORU-2026.xlsx";
  const workbookPath = resolve(workbookArg);

  if (!existsSync(workbookPath)) {
    const result = {
      mode: "personnel-master-staging-approval-plan",
      status: "WORKBOOK_NOT_AVAILABLE",
      workbookPath,
      message: `Workbook file not found at ${workbookPath}. No plan fabricated.`,
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
  let stagingSourceDescription: string | null = null;

  const useDb = args.includes("--db");
  const resourcesJsonArg = option(args, "--resources-json");

  if (resourcesJsonArg) {
    const data = JSON.parse(await readFile(resolve(resourcesJsonArg), "utf8"));
    resources = data.resources ?? [];
    aliases = data.aliases ?? [];
    stagingSourceDescription = `file:${resourcesJsonArg}`;
  } else if (useDb) {
    if (!process.env.DATABASE_URL) {
      throw new Error("--db requires DATABASE_URL environment variable (read-only queries only)");
    }
    // Identity is confirmed and logged WITHOUT ever printing the connection
    // string itself — see describeDatabaseIdentitySafely.
    stagingSourceDescription = describeDatabaseIdentitySafely(process.env.DATABASE_URL);
    const { fetchIdentityCandidates } = await import("./lib/personnel-read");
    const guideCandidates = await fetchIdentityCandidates("GUIDE");
    resources = guideCandidates.resources;
    aliases = guideCandidates.aliasRows;
  } else {
    stagingSourceDescription = "NONE_SUPPLIED";
  }

  const humanAmbiguityGroupsJsonArg = option(args, "--human-ambiguity-groups-json");
  let humanSuppliedAmbiguityGroups: string[][] = [];
  if (humanAmbiguityGroupsJsonArg) {
    humanSuppliedAmbiguityGroups = JSON.parse(await readFile(resolve(humanAmbiguityGroupsJsonArg), "utf8"));
  }

  const humanAliasApprovalsJsonArg = option(args, "--human-alias-approvals-json");
  let humanSuppliedAliasApprovals: HumanSuppliedAliasApproval[] = [];
  if (humanAliasApprovalsJsonArg) {
    humanSuppliedAliasApprovals = JSON.parse(await readFile(resolve(humanAliasApprovalsJsonArg), "utf8"));
  }

  const discovery = discoverPersonnelWorkbook(workbook, {
    sourceFilename: workbookArg,
    workbookFingerprint,
    workbookSha256: workbookFingerprint,
    humanSuppliedAmbiguityGroups,
  });

  const importPlan = buildPersonnelMasterImportPlan(discovery, resources, aliases, { resourceMetadata });

  const stagingPlan = buildStagingApprovalPlan(importPlan, {
    humanSuppliedAliasApprovals,
    stagingSourceDescription,
  });

  const outputArg = option(args, "--output") ?? "/tmp/phase2d4-personnel-staging-approval-plan.json";
  const flag = args.includes("--overwrite") ? "w" : "wx";
  // planSha256 must be computed over the EXACT bytes written to disk — a
  // separate (e.g. compact-JSON) serialization here would make the printed
  // outputSha256 silently disagree with `shasum -a 256 <outputPath>`, which
  // defeats the whole point of reporting a package SHA-256 for verification.
  const fileContent = `${JSON.stringify(stagingPlan, null, 2)}\n`;
  await writeFile(resolve(outputArg), fileContent, { encoding: "utf8", flag });
  const planSha256 = computeSha256(fileContent);

  const summary = {
    mode: "personnel-master-staging-approval-plan",
    status: "SUCCESS",
    databaseWrites: false,
    workbookPath,
    workbookSha256: stagingPlan.workbookSha256,
    stagingSourceDescription: stagingPlan.stagingSourceDescription,
    outputPath: resolve(outputArg),
    outputSha256: planSha256,
    deterministicPackageSha256: stagingPlan.deterministicPackageSha256,
    summary: stagingPlan.summary,
  };

  console.log(JSON.stringify(summary, null, 2));
  return { summary, stagingPlan };
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  runPersonnelMasterStagingApprovalPlan().catch(error => {
    console.error("Staging approval plan generation failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
