import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { notificationsTable, pushSubscriptionsTable } from "@workspace/db/schema";
import { eq, or, isNull, desc, and } from "drizzle-orm";
import { requireAuth, requireActive, requirePermission } from "../lib/auth";
import { getVapidPublicKey } from "../lib/notifications";

const router = Router();
router.use(requireAuth);
router.use(requireActive());

// ── Web Push subscription management ─────────────────────────────────────────
// Every signed-in user may manage their own device subscriptions, so these are
// gated on authentication only — not on notifications.view, which controls the
// notification centre. A user who cannot see the centre can still be pushed to.

// GET /api/notifications/push/public-key
// Returns the VAPID public key the browser needs to build a subscription, or
// configured:false when the server has no keys (push simply stays unavailable).
router.get("/push/public-key", (_req, res) => {
  const publicKey = getVapidPublicKey();
  res.json(publicKey ? { configured: true, publicKey } : { configured: false, publicKey: null });
});

// POST /api/notifications/push/subscribe
// Body: { endpoint: string, keys: { p256dh: string, auth: string } }
//
// Idempotent by contract: a browser that is already subscribed may POST the
// same endpoint any number of times and always gets 200. The frontend relies on
// this to reconcile its state — re-sending an existing subscription is how it
// repairs a row that was lost (or never written) after an earlier failure, so
// this must never answer with an error for "already subscribed".
router.post("/push/subscribe", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { endpoint, keys } = req.body as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };

    if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || endpoint.length > 2048) {
      res.status(400).json({ error: "Geçersiz abonelik adresi" });
      return;
    }
    if (typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") {
      res.status(400).json({ error: "Geçersiz abonelik anahtarları" });
      return;
    }

    const userAgent = req.get("user-agent")?.slice(0, 255) ?? null;

    const [existing] = await db
      .select({ id: pushSubscriptionsTable.id })
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, endpoint))
      .limit(1);

    await db
      .insert(pushSubscriptionsTable)
      .values({ userId: userId!, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, userAgent })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          userId:    userId!,
          keys:      { p256dh: keys.p256dh, auth: keys.auth },
          userAgent,
          updatedAt: new Date(),
        },
      });

    res.json({ ok: true, alreadySubscribed: !!existing });
  } catch (err) {
    // 42P01 = undefined_table. Without this the caller only ever sees a generic
    // 500 and the operator has no way to tell a real fault from "the
    // push_subscriptions migration has not been applied to this database yet".
    if ((err as { code?: string }).code === "42P01") {
      req.log.error(
        { eventType: "push_subscribe_failed", reason: "table_missing" },
        "push_subscriptions table is missing — migration 0006 has not been applied",
      );
      res.status(503).json({
        error: "Bildirim altyapısı bu sunucuda henüz hazır değil. Yönetici ile iletişime geçin.",
      });
      return;
    }
    req.log.error({ err, eventType: "push_subscribe_failed" }, "Push subscription could not be stored");
    res.status(500).json({ error: "Bildirim aboneliği kaydedilemedi" });
  }
});

// DELETE /api/notifications/push/subscribe
// Body: { endpoint: string }. Scoped to the caller so one user cannot delete
// another user's subscription by guessing an endpoint.
router.delete("/push/subscribe", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { endpoint } = req.body as { endpoint?: unknown };
    if (typeof endpoint !== "string") {
      res.status(400).json({ error: "Geçersiz abonelik adresi" });
      return;
    }

    // Deleting a row that is not there is a success: the caller's goal is
    // "this browser is not subscribed", which already holds.
    await db.delete(pushSubscriptionsTable).where(
      and(
        eq(pushSubscriptionsTable.endpoint, endpoint),
        eq(pushSubscriptionsTable.userId, userId!),
      ),
    );

    res.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") {
      // Nothing is stored, so there is nothing to remove — report success
      // rather than blocking the user from turning notifications off.
      res.json({ ok: true });
      return;
    }
    req.log.error({ err, eventType: "push_unsubscribe_failed" }, "Push subscription could not be removed");
    res.status(500).json({ error: "Bildirim aboneliği kaldırılamadı" });
  }
});

router.get("/", requirePermission("notifications", "view"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { unreadOnly } = req.query as Record<string, string>;
    let rows = await db.select().from(notificationsTable)
      .where(or(eq(notificationsTable.userId, userId!), isNull(notificationsTable.userId)))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(100);
    if (unreadOnly === "true") rows = rows.filter(r => !r.isRead);
    res.json(rows);
  } catch (err) {
    req.log.error({ err, eventType: "notifications_list_failed" }, "Failed to list notifications");
    res.status(500).json({ error: "Failed to list notifications" });
  }
});

router.patch("/:id/read", requirePermission("notifications", "view"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const notifId = parseInt(req.params.id as string);
    // Scope to the caller's notification or a global (null userId) notification
    const [row] = await db.update(notificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notificationsTable.id, notifId), or(eq(notificationsTable.userId, userId!), isNull(notificationsTable.userId))))
      .returning();
    if (!row) { res.status(404).json({ error: "Notification not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err, eventType: "notification_read_failed" }, "Failed to mark read");
    res.status(500).json({ error: "Failed to mark read" });
  }
});

router.patch("/read-all", requirePermission("notifications", "view"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    await db.update(notificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(or(eq(notificationsTable.userId, userId!), isNull(notificationsTable.userId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err, eventType: "notifications_read_all_failed" }, "Failed to mark all read");
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

export default router;
