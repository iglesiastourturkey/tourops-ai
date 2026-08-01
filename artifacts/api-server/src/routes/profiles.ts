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

// GET /api/profiles — admin only; for user management
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const profiles = await db.select().from(profilesTable);
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: "Failed to list profiles" });
  }
});

export default router;
