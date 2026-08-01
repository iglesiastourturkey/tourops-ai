import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, or, isNull, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { unreadOnly } = req.query as Record<string, string>;
    let rows = await db.select().from(notificationsTable)
      .where(or(eq(notificationsTable.userId, userId!), isNull(notificationsTable.userId)))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(100);
    if (unreadOnly === "true") rows = rows.filter(r => !r.isRead);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list notifications" }); }
});

router.patch("/:id/read", async (req, res) => {
  try {
    const [row] = await db.update(notificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notificationsTable.id, parseInt(req.params.id)))
      .returning();
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to mark read" }); }
});

router.patch("/read-all", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    await db.update(notificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(or(eq(notificationsTable.userId, userId!), isNull(notificationsTable.userId)));
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed to mark all read" }); }
});

export default router;
