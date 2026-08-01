import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, getOrCreateProfile } from "../lib/auth";

const router = Router();

// GET /api/profiles/me
router.get("/me", requireAuth, async (req, res) => {
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

// PATCH /api/profiles/me
router.patch("/me", requireAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { name, role } = req.body;
    const [updated] = await db.update(profilesTable)
      .set({ name, role })
      .where(eq(profilesTable.clerkUserId, userId!))
      .returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// GET /api/profiles
router.get("/", requireAuth, async (req, res) => {
  try {
    const profiles = await db.select().from(profilesTable);
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: "Failed to list profiles" });
  }
});

export default router;
