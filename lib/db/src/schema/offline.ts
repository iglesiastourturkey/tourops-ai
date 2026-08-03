import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Stores the result of an accepted mutation so an offline replay with the
 * same Idempotency-Key can return the original result without applying it
 * twice.
 */
export const idempotencyRecordsTable = pgTable("idempotency_records", {
  key: text("key").primaryKey(),
  userId: text("user_id").notNull(),
  operationId: integer("operation_id"),
  method: text("method").notNull(),
  url: text("url").notNull(),
  statusCode: integer("status_code").notNull(),
  responseBody: jsonb("response_body").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IdempotencyRecord = typeof idempotencyRecordsTable.$inferSelect;