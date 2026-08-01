import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { profilesTable, VALID_ROLES } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";

const router = Router();

// GET /api/users — admin only; returns list of all profiles
router.get("/users", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const profiles = await db.select({
      id: profilesTable.id,
      clerkUserId: profilesTable.clerkUserId,
      email: profilesTable.email,
      name: profilesTable.name,
      role: profilesTable.role,
      isActive: profilesTable.isActive,
      createdAt: profilesTable.createdAt,
    }).from(profilesTable).orderBy(profilesTable.createdAt);
    res.json(profiles);
  } catch {
    res.status(500).json({ error: "Failed to list users" });
  }
});

// PATCH /api/users/:clerkUserId — admin only; update role and/or isActive
router.patch("/users/:clerkUserId", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { userId: callerUserId } = getAuth(req);
    const clerkUserId = req.params.clerkUserId as string;
    const { role, isActive } = req.body;

    // Prevent admin from changing their own role
    if (role !== undefined && clerkUserId === callerUserId) {
      res.status(403).json({ error: "Cannot change your own role" });
      return;
    }

    // Validate role if provided
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (role !== undefined) updates.role = role;
    if (isActive !== undefined) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const [updated] = await db.update(profilesTable)
      .set(updates)
      .where(eq(profilesTable.clerkUserId, clerkUserId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update user" });
  }
});

export default router;
