/**
 * /api/audit — audit log viewer (super_admin only)
 *
 * GET /audit?limit=50&offset=0&eventType=...&actorProfileId=...
 */

import { Router } from "express";
import { requireAuth, requirePermission } from "../lib/auth";
import { db } from "@workspace/db";
import { auditLogsTable, profilesTable } from "@workspace/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";

const router = Router();

router.use(requireAuth, requirePermission("system_control", "view"));

router.get("/", async (req, res) => {
  const limit      = Math.min(Number(req.query["limit"])  || 50,  200);
  const offset     =          Number(req.query["offset"]) || 0;
  const eventType  = req.query["eventType"]     as string | undefined;
  const actorId    = req.query["actorProfileId"]  ? Number(req.query["actorProfileId"]) : undefined;

  const where = and(
    eventType ? eq(auditLogsTable.eventType, eventType)          : undefined,
    actorId   ? eq(auditLogsTable.actorProfileId, actorId)       : undefined,
  );

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        log:   auditLogsTable,
        actor: { id: profilesTable.id, name: profilesTable.name, email: profilesTable.email },
      })
      .from(auditLogsTable)
      .leftJoin(profilesTable, eq(auditLogsTable.actorProfileId, profilesTable.id))
      .where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(auditLogsTable).where(where),
  ]);

  res.json({ logs: rows, total: count, limit, offset });
});

export default router;
