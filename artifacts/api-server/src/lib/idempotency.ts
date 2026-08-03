import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { idempotencyRecordsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

export function getIdempotencyKey(req: Request): string | null {
  const value = req.get("Idempotency-Key")?.trim();
  return value ? value.slice(0, 200) : null;
}

export async function replayIdempotentResponse(
  req: Request,
  res: Response,
): Promise<boolean> {
  const key = getIdempotencyKey(req);
  const userId = res.locals.profile?.clerkUserId;
  if (!key || !userId) return false;

  const [record] = await db
    .select()
    .from(idempotencyRecordsTable)
    .where(and(eq(idempotencyRecordsTable.key, key), eq(idempotencyRecordsTable.userId, userId)))
    .limit(1);
  if (!record) return false;

  res.status(record.statusCode).json(record.responseBody);
  return true;
}

export async function rememberIdempotentResponse(
  req: Request,
  res: Response,
  payload: unknown,
  statusCode: number,
  operationId?: number | null,
): Promise<void> {
  const key = getIdempotencyKey(req);
  const userId = res.locals.profile?.clerkUserId;
  if (!key || !userId) return;

  await db.insert(idempotencyRecordsTable).values({
    key,
    userId,
    operationId: operationId ?? null,
    method: req.method,
    url: req.originalUrl,
    statusCode,
    responseBody: payload,
  }).onConflictDoNothing();
}