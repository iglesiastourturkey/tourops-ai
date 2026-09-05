import { createHash } from "node:crypto";

import type { HistoricalDryRunReport, HistoricalOperationCandidate } from "./historical-operation-parser";
import {
  buildHistoricalStagingRecord,
  type HistoricalStagingRecord,
} from "./historical-migration-review";

export interface HistoricalSupplementaryReviewGroup {
  groupKey: string;
  status: "awaiting_human_decision";
  sourceKeys: [string, string];
  suggestedPrimarySourceKey: string;
  candidates: Array<{
    sourceKey: string;
    sourceRow: number;
    customerName: string | null;
    operationDate: string | null;
    tourSectionRaw: string | null;
    notesRaw: string | null;
  }>;
}

export interface HistoricalSupplementaryReviewPackage {
  version: 1;
  policyVersion: "supplementary-review-2026-v1";
  generatedAt: string;
  sourceReportGeneratedAt: string;
  databaseWrites: false;
  driveWrites: false;
  requiresHumanApproval: true;
  policy: {
    identity: "preserve_sourceKey";
    defaultAction: "none";
    automaticDropDeleteMerge: false;
    consolidationRequiresExplicitApproval: true;
  };
  summary: { groups: number; sourceRows: number };
  groups: HistoricalSupplementaryReviewGroup[];
}

export interface HistoricalSupplementaryDecision {
  groupKey: string;
  action: "consolidate" | "keep_separate";
  primarySourceKey: string;
  supplementarySourceKey: string;
  approved: true | false;
  resultingNotes?: string | null;
}

export interface HistoricalSupplementaryDecisionPackage {
  version: 1;
  reviewPackageGeneratedAt: string;
  decidedAt: string;
  decidedBy: string;
  decisions: HistoricalSupplementaryDecision[];
}

export interface HistoricalSupplementaryResolution {
  version: 1;
  generatedAt: string;
  databaseWrites: false;
  driveWrites: false;
  humanApproved: true;
  summary: { groups: number; consolidatedGroups: number; keptSeparateGroups: number; stagingRecords: number };
  audit: Array<{
    groupKey: string;
    action: HistoricalSupplementaryDecision["action"];
    decidedAt: string;
    decidedBy: string;
    sourceKeys: [string, string];
    primarySourceKey: string;
    supplementarySourceKey: string;
  }>;
  stagingPackage: {
    version: 1;
    policyVersion: "phase3b-2026-v1";
    generatedAt: string;
    sourceReportGeneratedAt: string;
    databaseWrites: false;
    driveWrites: false;
    requiresImportApproval: true;
    records: HistoricalStagingRecord[];
  };
}

function groupKey(contentFingerprint: string, sourceKeys: string[]): string {
  return createHash("sha256")
    .update(`${contentFingerprint}|${[...sourceKeys].sort().join("|")}`)
    .digest("hex");
}

function supplementaryGroups(report: HistoricalDryRunReport): HistoricalOperationCandidate[][] {
  const byFingerprint = new Map<string, HistoricalOperationCandidate[]>();
  for (const candidate of report.candidates) {
    if (!candidate.issues.includes("supplementary_booking_row")) continue;
    const group = byFingerprint.get(candidate.contentFingerprint) ?? [];
    group.push(candidate);
    byFingerprint.set(candidate.contentFingerprint, group);
  }

  const groups = [...byFingerprint.values()];
  for (const group of groups) {
    if (group.length !== 2) throw new Error("Supplementary grup tam olarak iki sourceKey icermeli");
    if (new Set(group.map(candidate => candidate.sourceKey)).size !== 2) {
      throw new Error("Supplementary grup tekrar eden sourceKey iceriyor");
    }
  }
  return groups;
}

export function buildHistoricalSupplementaryReviewPackage(
  report: HistoricalDryRunReport,
  generatedAt = new Date().toISOString(),
): HistoricalSupplementaryReviewPackage {
  const groups = supplementaryGroups(report).map(candidates => {
    const sorted = [...candidates].sort((a, b) => a.sourceRow - b.sourceRow || a.sourceKey.localeCompare(b.sourceKey));
    const sourceKeys = sorted.map(candidate => candidate.sourceKey) as [string, string];
    return {
      groupKey: groupKey(sorted[0]!.contentFingerprint, sourceKeys),
      status: "awaiting_human_decision" as const,
      sourceKeys,
      suggestedPrimarySourceKey: sourceKeys[0],
      candidates: sorted.map(candidate => ({
        sourceKey: candidate.sourceKey,
        sourceRow: candidate.sourceRow,
        customerName: candidate.customerName,
        operationDate: candidate.operationDate,
        tourSectionRaw: candidate.tourSectionRaw,
        notesRaw: candidate.notesRaw,
      })),
    };
  });

  return {
    version: 1,
    policyVersion: "supplementary-review-2026-v1",
    generatedAt,
    sourceReportGeneratedAt: report.generatedAt,
    databaseWrites: false,
    driveWrites: false,
    requiresHumanApproval: true,
    policy: {
      identity: "preserve_sourceKey",
      defaultAction: "none",
      automaticDropDeleteMerge: false,
      consolidationRequiresExplicitApproval: true,
    },
    summary: { groups: groups.length, sourceRows: groups.length * 2 },
    groups,
  };
}

