/**
 * audit.ts — thin helper for writing structured audit log entries.
 * Import this from any route that needs to record security-relevant events.
 */

import { db } from "@workspace/db";
import { auditLogsTable, profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export type AuditEvent = string;

export interface CreateAuditLogParams {
  eventType:       AuditEvent;
  actorProfileId?: number;
  targetProfileId?: number;
  oldValue?:       unknown;
  newValue?:       unknown;
  metadata?:       unknown;
  module?:          string;
  result?:          "success" | "failure" | "denied";
  description?:     string;
  entityType?:      string;
  entityId?:        string | number;
}

const SENSITIVE_KEY = /(password|token|secret|cookie|authorization|api[-_]?key|private[-_]?key|jwt)/i;
const MAX_STRING_LENGTH = 500;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .slice(0, 50)
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]),
  );
}

export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  try {
    const actor = params.actorProfileId
      ? (await db
          .select({ name: profilesTable.name, email: profilesTable.email, role: profilesTable.role })
          .from(profilesTable)
          .where(eq(profilesTable.id, params.actorProfileId))
          .limit(1))[0]
      : undefined;

    const metadata = {
      ...(params.metadata && typeof params.metadata === "object" && !Array.isArray(params.metadata)
        ? params.metadata as Record<string, unknown>
        : {}),
      ...(params.module ? { module: params.module } : {}),
      ...(params.result ? { result: params.result } : {}),
      ...(params.description ? { description: params.description } : {}),
      ...(params.entityType ? { entityType: params.entityType } : {}),
      ...(params.entityId != null ? { entityId: String(params.entityId) } : {}),
      ...(actor ? { actorName: actor.name, actorEmail: actor.email, actorRole: actor.role } : {}),
    };

    await db.insert(auditLogsTable).values({
      eventType:       params.eventType,
      actorProfileId:  params.actorProfileId  ?? null,
      targetProfileId: params.targetProfileId ?? null,
      oldValue:        params.oldValue  != null ? sanitizeValue(params.oldValue) as Record<string, unknown> : null,
      newValue:        params.newValue  != null ? sanitizeValue(params.newValue) as Record<string, unknown> : null,
      metadata:        Object.keys(metadata).length > 0 ? sanitizeValue(metadata) as Record<string, unknown> : null,
    });
  } catch {
    // Audit logging is intentionally best-effort and must never break a business action.
  }
}
