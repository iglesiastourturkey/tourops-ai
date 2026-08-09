import { pgTable, text, serial, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

/**
 * push_subscriptions — one row per browser/device that opted into Web Push.
 *
 * userId is the Clerk user id and references profiles.clerk_user_id (unique),
 * matching how notifications.user_id already identifies a recipient. Rows are
 * removed on sign-out and whenever the push service reports the endpoint as
 * gone (404/410) — see lib/notifications.ts.
 *
 * endpoint is unique on its own: the push service issues one endpoint per
 * browser subscription, so re-subscribing the same browser must update the
 * existing row rather than accumulate duplicates.
 */
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => profilesTable.clerkUserId, { onDelete: "cascade" }),
  endpoint:  text("endpoint").notNull(),
  /** { p256dh: string; auth: string } — from PushSubscription.toJSON().keys */
  keys:      jsonb("keys").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  unique("push_subscriptions_endpoint").on(t.endpoint),
]);

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptionsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscriptionRow = typeof pushSubscriptionsTable.$inferSelect;

/** Shape stored in the `keys` jsonb column. */
export interface PushSubscriptionKeys {
  p256dh: string;
  auth:   string;
}
