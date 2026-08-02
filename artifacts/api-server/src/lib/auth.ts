import { type Request, type Response, type NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq, and, like } from "drizzle-orm";
import type { UserRole } from "@workspace/db/schema";

// ── Express locals augmentation ───────────────────────────────────────────────
// Makes res.locals.profile properly typed across all route handlers.
declare global {
  namespace Express {
    interface Locals {
      // Non-optional: every guarded route runs requireRole/getProfile first,
      // guaranteeing this is always set before the handler body executes.
      profile: {
        id: number;
        clerkUserId: string;
        name: string | null;
        email: string | null;
        role: string;
        isActive: boolean;
      };
    }
  }
}

/** Roles that must never be auto-downgraded to "guide" by profile sync. */
const PROTECTED_ROLES: UserRole[] = ["super_admin", "admin"];

/**
 * Fetches the user's primary email + full name from Clerk.
 * Returns empty strings/null if the user cannot be found.
 */
async function fetchClerkUserData(clerkUserId: string) {
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    const primaryEmail =
      user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)
        ?.emailAddress ?? "";
    const fullName =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null;
    const lastSignInAt = user.lastSignInAt ?? null;
    return { email: primaryEmail, name: fullName, lastSignInAt };
  } catch {
    return { email: "", name: null, lastSignInAt: null };
  }
}

/**
 * Creates or retrieves the profile for the authenticated user.
 *
 * Priority:
 *   1. Match by clerkUserId (fast path). If name/email are missing, back-fills
 *      from Clerk without touching the role.
 *   2. Match a pre-created invite stub (clerkUserId = "pending-<email>").
 *      The stub carries the admin-assigned role.
 *   3. Brand-new user — defaults to "guide".
 *
 * NEVER overwrites admin-assigned roles (admin / super_admin) with "guide".
 */
export async function getOrCreateProfile(
  clerkUserId: string,
  emailFromClaims: string,
  nameFromClaims?: string,
) {
  // ── 1. Fast path: profile already exists ─────────────────────────────
  const [existing] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.clerkUserId, clerkUserId))
    .limit(1);

  if (existing) {
    // Lazily back-fill missing name / email from Clerk (one-time, cheap)
    if (!existing.email || !existing.name) {
      const clerkData = await fetchClerkUserData(clerkUserId);
      const updates: Partial<{ email: string; name: string | null }> = {};
      if (!existing.email && clerkData.email) updates.email = clerkData.email;
      if (!existing.name && clerkData.name) updates.name = clerkData.name;

      if (Object.keys(updates).length > 0) {
        const [updated] = await db
          .update(profilesTable)
          .set(updates)
          .where(eq(profilesTable.id, existing.id))
          .returning();
        return updated;
      }
    }
    return existing;
  }

  // ── New user: resolve accurate email from Clerk if JWT claims are empty ─
  let email = emailFromClaims ?? "";
  let name = nameFromClaims ?? null;

  if (!email) {
    const clerkData = await fetchClerkUserData(clerkUserId);
    email = clerkData.email;
    if (!name) name = clerkData.name;
  }

  // ── 2. Check for an admin-pre-created invite stub ────────────────────
  if (email) {
    const [pending] = await db
      .select()
      .from(profilesTable)
      .where(
        and(
          eq(profilesTable.email, email.trim().toLowerCase()),
          like(profilesTable.clerkUserId, "pending-%"),
        ),
      )
      .limit(1);

    if (pending) {
      // Claim the stub: swap sentinel clerkUserId for the real one.
      // Role stays as the super-admin assigned it.
      const [claimed] = await db
        .update(profilesTable)
        .set({
          clerkUserId,
          email: email.trim().toLowerCase(),
          name: name ?? pending.name,
        })
        .where(eq(profilesTable.id, pending.id))
        .returning();
      return claimed;
    }
  }

  // ── 3. Brand-new user — default to least-privilege "guide" ───────────
  const [created] = await db
    .insert(profilesTable)
    .values({
      clerkUserId,
      email: email.trim().toLowerCase(),
      name,
      role: "guide",
    })
    .returning();
  return created;
}

export function getUserId(req: Request): string {
  const { userId } = getAuth(req);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Loads the profile for the authenticated user and attaches it to
 * res.locals.profile. Must be called after requireAuth.
 */
export async function getProfile(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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
      // super_admin has all permissions — it supersedes every role check
      const passes =
        profile.role === "super_admin" ||
        roles.includes(profile.role as UserRole);
      if (!passes) {
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

// Keep PROTECTED_ROLES in scope for any future use
export { PROTECTED_ROLES };
