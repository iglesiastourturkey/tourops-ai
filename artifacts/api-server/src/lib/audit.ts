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

// Any object exposing the same select/insert query builder as `db` - in
// practice either `db` itself or the `tx` handed to a `db.transaction(...)`
// callback. Lets a caller that already holds an open transaction (e.g.
// historical-migration promotion, which must write its audit row atomically
// with the operation it describes) pass `tx` straight through instead of
// createAuditLog silently opening a second, unrelated connection.
type AuditExecutor = Pick<typeof db, "select" | "insert">;

export async function createAuditLog(params: CreateAuditLogParams, executor: AuditExecutor = db): Promise<void> {
  // Every pre-existing caller passes no executor and keeps the original
  // best-effort contract (audit logging must never break a business action).
  // A caller that explicitly hands in its own open transaction is opting
  // into strict mode: the audit row is part of what that transaction is
  // atomic over, so a failure here must propagate and roll the whole
  // transaction back rather than be silently swallowed - see
  // historical-migration-promote.ts, where a promoted operation must never
  // commit without the audit row that describes it.
  const strict = executor !== db;
  try {
    const actor = params.actorProfileId
      ? (await executor
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

    await executor.insert(auditLogsTable).values({
      eventType:       params.eventType,
      actorProfileId:  params.actorProfileId  ?? null,
      targetProfileId: params.targetProfileId ?? null,
      oldValue:        params.oldValue  != null ? sanitizeValue(params.oldValue) as Record<string, unknown> : null,
      newValue:        params.newValue  != null ? sanitizeValue(params.newValue) as Record<string, unknown> : null,
      metadata:        Object.keys(metadata).length > 0 ? sanitizeValue(metadata) as Record<string, unknown> : null,
    });
  } catch (error) {
    if (strict) throw error;
    // Audit logging is intentionally best-effort and must never break a business action.
  }
}
