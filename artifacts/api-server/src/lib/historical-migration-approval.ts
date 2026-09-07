/**
 * Faz 3D-A: reusable server-side approve/reject operations for
 * historical_operation_imports rows. No route wires these up yet - Phase 3D-A
 * is CLI-first (historical:promote) per the approved architecture report;
 * a UI/route layer is a separate, later decision.
 *
 * Both actions:
 *   - do NOT trust actorProfileId merely because a caller supplied one:
 *     verifyOperatorPermission() loads the profile from DB, requires it to
 *     be active, and checks historical_migration.approve/reject through the
 *     existing hasPermission() policy (role_permissions/user_permissions,
 *     same super_admin bypass every HTTP route gets) before anything else
 *     runs. A caller with no permission never reaches the row lock.
 *   - require the row to currently be "pending" (state machine in
 *     historical-migration-promote-validation.ts),
 *   - use SELECT ... FOR UPDATE + an approval_version compare-and-swap so two
 *     concurrent approve/reject calls on the same row cannot race,
 *   - write their audit_logs row inside the same transaction as the status
 *     change (strict-mode createAuditLog - see lib/audit.ts), so an audit
 *     failure rolls back the approval/rejection instead of leaving a status
 *     change with no trail.
 */

import { db } from "@workspace/db";
import { historicalOperationImportsTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { createAuditLog } from "./audit";
import { historicalImportTransitionBlock } from "./historical-migration-promote-validation";
import { verifyOperatorPermission } from "./historical-migration-operator";
import {
  parseHistoricalStagingRecord,
  sha256OfHistoricalStagingRecord,
} from "./historical-migration-stage-validation";
import { deriveHistoricalReviewReadiness } from "./historical-remediation-review-readiness";

export interface ApproveHistoricalImportParams {
  sourceKey: string;
  actorProfileId: number;
  reviewNotes?: string | null;
  /**
   * Optional fail-closed warning allowlist for controlled batch review.
   * When supplied, it is re-checked while the staging row is locked so a
   * warning-profile change between batch selection and approval cannot slip
   * through the low-risk gate.
   */
  allowedWarnings?: readonly string[];
  /**
   * Phase 3E.4B: optimistic-concurrency expectations for the HTTP approval
   * handoff. When supplied, they are re-checked inside the locked
   * transaction; a mismatch fails as concurrent_update. CLI callers omit
   * them and keep the exact pre-3E.4B behavior.
   */
  expectedVersion?: number;
  expectedPayloadHash?: string;
  /**
   * Phase 3E.4B: when true, the locked row must derive READY_FOR_REVIEW
   * (pending, no blocking warnings). The HTTP handoff sets this; CLI
   * callers omit it and are unaffected.
   */
  requireReadyForReview?: boolean;
}

export interface RejectHistoricalImportParams {
  sourceKey: string;
  actorProfileId: number;
  rejectionReason: string;
}

export type ApprovalResult =
  | {
      ok: true;
      sourceKey: string;
      id: number;
      status: "approved" | "rejected";
      approvalVersion: number;
      payloadSha256: string;
    }
  | {
      ok: false;
      code: "not_found" | "invalid_transition" | "concurrent_update" | "operator_not_found" | "operator_inactive" | "forbidden";
      message: string;
    };

export async function approveHistoricalImport(params: ApproveHistoricalImportParams): Promise<ApprovalResult> {
  const verification = await verifyOperatorPermission(params.actorProfileId, "historical_migration", "approve");
  if (!verification.ok) return verification;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(historicalOperationImportsTable)
      .where(eq(historicalOperationImportsTable.sourceKey, params.sourceKey))
      .for("update")
      .limit(1);
    if (!row) return { ok: false, code: "not_found", message: "Staging kaydi bulunamadi" };

    const blocked = historicalImportTransitionBlock("approve", row.status);
    if (blocked) return { ok: false, code: "invalid_transition", message: blocked };

    if (params.allowedWarnings) {
      const allowed = new Set(params.allowedWarnings);
      const warnings = Array.isArray(row.warnings) ? row.warnings : [];
      const disallowed = warnings.filter(warning => !allowed.has(warning));
      if (disallowed.length > 0) {
        return {
          ok: false,
          code: "invalid_transition",
          message: `Warning profili kontrollu batch allowlist'i disinda: ${disallowed.join(", ")}`,
        };
      }
    }

    // Phase 3E.4B: stored payload integrity is proven before any caller
    // expectation is accepted. A corrupt stored payload fails closed here —
    // it can never be approved, by HTTP or by CLI.
    let payloadHash: string;
    try {
      const payload = parseHistoricalStagingRecord(row.payload);
      payloadHash = sha256OfHistoricalStagingRecord(payload);
    } catch {
      return { ok: false, code: "invalid_transition", message: "Stored historical payload is invalid" };
    }
    if (payloadHash !== row.payloadSha256) {
      return { ok: false, code: "invalid_transition", message: "Stored historical payload hash integrity check failed" };
    }

    if (params.expectedVersion !== undefined && params.expectedVersion !== row.approvalVersion) {
      return { ok: false, code: "concurrent_update", message: "Kayit ayni anda baska bir islemle degistirildi, tekrar deneyin" };
    }
    if (params.expectedPayloadHash !== undefined && params.expectedPayloadHash !== row.payloadSha256) {
      return { ok: false, code: "concurrent_update", message: "Kayit ayni anda baska bir islemle degistirildi, tekrar deneyin" };
    }

    if (params.requireReadyForReview) {
      const warnings = Array.isArray(row.warnings) ? row.warnings : [];
      if (deriveHistoricalReviewReadiness(row.status, warnings) !== "READY_FOR_REVIEW") {
        return { ok: false, code: "invalid_transition", message: "Kayit incelemeye hazir degil" };
      }
    }

    const updated = await tx
      .update(historicalOperationImportsTable)
      .set({
        status: "approved",
        approvedByOperatorId: params.actorProfileId,
        approvedAt: new Date(),
        rejectedByOperatorId: null,
        rejectedAt: null,
        rejectionReason: null,
        reviewNotes: params.reviewNotes ?? row.reviewNotes,
        approvalVersion: sql`${historicalOperationImportsTable.approvalVersion} + 1`,
      })
      .where(and(
        eq(historicalOperationImportsTable.sourceKey, params.sourceKey),
        eq(historicalOperationImportsTable.approvalVersion, row.approvalVersion),
      ))
      .returning({ id: historicalOperationImportsTable.id });
    if (!updated[0]) return { ok: false, code: "concurrent_update", message: "Kayit ayni anda baska bir islemle degistirildi, tekrar deneyin" };

    await createAuditLog({
      eventType: "historical_migration_approved",
      actorProfileId: params.actorProfileId,
      module: "historical_migration",
      entityType: "historical_operation_import",
      entityId: row.id,
      metadata: {
        sourceKey: params.sourceKey,
        action: "approve",
        previousStatus: row.status,
        newStatus: "approved",
        previousVersion: row.approvalVersion,
        newVersion: row.approvalVersion + 1,
        payloadSha256: row.payloadSha256,
      },
      description: "Historical staging kaydi onaylandi",
    }, tx);

    return {
      ok: true,
      sourceKey: params.sourceKey,
      id: row.id,
      status: "approved",
      approvalVersion: row.approvalVersion + 1,
      payloadSha256: row.payloadSha256,
    };
  });
}

