import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHistoricalPickupTimeCorrectionPackage,
} from "./lib/historical-pickup-time-correction-package";

const OLD_REPORT = "/Users/mehmetcam/Developer/tourops-ai-phase3c/local-data/dry-run-report.json";
const STAGING_PACKAGE = "/Users/mehmetcam/Developer/tourops-ai-phase3c/local-data/historical-staging.json";
const NEW_REPORT = "/tmp/tourpilot-pickup-normalized-dry-run.json";
export const OUTPUT_PATH = "/tmp/tourpilot-historical-pickup-time-correction-v1.json";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function generateHistoricalPickupTimeCorrectionPackage() {
  const [oldReport, stagingPackage, newReport] = await Promise.all([
    readJson(OLD_REPORT),
    readJson(STAGING_PACKAGE),
    readJson(NEW_REPORT),
  ]);
  const result = buildHistoricalPickupTimeCorrectionPackage({
    oldReport: oldReport as never,
    newReport: newReport as never,
    stagingPackage: stagingPackage as never,
    generatedAt: new Date().toISOString(),
  });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(result.correctionPackage, null, 2)}\n`, "utf8");
  return result;
}

async function main() {
  const result = await generateHistoricalPickupTimeCorrectionPackage();
  console.log(JSON.stringify({ outputPath: OUTPUT_PATH, ...result.reconciliation }, null, 2));
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Historical pickup-time correction package generation basarisiz");
    process.exit(1);
  });
}
