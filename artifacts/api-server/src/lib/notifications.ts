/**
 * notifications.ts — single place where an in-app notification is created and,
 * when the recipient has opted in, delivered as a Web Push message.
 *
 * Design rules:
 *  - Notifications are best-effort. This module never throws and never fails
 *    the business operation that triggered it; the DB row is what matters, push
 *    is an extra.
 *  - The DB row is written first. A push failure never rolls it back, so the
 *    notification is still there when the user opens the app.
 *  - A subscription the push service reports as gone (404/410) is deleted
 *    silently — browsers rotate endpoints and stale rows are expected.
 *
 * VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. When they are not
 * configured the module degrades to "DB row only" and logs once, so local dev
 * and any environment without keys keeps working exactly as before.
 */

import webpush from "web-push";
import { db } from "@workspace/db";
import {
  notificationsTable,
  pushSubscriptionsTable,
  profilesTable,
  type PushSubscriptionKeys,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

// ── VAPID configuration ───────────────────────────────────────────────────────

const VAPID_PUBLIC_KEY = process.env["VAPID_PUBLIC_KEY"] ?? "";
const VAPID_PRIVATE_KEY = process.env["VAPID_PRIVATE_KEY"] ?? "";
// Push services require a contact for the key owner; mailto: is the usual form.
const VAPID_SUBJECT = process.env["VAPID_SUBJECT"] ?? "mailto:info@iglesiastour.com";

let pushConfigured = false;
try {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushConfigured = true;
  } else {
    logger.info(
      { eventType: "push_not_configured" },
      "VAPID keys absent — notifications will be stored without Web Push delivery",
    );
  }
} catch (err) {
  // A malformed key must not take the server down; fall back to DB-only.
  logger.error({ err, eventType: "push_config_failed" }, "Invalid VAPID configuration — Web Push disabled");
}

/** True when VAPID keys are present and valid. Exposed for the /vapid-public-key route. */
export function isPushConfigured(): boolean {
  return pushConfigured;
}

/** The public key the browser needs to create a subscription, or null. */
export function getVapidPublicKey(): string | null {
  return pushConfigured ? VAPID_PUBLIC_KEY : null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationType =
  | "quotation" | "operation" | "receipt" | "document" | "payment" | "system";

export interface CreateNotificationParams {
  /** Clerk user id of the recipient. Null/omitted writes a broadcast row (userId null). */
  userId?:      string | null;
  /** Convenience: resolve the Clerk id from a profiles.id. Ignored when userId is given. */
  profileId?:   number | null;
  type:         string;
  title:        string;
  message:      string;
  relatedId?:   number | undefined;
  relatedType?: string | undefined;
  /** Path the service worker opens when the push notification is clicked. */
  url?:         string | undefined;
}

// ── Push delivery ─────────────────────────────────────────────────────────────

/**
 * Sends one push per stored subscription for this user and prunes dead ones.
 * Never throws.
 */
async function deliverPush(userId: string, params: CreateNotificationParams): Promise<void> {
  if (!pushConfigured) return;

  let subscriptions;
  try {
    subscriptions = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, userId));
  } catch (err) {
    logger.warn({ err, eventType: "push_subscription_lookup_failed" }, "Could not load push subscriptions");
    return;
  }
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title:       params.title,
    body:        params.message,
    type:        params.type,
    relatedId:   params.relatedId ?? null,
    relatedType: params.relatedType ?? null,
    url:         params.url ?? "/notifications",
  });

  const staleIds: number[] = [];

  await Promise.all(subscriptions.map(async sub => {
    const keys = sub.keys as PushSubscriptionKeys | null;
    if (!keys?.p256dh || !keys?.auth) {
      // Row cannot produce a valid push target — treat as stale.
      staleIds.push(sub.id);
      return;
    }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
        payload,
        { TTL: 60 * 60 * 24 },
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      // 404 Not Found / 410 Gone — the browser dropped this subscription.
      if (statusCode === 404 || statusCode === 410) {
        staleIds.push(sub.id);
        return;
      }
      // 403 is deliberately NOT pruned. It means the push service rejected our
      // VAPID credentials, which is far more often a server misconfiguration
      // (wrong key pair or subject) than a dead subscription — pruning on it
      // would wipe every valid subscription the moment the keys are wrong.
      // After a genuine key rotation these endpoints turn into 404/410 on their
      // own and are cleaned up then; until that happens they only cost a log
      // line each.
      logger.warn(
        { eventType: "push_send_failed", statusCode, subscriptionId: sub.id },
        "Web Push delivery failed",
      );
    }
  }));

  if (staleIds.length > 0) {
    try {
      await db.delete(pushSubscriptionsTable).where(inArray(pushSubscriptionsTable.id, staleIds));
      logger.info(
        { eventType: "push_subscriptions_pruned", count: staleIds.length },
        "Removed expired push subscriptions",
      );
    } catch (err) {
      logger.warn({ err, eventType: "push_prune_failed" }, "Could not prune expired push subscriptions");
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Writes the notification row and fires a Web Push message to the recipient's
 * subscribed devices. Best-effort: any failure is logged and swallowed.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    let userId = params.userId ?? null;

    // The notifications table keys on the Clerk id; callers holding a profiles.id
    // (field.ts does) get it resolved here instead of duplicating the lookup.
    if (!userId && params.profileId) {
      const [profile] = await db
        .select({ clerkUserId: profilesTable.clerkUserId })
        .from(profilesTable)
        .where(eq(profilesTable.id, params.profileId))
        .limit(1);
      if (!profile?.clerkUserId) return;
      userId = profile.clerkUserId;
    }

    await db.insert(notificationsTable).values({
      userId,
      type:        params.type as NotificationType,
      title:       params.title,
      message:     params.message,
      isRead:      false,
      relatedId:   params.relatedId,
      relatedType: params.relatedType,
    });

    // Broadcast rows (userId null) have no push target — in-app only.
    if (userId) await deliverPush(userId, params);
  } catch (err) {
    logger.warn({ err, eventType: "notification_create_failed" }, "Notification could not be created");
  }
}
