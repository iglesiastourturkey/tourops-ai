import { type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}


export async function getOrCreateProfile(clerkUserId: string, email: string, name?: string) {
  const existing = await db.select().from(profilesTable).where(eq(profilesTable.clerkUserId, clerkUserId)).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(profilesTable).values({
    clerkUserId,
    email,
    name: name ?? null,
    role: "staff",
  }).returning();
  return created;
}

export function getUserId(req: Request): string {
  const { userId } = getAuth(req);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}