export async function rejectHistoricalImport(params: RejectHistoricalImportParams): Promise<ApprovalResult> {
  if (!params.rejectionReason.trim()) {
    return { ok: false, code: "invalid_transition", message: "Red gerekcesi zorunludur" };
  }

  const verification = await verifyOperatorPermission(params.actorProfileId, "historical_migration", "reject");
  if (!verification.ok) return verification;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(historicalOperationImportsTable)
      .where(eq(historicalOperationImportsTable.sourceKey, params.sourceKey))
      .for("update")
      .limit(1);
    if (!row) return { ok: false, code: "not_found", message: "Staging kaydi bulunamadi" };

    const blocked = historicalImportTransitionBlock("reject", row.status);
    if (blocked) return { ok: false, code: "invalid_transition", message: blocked };

    const updated = await tx
      .update(historicalOperationImportsTable)
      .set({
        status: "rejected",
        rejectedByOperatorId: params.actorProfileId,
        rejectedAt: new Date(),
        rejectionReason: params.rejectionReason.trim(),
        approvedByOperatorId: null,
        approvedAt: null,
        approvalVersion: sql`${historicalOperationImportsTable.approvalVersion} + 1`,
      })
      .where(and(
        eq(historicalOperationImportsTable.sourceKey, params.sourceKey),
        eq(historicalOperationImportsTable.approvalVersion, row.approvalVersion),
      ))
      .returning({ id: historicalOperationImportsTable.id });
    if (!updated[0]) return { ok: false, code: "concurrent_update", message: "Kayit ayni anda baska bir islemle degistirildi, tekrar deneyin" };

    await createAuditLog({
      eventType: "historical_migration_rejected",
      actorProfileId: params.actorProfileId,
      module: "historical_migration",
      entityType: "historical_operation_import",
      entityId: row.id,
      metadata: { sourceKey: params.sourceKey, rejectionReason: params.rejectionReason.trim() },
      description: "Historical staging kaydi reddedildi",
    }, tx);

    return {
      ok: true,
      sourceKey: params.sourceKey,
      id: row.id,
      status: "rejected",
      approvalVersion: row.approvalVersion + 1,
      payloadSha256: row.payloadSha256,
    };
  });
}
