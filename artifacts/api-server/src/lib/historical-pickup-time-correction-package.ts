import { isDeepStrictEqual } from "node:util";
import {
  canonicalPickupTimeFromSentinel,
  parseHistoricalPickupTimeCorrectionPackage,
  type HistoricalPickupTimeCorrectionPackage,
} from "./historical-pickup-time-correction";
import {
  parseHistoricalStagingRecord,
  sha256OfHistoricalStagingRecord,
  type HistoricalStagingRecord,
} from "./historical-migration-stage-validation";

export interface HistoricalDryRunCandidate {
  sourceKey: string;
  sourceFileId: string;
  worksheetName: string;
  sourceRow: number;
  pickupTime: string | null;
  contentFingerprint: string;
}

export interface HistoricalDryRunReportInput {
  generatedAt: string;
  candidates: HistoricalDryRunCandidate[];
}

export interface HistoricalStagingPackageInput {
  generatedAt: string;
  sourceReportGeneratedAt: string;
  records: unknown[];
}

export interface PickupTimeCorrectionPackageReconciliation {
  records: number;
  uniqueSourceKeys: number;
  pendingExpected: "requires DB PLAN";
  importedExpected: "requires DB PLAN";
  oldSentinelCount: number;
  canonicalTargetCount: number;
  malformedIncluded: number;
  duplicateSourceKeys: number;
  missingOldCandidate: number;
  missingNewCandidate: number;
  payloadBeforeHashMismatch: number;
  payloadAfterHashMismatch: number;
  fingerprintChanged: number;
  nonPickupPayloadChanges: number;
}

export interface GeneratedPickupTimeCorrectionPackage {
  correctionPackage: HistoricalPickupTimeCorrectionPackage;
  reconciliation: PickupTimeCorrectionPackageReconciliation;
}

const SOURCE_KEY = /^legacy:[^:]+:[^:]+:[1-9]\d*$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

function fail(message: string): never {
  throw new Error(`Historical pickup-time correction package fail-closed: ${message}`);
}

function exactSourceKey(candidate: HistoricalDryRunCandidate): string {
  if (!candidate || typeof candidate !== "object") fail("dry-run candidate gecersiz");
  if (typeof candidate.sourceFileId !== "string" || !candidate.sourceFileId
    || typeof candidate.worksheetName !== "string" || !candidate.worksheetName
    || !Number.isInteger(candidate.sourceRow) || candidate.sourceRow <= 0) {
    fail("dry-run provenance eksik veya gecersiz");
  }
  const reconstructed = `legacy:${candidate.sourceFileId}:${candidate.worksheetName}:${candidate.sourceRow}`;
  if (!SOURCE_KEY.test(reconstructed) || candidate.sourceKey !== reconstructed) {
    fail(`dry-run sourceKey provenance ile uyusmuyor: ${candidate.sourceKey}`);
  }
  if (typeof candidate.pickupTime !== "string" && candidate.pickupTime !== null) {
    fail(`dry-run pickupTime gecersiz: ${candidate.sourceKey}`);
  }
  if (typeof candidate.contentFingerprint !== "string" || !FINGERPRINT.test(candidate.contentFingerprint)) {
    fail(`dry-run contentFingerprint gecersiz: ${candidate.sourceKey}`);
  }
  return reconstructed;
}

function uniqueCandidateMap(candidates: HistoricalDryRunCandidate[], reportName: string): Map<string, HistoricalDryRunCandidate> {
  if (!Array.isArray(candidates)) fail(`${reportName} candidates dizisi eksik`);
  const result = new Map<string, HistoricalDryRunCandidate>();
  for (const candidate of candidates) {
    const sourceKey = exactSourceKey(candidate);
    if (result.has(sourceKey)) fail(`${reportName} duplicate sourceKey: ${sourceKey}`);
    result.set(sourceKey, candidate);
  }
  return result;
}

function cloneWithPickupTime(payload: HistoricalStagingRecord, pickupTime: string): HistoricalStagingRecord {
  return { ...payload, operation: { ...payload.operation, pickupTime } };
}

export function assertOnlyPickupTimeChanged(before: HistoricalStagingRecord, after: HistoricalStagingRecord): void {
  const { pickupTime: beforePickupTime, ...beforeOperation } = before.operation;
  const { pickupTime: afterPickupTime, ...afterOperation } = after.operation;
  if (beforePickupTime === afterPickupTime
    || !isDeepStrictEqual({ ...before, operation: beforeOperation }, { ...after, operation: afterOperation })) {
    fail("pickupTime disinda payload degisikligi algilandi");
  }
}

/**
 * Pure local reconciliation. It never reads files or a database, and all
 * payload digests come from the shared Phase 3C hash helper.
 */
