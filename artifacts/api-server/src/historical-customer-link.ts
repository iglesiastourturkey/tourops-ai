import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { customerLinkApplyCounts } from "./lib/historical-customer-link-validation";

const CONFIRMATION = "TOURPILOT_2026_HISTORICAL_CUSTOMER_LINK";

export interface HistoricalCustomerLinkArgs {
  sourceKey: string;
  customerId: number;
  actorProfileId: number;
  apply: boolean;
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} pozitif bir tam sayi olmalidir`);
  }
  return parsed;
}

/** Strict single-target parser: no repeated flags, targeting lists, or limits. */
export function parseHistoricalCustomerLinkArgs(args: string[]): HistoricalCustomerLinkArgs {
  let sourceKey: string | null = null;
  let customerId: number | null = null;
  let actorProfileId: number | null = null;
  let apply = false;
  let confirmation: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      if (apply) throw new Error("--apply bir kez kullanilabilir");
      apply = true;
      continue;
    }
    if (arg === "--source-key") {
      if (sourceKey !== null) throw new Error("Tam olarak bir --source-key gereklidir");
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--source-key bos olamaz");
      sourceKey = value.trim();
      if (!sourceKey) throw new Error("--source-key bos olamaz");
      continue;
    }
    if (arg === "--customer-id") {
      if (customerId !== null) throw new Error("Tam olarak bir --customer-id gereklidir");
      customerId = positiveInteger(args[++index], "--customer-id");
      continue;
    }
    if (arg === "--operator-profile-id") {
      if (actorProfileId !== null) throw new Error("Tam olarak bir --operator-profile-id gereklidir");
      actorProfileId = positiveInteger(args[++index], "--operator-profile-id");
      continue;
    }
    if (arg === "--confirm-customer-link") {
      if (confirmation !== null) throw new Error("--confirm-customer-link bir kez kullanilabilir");
      confirmation = args[++index] ?? null;
      continue;
    }
    throw new Error(`Desteklenmeyen veya sinirsiz bayrak: ${arg}`);
  }

  if (sourceKey === null) throw new Error("Tam olarak bir --source-key gereklidir");
  if (customerId === null) throw new Error("Tam olarak bir --customer-id gereklidir");
  // PLAN reads customer-link evidence, so customer_review is required too.
  if (actorProfileId === null) throw new Error("--operator-profile-id zorunludur");
  if (!apply && confirmation !== null) throw new Error("--confirm-customer-link yalnizca --apply ile kullanilabilir");
  if (apply && confirmation !== CONFIRMATION) {
    throw new Error("Customer link APPLY icin tam onay ifadesi gerekli");
  }
  return { sourceKey, customerId, actorProfileId, apply };
}

/** Staging-only guard shared by both PLAN and APPLY modes. */
export function validateHistoricalCustomerLinkTarget(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "production") {
    throw new Error("Production ortaminda historical customer link calistirilamaz");
  }
  const connectionString = env.HISTORICAL_STAGING_DATABASE_URL;
  const allowedHost = env.HISTORICAL_STAGING_DATABASE_HOST;
  if (!connectionString || !allowedHost) {
    throw new Error("HISTORICAL_STAGING_DATABASE_URL ve HISTORICAL_STAGING_DATABASE_HOST gerekli");
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Historical customer link baglanti URL'i gecersiz");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("Historical customer link baglantisi PostgreSQL olmali");
  }
  if (url.hostname !== allowedHost || !allowedHost.endsWith(".neon.tech")) {
    throw new Error("Historical customer link host allowlist veya Neon kontrolu basarisiz");
  }
  return connectionString;
}

async function main() {
  const parsed = parseHistoricalCustomerLinkArgs(process.argv.slice(2));
  const connectionString = validateHistoricalCustomerLinkTarget();
  process.env.DATABASE_URL = connectionString;

  const { pool } = await import("@workspace/db");
  try {
    const { planHistoricalCustomerLink, applyHistoricalCustomerLink } = await import("./lib/historical-customer-link");
    if (!parsed.apply) {
      const assessment = await planHistoricalCustomerLink(parsed);
      console.log(JSON.stringify({
        mode: "historical-customer-link-plan",
        databaseWrites: false,
        customerWrites: false,
        operationWrites: false,
        operatorProfileId: parsed.actorProfileId,
        ...assessment,
      }, null, 2));
      return;
    }

    const result = await applyHistoricalCustomerLink(parsed);
    console.log(JSON.stringify({
      mode: "historical-customer-link-apply",
      databaseWrites: result.kind === "linked",
      customerWrites: false,
      operationWrites: result.kind === "linked",
      operatorProfileId: parsed.actorProfileId,
      ...customerLinkApplyCounts(result.kind),
      ...result.assessment,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Historical customer link basarisiz");
    process.exit(1);
  });
}
