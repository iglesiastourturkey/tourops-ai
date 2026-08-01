import { type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { UserRole } from "@workspace/db/schema";

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
    role: "guide",
  }).returning();
  return created;
}

export function getUserId(req: Request): string {
  const { userId } = getAuth(req);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/**
 * Loads the profile for the authenticated user and attaches it to res.locals.profile.
 * Must be called after requireAuth.
 */
export async function getProfile(req: Request, res: Response, next: NextFunction) {
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const email = (sessionClaims?.email as string) ?? "";
    const name = (sessionClaims?.name as string) ?? undefined;
    const profile = await getOrCreateProfile(userId, email, name);
    res.locals.profile = profile;
    next();
  } catch {
    res.status(500).json({ error: "Failed to load profile" });
  }
}

/**
 * Middleware: requires the user to have one of the specified roles AND be active.
 * Must be used after requireAuth.
 */
export function requireRole(...roles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { userId, sessionClaims } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const email = (sessionClaims?.email as string) ?? "";
      const name = (sessionClaims?.name as string) ?? undefined;
      const profile = await getOrCreateProfile(userId, email, name);
      res.locals.profile = profile;
      if (!profile.isActive) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      if (!roles.includes(profile.role as UserRole)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: "Failed to load profile" });
    }
  };
}

/** Alias of requireRole for readability. */
export const requireAnyRole = requireRole;

/**
 * Middleware: rejects deactivated users with 403. Does not check role.
 * Must be used after requireAuth.
 */
export function requireActive() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { userId, sessionClaims } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const email = (sessionClaims?.email as string) ?? "";
      const name = (sessionClaims?.name as string) ?? undefined;
      const profile = await getOrCreateProfile(userId, email, name);
      res.locals.profile = profile;
      if (!profile.isActive) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: "Failed to load profile" });
    }
  };
}
