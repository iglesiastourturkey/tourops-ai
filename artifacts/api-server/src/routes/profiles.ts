import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireActive, requireRole, getOrCreateProfile } from "../lib/auth";

const router = Router();

// GET /api/profiles/me
router.get("/me", requireAuth, requireActive(), async (req, res) => {
  try {
    const { userId, sessionClaims } = getAuth(req);
    const email = (sessionClaims?.email as string) ?? "";
    const name = (sessionClaims?.name as string) ?? undefined;
    const profile = await getOrCreateProfile(userId!, email, name);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// PATCH /api/profiles/me — only name is allowed; role/isActive changes go through /api/users (admin only)
router.patch("/me", requireAuth, requireActive(), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    // Whitelist: only allow updating display name
    const { name } = req.body;
    const [updated] = await db.update(profilesTable)
      .set({ name })
      .where(eq(profilesTable.clerkUserId, userId!))
      .returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// GET /api/profiles — admin: all profiles; operations: guide profiles only (for guide assignment)
router.get("/", requireAuth, async (req, res) => {
  try {
    const profile = res.locals.profile;
    const callerRole = profile?.role as string | undefined;

    // Only admin, super_admin and operations roles may list profiles
    if (callerRole !== "admin" && callerRole !== "super_admin" && callerRole !== "operations") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Optional ?role= filter (e.g. role=guide). Operations staff always get only guides.
    const roleFilter = (req.query as Record<string, string>).role;
    const effectiveRoleFilter = callerRole === "operations" ? "guide" : roleFilter;

    let profiles;
    if (effectiveRoleFilter) {
      profiles = await db.select().from(profilesTable).where(eq(profilesTable.role, effectiveRoleFilter as "admin" | "operations" | "guide" | "accounting"));
    } else {
      profiles = await db.select().from(profilesTable);
    }
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: "Failed to list profiles" });
  }
});

export default router;
