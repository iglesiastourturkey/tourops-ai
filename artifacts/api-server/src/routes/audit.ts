/**
 * /api/audit — MVP audit log viewer (super_admin only).
 *
 * This endpoint deliberately reuses the existing audit_logs table and keeps
 * the API read-only. Audit records are immutable from the UI.
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../lib/auth";
import { db } from "@workspace/db";
import { auditLogsTable, profilesTable } from "@workspace/db/schema";
import { desc, eq, and, gte, lte, sql } from "drizzle-orm";

const router = Router();

// Unlike other system-control views, audit records are super_admin-only.
router.use(requireAuth, requireRole("super_admin"));

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query["limit"]) || 50, 1), 200);
    const offset = Math.max(Number(req.query["offset"]) || 0, 0);
    const eventType = req.query["eventType"] as string | undefined;
    const actorId = req.query["actorProfileId"] ? Number(req.query["actorProfileId"]) : undefined;
    const from = req.query["from"] as string | undefined;
    const to = req.query["to"] as string | undefined;
    const search = req.query["search"] as string | undefined;
    const result = req.query["result"] as string | undefined;
    const moduleName = req.query["module"] as string | undefined;

    const where = and(
      eventType ? eq(auditLogsTable.eventType, eventType) : undefined,
      actorId ? eq(auditLogsTable.actorProfileId, actorId) : undefined,
      from ? gte(auditLogsTable.createdAt, new Date(`${from}T00:00:00.000Z`)) : undefined,
      to ? lte(auditLogsTable.createdAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
      result ? sql`${auditLogsTable.metadata}->>'result' = ${result}` : undefined,
      moduleName ? sql`${auditLogsTable.metadata}->>'module' = ${moduleName}` : undefined,
      search ? sql`(
        CAST(${auditLogsTable.eventType} AS TEXT) ILIKE ${`%${search}%`}
        OR CAST(${auditLogsTable.metadata} AS TEXT) ILIKE ${`%${search}%`}
        OR CAST(${auditLogsTable.oldValue} AS TEXT) ILIKE ${`%${search}%`}
        OR CAST(${auditLogsTable.newValue} AS TEXT) ILIKE ${`%${search}%`}
      )` : undefined,
    );

    const [rows, [{ count }], [{ totalEvents }], [{ errorCount }], [{ activeUsers }], [{ todayEvents }], [{ criticalChanges }]] =
      await Promise.all([
        db
          .select({
            log: auditLogsTable,
            actor: { id: profilesTable.id, name: profilesTable.name, email: profilesTable.email, role: profilesTable.role },
          })
          .from(auditLogsTable)
          .leftJoin(profilesTable, eq(auditLogsTable.actorProfileId, profilesTable.id))
          .where(where)
          .orderBy(desc(auditLogsTable.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ count: sql<number>`COUNT(*)::int` }).from(auditLogsTable).where(where),
        db.select({ totalEvents: sql<number>`COUNT(*)::int` }).from(auditLogsTable).where(where),
        db.select({ errorCount: sql<number>`COUNT(*)::int` })
          .from(auditLogsTable)
          .where(and(where, sql`${auditLogsTable.metadata}->>'result' IN ('failure', 'denied')`)),
        db.select({ activeUsers: sql<number>`COUNT(DISTINCT ${auditLogsTable.actorProfileId})::int` })
          .from(auditLogsTable)
          .where(where),
        db.select({ todayEvents: sql<number>`COUNT(*)::int` })
          .from(auditLogsTable)
          .where(and(where, gte(auditLogsTable.createdAt, sql`CURRENT_DATE`))),
        db.select({ criticalChanges: sql<number>`COUNT(*)::int` })
          .from(auditLogsTable)
          .where(and(
            where,
            sql`${auditLogsTable.eventType} IN ('role_changed', 'permission_changed', 'system_mode_changed')`,
          )),
      ]);

    res.json({
      logs: rows,
      total: count,
      limit,
      offset,
      summary: { totalEvents, errorCount, activeUsers, todayEvents, criticalChanges },
    });
  } catch {
    res.status(500).json({ error: "Denetim kayıtları yüklenemedi" });
  }
});

export default router;