export function applyHistoricalSupplementaryDecisions(
  report: HistoricalDryRunReport,
  review: HistoricalSupplementaryReviewPackage,
  decisionPackage: HistoricalSupplementaryDecisionPackage,
  generatedAt = new Date().toISOString(),
): HistoricalSupplementaryResolution {
  if (review.sourceReportGeneratedAt !== report.generatedAt) {
    throw new Error("Review paketi bu dry-run raporu icin uretilmemis");
  }
  const expectedReview = buildHistoricalSupplementaryReviewPackage(report, review.generatedAt);
  if (JSON.stringify(expectedReview) !== JSON.stringify(review)) {
    throw new Error("Review paketi dry-run raporuyla uyusmuyor");
  }
  if (decisionPackage.reviewPackageGeneratedAt !== review.generatedAt) {
    throw new Error("Karar paketi bu review paketi icin uretilmemis");
  }
  if (!decisionPackage.decidedBy.trim() || !decisionPackage.decidedAt.trim()) {
    throw new Error("Karar veren ve karar zamani zorunlu");
  }
  if (decisionPackage.decisions.length !== review.groups.length) {
    throw new Error("Supplementary karar paketi eksik veya fazla grup iceriyor");
  }

  const candidateByKey = new Map(report.candidates.map(candidate => [candidate.sourceKey, candidate]));
  const decisionByGroup = new Map(decisionPackage.decisions.map(decision => [decision.groupKey, decision]));
  if (decisionByGroup.size !== decisionPackage.decisions.length) throw new Error("Tekrar eden supplementary grup karari");

  const records: HistoricalStagingRecord[] = [];
  const audit: HistoricalSupplementaryResolution["audit"] = [];
  let consolidatedGroups = 0;

  for (const group of review.groups) {
    const decision = decisionByGroup.get(group.groupKey);
    if (!decision) throw new Error(`Supplementary karar eksik: ${group.groupKey}`);
    if (decision.approved !== true) throw new Error("Consolidation veya ayri tutma icin acik insan onayi gerekir");
    if (!group.sourceKeys.includes(decision.primarySourceKey)) {
      throw new Error("Karardaki primary sourceKey review grubunda bulunmuyor");
    }
    const expectedSupplementary = group.sourceKeys.find(key => key !== decision.primarySourceKey);
    if (!expectedSupplementary || decision.supplementarySourceKey !== expectedSupplementary) {
      throw new Error("Karardaki supplementary sourceKey review grubu ile uyusmuyor");
    }

    const primary = candidateByKey.get(decision.primarySourceKey);
    const supplementary = candidateByKey.get(decision.supplementarySourceKey);
    if (!primary || !supplementary) throw new Error("Review sourceKey dry-run raporunda bulunamadi");

    if (decision.action === "consolidate") {
      if (!("resultingNotes" in decision)) throw new Error("Consolidation karari resultingNotes alanini acikca belirtmeli");
      records.push(buildHistoricalStagingRecord({ ...primary, notesRaw: decision.resultingNotes ?? null }));
      consolidatedGroups += 1;
    } else if (decision.action === "keep_separate") {
      if ("resultingNotes" in decision) throw new Error("keep_separate karari resultingNotes iceremez");
      records.push(buildHistoricalStagingRecord(primary), buildHistoricalStagingRecord(supplementary));
    } else {
      throw new Error("Desteklenmeyen supplementary karari");
    }

    audit.push({
      groupKey: group.groupKey,
      action: decision.action,
      decidedAt: decisionPackage.decidedAt,
      decidedBy: decisionPackage.decidedBy,
      sourceKeys: group.sourceKeys,
      primarySourceKey: decision.primarySourceKey,
      supplementarySourceKey: decision.supplementarySourceKey,
    });
  }

  if (new Set(records.map(record => record.idempotencyKey)).size !== records.length) {
    throw new Error("Cozumleme cikisi tekrar eden sourceKey iceriyor");
  }

  return {
    version: 1,
    generatedAt,
    databaseWrites: false,
    driveWrites: false,
    humanApproved: true,
    summary: {
      groups: review.groups.length,
      consolidatedGroups,
      keptSeparateGroups: review.groups.length - consolidatedGroups,
      stagingRecords: records.length,
    },
    audit,
    stagingPackage: {
      version: 1,
      policyVersion: "phase3b-2026-v1",
      generatedAt,
      sourceReportGeneratedAt: report.generatedAt,
      databaseWrites: false,
      driveWrites: false,
      requiresImportApproval: true,
      records,
    },
  };
}
