import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildHistoricalMigrationPreparation } from "./lib/historical-migration-review";
import type { HistoricalDryRunReport } from "./lib/historical-operation-parser";

const issueSchema = z.enum([
  "missing_operation_date",
  "missing_customer_name",
  "missing_booking_reference",
  "possible_duplicate_content",
  "ambiguous_duplicate_content",
  "supplementary_booking_row",
]);

const candidateSchema = z.object({
  sourceKey: z.string().trim().min(1),
  contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceFileId: z.string().trim().min(1),
  sourceKind: z.enum(["gemi", "sejour"]),
  worksheetName: z.string().min(1),
  sourceRow: z.number().int().positive(),
  operationDate: z.string().regex(/^2026-\d{2}-\d{2}$/).nullable(),
  reservationType: z.enum(["PVT", "REG"]),
  agency: z.string().nullable(),
  operator: z.string().nullable(),
  adultCount: z.number().finite().nullable(),
  childCount: z.number().finite().nullable(),
  customerName: z.string().nullable(),
  pickupPoint: z.string().nullable(),
  language: z.string().nullable(),
  pickupTime: z.string().nullable(),
  collectionStatusRaw: z.string().nullable(),
  notesRaw: z.string().nullable(),
  tourSectionRaw: z.string().nullable(),
  sourceBookingReference: z.null(),
  disposition: z.enum(["ready", "review_required"]),
  issues: z.array(issueSchema),
}).strict();

const reportSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  scope: z.object({
    year: z.literal(2026),
    sourceKinds: z.array(z.enum(["gemi", "sejour"])),
    databaseWrites: z.literal(false),
    driveWrites: z.literal(false),
  }).strict(),
  summary: z.object({
    workbooks: z.number().int().nonnegative(),
    worksheets: z.number().int().nonnegative(),
    candidates: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    reviewRequired: z.number().int().nonnegative(),
    possibleDuplicates: z.number().int().nonnegative(),
  }).strict(),
  candidates: z.array(candidateSchema),
}).strict().superRefine((report, context) => {
  if (report.summary.candidates !== report.candidates.length) {
    context.addIssue({ code: "custom", message: "Aday sayisi rapor ozetiyle uyusmuyor" });
  }
});

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function usage(): never {
  console.error("Kullanim: pnpm --filter @workspace/api-server historical:prepare -- --input <dry-run-report.json> [--review-output <review.json>] [--staging-output <staging.json>] [--overwrite]");
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const inputArg = option(args, "--input");
  if (!inputArg) usage();

  const inputPath = resolve(inputArg);
  const parsed = reportSchema.safeParse(JSON.parse(await readFile(inputPath, "utf8")));
  if (!parsed.success) {
    console.error("Gecersiz Faz 3A raporu:", parsed.error.issues);
    process.exit(2);
  }

  const reviewOutputArg = option(args, "--review-output");
  const stagingOutputArg = option(args, "--staging-output");
  const outputPaths = [reviewOutputArg, stagingOutputArg]
    .filter((value): value is string => Boolean(value))
    .map(value => resolve(value));
  if (outputPaths.some(path => path === inputPath)) throw new Error("Cikti yolu girdi raporunun uzerine yazamaz");
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("Review ve staging ciktilari farkli dosyalar olmali");

  const preparation = buildHistoricalMigrationPreparation(parsed.data as HistoricalDryRunReport);
  const flag = args.includes("--overwrite") ? "w" : "wx";
  if (reviewOutputArg) {
    await writeFile(resolve(reviewOutputArg), `${JSON.stringify(preparation.reviewPackage, null, 2)}\n`, { encoding: "utf8", flag });
  }
  if (stagingOutputArg) {
    await writeFile(resolve(stagingOutputArg), `${JSON.stringify(preparation.stagingPackage, null, 2)}\n`, { encoding: "utf8", flag });
  }

  console.log(JSON.stringify({
    mode: "historical-staging-preparation",
    databaseWrites: false,
    driveWrites: false,
    requiresImportApproval: true,
    reviewPackageWritten: Boolean(reviewOutputArg),
    stagingPackageWritten: Boolean(stagingOutputArg),
    summary: preparation.reviewPackage.summary,
  }, null, 2));
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Faz 3B hazirligi basarisiz");
    process.exit(1);
  });
}
