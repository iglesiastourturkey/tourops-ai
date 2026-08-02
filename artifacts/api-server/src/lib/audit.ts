/**
 * audit.ts — thin helper for writing structured audit log entries.
 * Import this from any route that needs to record security-relevant events.
 */

import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";

export type AuditEvent =
  | "role_changed"
  | "permission_changed"
  | "user_override_set"
  | "user_override_removed"
  | "system_mode_changed"
  | "session_revoked"
  | "user_deactivated"
  | "user_activated"
  | "username_set";

export interface CreateAuditLogParams {
  eventType:       AuditEvent;
  actorProfileId?: number;
  targetProfileId?: number;
  oldValue?:       unknown;
  newValue?:       unknown;
  metadata?:       unknown;
}

export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  await db.insert(auditLogsTable).values({
    eventType:       params.eventType,
    actorProfileId:  params.actorProfileId  ?? null,
    targetProfileId: params.targetProfileId ?? null,
    oldValue:        params.oldValue  != null ? (params.oldValue  as Record<string, unknown>) : null,
    newValue:        params.newValue  != null ? (params.newValue  as Record<string, unknown>) : null,
    metadata:        params.metadata  != null ? (params.metadata  as Record<string, unknown>) : null,
  });
}
