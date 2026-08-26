import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type ExcelJSType from "exceljs";
import { z } from "zod";
import { buildHistoricalDryRunReport, type HistoricalWorkbookDescriptor } from "./lib/historical-operation-parser";

const manifestSchema = z.object({
  version: z.literal(1),
  files: z.array(z.object({
    path: z.string().trim().min(1),
    sourceFileId: z.string().trim().min(1),
    sourceKind: z.enum(["gemi", "sejour"]),
    year: z.literal(2026),
    month: z.number().int().min(1).max(12),
  }).strict()).min(1),
}).strict();

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function usage(): never {
  console.error("Kullanim: pnpm --filter @workspace/api-server historical:dry-run -- --manifest <manifest.json> [--output <report.json>] [--overwrite]");
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const manifestArg = option(args, "--manifest");
  if (!manifestArg) usage();

  const manifestPath = resolve(manifestArg);
  const parsedManifest = manifestSchema.safeParse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (!parsedManifest.success) {
    console.error("Gecersiz Faz 3A manifesti:", parsedManifest.error.issues);
    process.exit(2);
  }

  const { default: ExcelJS } = await import("exceljs");
  const baseDir = dirname(manifestPath);
  const parsedWorkbooks: Array<{ descriptor: HistoricalWorkbookDescriptor; workbook: ExcelJSType.Workbook }> = [];

  for (const entry of parsedManifest.data.files) {
    if (/^https?:\/\//i.test(entry.path)) throw new Error("Manifest yalnizca yerel dosya yollarini kabul eder");
    const workbookPath = resolve(baseDir, entry.path);
    if (!new Set([".xlsx", ".xlsm"]).has(extname(workbookPath).toLowerCase())) {
      throw new Error(`Desteklenmeyen dosya turu: ${workbookPath}`);
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    parsedWorkbooks.push({ descriptor: { ...entry, path: workbookPath }, workbook });
  }

  const report = buildHistoricalDryRunReport(parsedWorkbooks);
  const outputArg = option(args, "--output");
  if (outputArg) {
    const flag = args.includes("--overwrite") ? "w" : "wx";
    await writeFile(resolve(outputArg), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag });
  }

  console.log(JSON.stringify({
    mode: "dry-run",
    databaseWrites: false,
    driveWrites: false,
    reportWritten: Boolean(outputArg),
    summary: report.summary,
  }, null, 2));
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Dry-run basarisiz");
    process.exit(1);
  });
}
