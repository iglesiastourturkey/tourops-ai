import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireActive } from "../lib/auth";
import { getPermissionsForProfile } from "../lib/permissions";

const router = Router();

// GET /api/profiles/me
router.get("/me", requireAuth, requireActive(), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const profile = res.locals.profile;

    // Include mustChangePassword from Clerk's publicMetadata so the frontend
    // can enforce a forced-change flow on first login after a temp password.
    // A timeout/error must not be treated as "no forced password change".
    // Otherwise a temporary-password user could enter the app while Clerk's
    // metadata service is unavailable.
    let mustChangePassword = false;
    try {
      const cu = await Promise.race([
        clerkClient.users.getUser(userId!),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 1_500)),
      ]);
      if (!cu) {
        res.status(503).json({ error: "Authentication state unavailable" });
        return;
      }
      mustChangePassword = (cu?.publicMetadata?.mustChangePassword as boolean) ?? false;
    } catch {
      res.status(503).json({ error: "Authentication state unavailable" });
      return;
    }

    res.json({ ...profile, mustChangePassword });
  } catch (err) {
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// POST /api/profiles/me/clear-password-change
// Called by the user themselves after successfully changing their temp password.
router.post("/me/clear-password-change", requireAuth, requireActive(), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    await clerkClient.users.updateUserMetadata(userId!, {
      publicMetadata: { mustChangePassword: false },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Şifre değişikliği durumu güncellenemedi" });
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

// GET /api/profiles/me/permissions — returns the caller's effective permission set
router.get("/me/permissions", requireAuth, requireActive(), async (req, res) => {
  try {
    const profile = res.locals.profile;

    if (profile.role === "super_admin") {
      res.json({ all: true, permissions: [] });
      return;
    }

    const perms = await getPermissionsForProfile(profile.id, profile.role);
    res.json({ all: false, permissions: Array.from(perms) });
  } catch {
    res.status(500).json({ error: "Failed to load permissions" });
  }
});

// GET /api/profiles — admin: all profiles; operations: guide profiles only (for guide assignment)
router.get("/", requireAuth, requireActive(), async (req, res) => {
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
