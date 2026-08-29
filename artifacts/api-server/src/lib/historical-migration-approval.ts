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

export interface ApproveHistoricalImportParams {
  sourceKey: string;
  actorProfileId: number;
  reviewNotes?: string | null;
}

export interface RejectHistoricalImportParams {
  sourceKey: string;
  actorProfileId: number;
  rejectionReason: string;
}

export type ApprovalResult =
  | { ok: true; sourceKey: string }
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
      metadata: { sourceKey: params.sourceKey },
      description: "Historical staging kaydi onaylandi",
    }, tx);

    return { ok: true, sourceKey: params.sourceKey };
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

    return { ok: true, sourceKey: params.sourceKey };
  });
}