export function buildHistoricalPickupTimeCorrectionPackage(params: {
  oldReport: HistoricalDryRunReportInput;
  newReport: HistoricalDryRunReportInput;
  stagingPackage: HistoricalStagingPackageInput;
  generatedAt: string;
}): GeneratedPickupTimeCorrectionPackage {
  const oldByKey = uniqueCandidateMap(params.oldReport.candidates, "old dry-run");
  const newByKey = uniqueCandidateMap(params.newReport.candidates, "new dry-run");
  if (!Array.isArray(params.stagingPackage.records)) fail("staging records dizisi eksik");

  const stagingByKey = new Map<string, HistoricalStagingRecord>();
  let oldSentinelCount = 0;
  let malformedIncluded = 0;
  const records: HistoricalPickupTimeCorrectionPackage["records"] = [];

  for (const inputRecord of params.stagingPackage.records) {
    let payload: HistoricalStagingRecord;
    try {
      payload = parseHistoricalStagingRecord(inputRecord);
    } catch {
      fail("staging payload schema gecersiz");
    }
    const sourceKey = payload.idempotencyKey;
    const expectedKey = `legacy:${payload.provenance.sourceFileId}:${payload.provenance.worksheetName}:${payload.provenance.sourceRow}`;
    if (!SOURCE_KEY.test(sourceKey) || sourceKey !== expectedKey) {
      fail(`staging source identity uyusmuyor: ${sourceKey}`);
    }
    if (stagingByKey.has(sourceKey)) fail(`staging duplicate sourceKey: ${sourceKey}`);
    stagingByKey.set(sourceKey, payload);

    const oldPickupTime = payload.operation.pickupTime;
    if (typeof oldPickupTime !== "string") continue;
    const newPickupTime = canonicalPickupTimeFromSentinel(oldPickupTime);
    if (newPickupTime === null) continue;
    oldSentinelCount += 1;

    const oldCandidate = oldByKey.get(sourceKey);
    const newCandidate = newByKey.get(sourceKey);
    if (!oldCandidate) fail(`old candidate missing: ${sourceKey}`);
    if (!newCandidate) fail(`new candidate missing: ${sourceKey}`);
    if (oldCandidate.pickupTime !== oldPickupTime) fail(`old staged pickup dry-run ile uyusmuyor: ${sourceKey}`);
    if (newCandidate.pickupTime !== newPickupTime) fail(`new pickup deterministik hedefle uyusmuyor: ${sourceKey}`);
    if (oldCandidate.contentFingerprint === newCandidate.contentFingerprint) {
      fail(`affected fingerprint degismedi: ${sourceKey}`);
    }

    const correctedPayload = cloneWithPickupTime(payload, newPickupTime);
    try {
      assertOnlyPickupTimeChanged(payload, correctedPayload);
    } catch {
      fail(`pickupTime disinda payload degisikligi algilandi: ${sourceKey}`);
    }
    const payloadSha256Before = sha256OfHistoricalStagingRecord(payload);
    const payloadSha256After = sha256OfHistoricalStagingRecord(correctedPayload);
    if (payloadSha256Before === payloadSha256After) fail(`payload hash degismedi: ${sourceKey}`);
    if (oldPickupTime === "8::30" || oldPickupTime === "11.15") malformedIncluded += 1;
    records.push({
      sourceKey,
      oldPickupTime,
      newPickupTime,
      contentFingerprintBefore: oldCandidate.contentFingerprint,
      contentFingerprintAfter: newCandidate.contentFingerprint,
      payloadSha256Before,
      payloadSha256After,
    });
  }

  if (malformedIncluded > 0) fail("malformed pickup correction package icine girdi");
  const correctionPackage = parseHistoricalPickupTimeCorrectionPackage({
    mode: "historical-pickup-time-correction",
    version: 1,
    kind: "historical-pickup-time-correction",
    generatedAt: params.generatedAt,
    sourceReportGeneratedAt: params.newReport.generatedAt,
    databaseWrites: false,
    records,
  });
  const reconciliation: PickupTimeCorrectionPackageReconciliation = {
    records: records.length,
    uniqueSourceKeys: new Set(records.map(record => record.sourceKey)).size,
    pendingExpected: "requires DB PLAN",
    importedExpected: "requires DB PLAN",
    oldSentinelCount,
    canonicalTargetCount: records.filter(record => record.newPickupTime === canonicalPickupTimeFromSentinel(record.oldPickupTime)).length,
    malformedIncluded,
    duplicateSourceKeys: 0,
    missingOldCandidate: 0,
    missingNewCandidate: 0,
    payloadBeforeHashMismatch: 0,
    payloadAfterHashMismatch: 0,
    fingerprintChanged: records.filter(record => record.contentFingerprintBefore !== record.contentFingerprintAfter).length,
    nonPickupPayloadChanges: 0,
  };
  if (reconciliation.records !== reconciliation.uniqueSourceKeys) fail("uretilen package duplicate sourceKey iceriyor");
  return { correctionPackage, reconciliation };
}
