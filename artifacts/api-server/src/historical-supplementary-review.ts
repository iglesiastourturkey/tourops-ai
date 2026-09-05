import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { historicalDryRunReportSchema } from "./historical-migration-prepare";
import {
  applyHistoricalSupplementaryDecisions,
  buildHistoricalSupplementaryReviewPackage,
  type HistoricalSupplementaryDecisionPackage,
  type HistoricalSupplementaryReviewPackage,
} from "./lib/historical-supplementary-review";
import type { HistoricalDryRunReport } from "./lib/historical-operation-parser";

const sourceKeySchema = z.string().regex(/^legacy:[^:]+:[^:]+:\d+$/);
const reviewGroupSchema = z.object({
  groupKey: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("awaiting_human_decision"),
  sourceKeys: z.tuple([sourceKeySchema, sourceKeySchema]),
  suggestedPrimarySourceKey: sourceKeySchema,
  candidates: z.array(z.object({
    sourceKey: sourceKeySchema,
    sourceRow: z.number().int().positive(),
    customerName: z.string().nullable(),
    operationDate: z.string().nullable(),
    tourSectionRaw: z.string().nullable(),
    notesRaw: z.string().nullable(),
  }).strict()).length(2),
}).strict();

const reviewPackageSchema = z.object({
  version: z.literal(1),
  policyVersion: z.literal("supplementary-review-2026-v1"),
  generatedAt: z.string().min(1),
  sourceReportGeneratedAt: z.string().min(1),
  databaseWrites: z.literal(false),
  driveWrites: z.literal(false),
  requiresHumanApproval: z.literal(true),
  policy: z.object({
    identity: z.literal("preserve_sourceKey"),
    defaultAction: z.literal("none"),
    automaticDropDeleteMerge: z.literal(false),
    consolidationRequiresExplicitApproval: z.literal(true),
  }).strict(),
  summary: z.object({ groups: z.number().int().nonnegative(), sourceRows: z.number().int().nonnegative() }).strict(),
  groups: z.array(reviewGroupSchema),
}).strict();

const decisionPackageSchema = z.object({
  version: z.literal(1),
  reviewPackageGeneratedAt: z.string().min(1),
  decidedAt: z.string().min(1),
  decidedBy: z.string().trim().min(1),
  decisions: z.array(z.object({
    groupKey: z.string().regex(/^[a-f0-9]{64}$/),
    action: z.enum(["consolidate", "keep_separate"]),
    primarySourceKey: sourceKeySchema,
    supplementarySourceKey: sourceKeySchema,
    approved: z.boolean(),
    resultingNotes: z.string().nullable().optional(),
  }).strict()),
}).strict();

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function usage(): never {
  console.error("Kullanim: historical:supplementary-review --input <dry-run.json> (--review-output <review.json> | --review-input <review.json> --decisions <decisions.json> --resolution-output <resolution.json>) [--overwrite]");
  process.exit(2);
}

async function parseJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const inputArg = option(args, "--input");
  if (!inputArg) usage();
  const parsedReport = historicalDryRunReportSchema.parse(await parseJson(inputArg));
  const report = parsedReport as HistoricalDryRunReport;
  const reviewOutput = option(args, "--review-output");
  const reviewInput = option(args, "--review-input");
  const decisionsInput = option(args, "--decisions");
  const resolutionOutput = option(args, "--resolution-output");
  const flag = args.includes("--overwrite") ? "w" : "wx";

  if (reviewOutput && !reviewInput && !decisionsInput && !resolutionOutput) {
    const review = buildHistoricalSupplementaryReviewPackage(report);
    if (resolve(reviewOutput) === resolve(inputArg)) throw new Error("Review cikisi dry-run raporunun uzerine yazamaz");
    await writeFile(resolve(reviewOutput), `${JSON.stringify(review, null, 2)}\n`, { encoding: "utf8", flag });
    console.log(JSON.stringify({ mode: "supplementary-review-plan", databaseWrites: false, driveWrites: false, summary: review.summary }, null, 2));
    return;
  }

  if (!reviewOutput && reviewInput && decisionsInput && resolutionOutput) {
    const paths = [inputArg, reviewInput, decisionsInput, resolutionOutput].map(value => resolve(value));
    if (new Set(paths).size !== paths.length) throw new Error("Girdi ve cikti dosya yollari farkli olmali");
    const review = reviewPackageSchema.parse(await parseJson(reviewInput)) as HistoricalSupplementaryReviewPackage;
    const decisions = decisionPackageSchema.parse(await parseJson(decisionsInput)) as HistoricalSupplementaryDecisionPackage;
    const resolution = applyHistoricalSupplementaryDecisions(report, review, decisions);
    await writeFile(resolve(resolutionOutput), `${JSON.stringify(resolution, null, 2)}\n`, { encoding: "utf8", flag });
    console.log(JSON.stringify({ mode: "supplementary-review-resolve", databaseWrites: false, driveWrites: false, summary: resolution.summary }, null, 2));
    return;
  }

  usage();
}

const isEntrypoint = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Supplementary review basarisiz");
    process.exit(1);
  });
}
