import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { and, eq, like } from "drizzle-orm";
import { requireAuth, requireActive } from "../lib/auth";
import { getPermissionsForProfile } from "../lib/permissions";
import { createAuditLog } from "../lib/audit";

const router = Router();

// POST /api/profiles/me/complete-invitation
// Claims exactly one pending profile after Clerk has activated the newly-created
// session. This deliberately does not create a fallback profile: a signup from
// an invitation must retain the role the super admin assigned.
router.post("/me/complete-invitation", requireAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Kimlik doğrulama gerekli" });
      return;
    }

    const user = await clerkClient.users.getUser(userId);
    const email = user.emailAddresses.find(
      address => address.id === user.primaryEmailAddressId,
    )?.emailAddress?.trim().toLowerCase();

    if (!email) {
      res.status(409).json({ error: "Davet e-posta adresi doğrulanamadı" });
      return;
    }

    // Idempotent completion for a previously claimed invitation. Do not rebind
    // another active profile, even when it has the same email address.
    const [existing] = await db.select()
      .from(profilesTable)
      .where(eq(profilesTable.clerkUserId, userId))
      .limit(1);
    if (existing) {
      res.json({ id: existing.id, role: existing.role, isActive: existing.isActive, alreadyCompleted: true });
      return;
    }

    const [claimed] = await db.update(profilesTable)
      .set({
        clerkUserId: userId,
        email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null,
      })
      .where(and(
        eq(profilesTable.clerkUserId, `pending-${email}`),
        eq(profilesTable.email, email),
        like(profilesTable.clerkUserId, "pending-%"),
      ))
      .returning();

    if (!claimed) {
      req.log.warn({ eventType: "invitation_completion_failed", reason: "pending_profile_not_found" }, "Invitation profile completion rejected");
      res.status(404).json({ error: "Geçerli bir bekleyen davet bulunamadı" });
      return;
    }

    await createAuditLog({
      eventType: "invitation_accepted",
      targetProfileId: claimed.id,
      module: "users",
      entityType: "invitation",
      entityId: claimed.id,
      result: "success",
      description: "Kullanıcı daveti kabul edildi",
    });

    res.json({ id: claimed.id, role: claimed.role, isActive: claimed.isActive, alreadyCompleted: false });
  } catch {
    req.log.error({ eventType: "invitation_completion_failed", reason: "unexpected_error" }, "Invitation profile completion failed");
    res.status(500).json({ error: "Davet tamamlanamadı. Lütfen tekrar deneyin." });
  }
});

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
//
// This endpoint intentionally accepts no password or "new password" value.
// Client-side validation is not proof that a credential changed: a caller
// could submit the temporary password again.  Instead it proves that Clerk
// currently rejects the original temporary credential, which is the
// credential-change signal available from the installed Clerk SDK.
router.post("/me/clear-password-change", requireAuth, requireActive(), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const user = await clerkClient.users.getUser(userId!);
    const mustChangePassword = user.publicMetadata?.mustChangePassword === true;

    if (!mustChangePassword) {
      res.status(409).json({ error: "Şifre değişikliği gerekmiyor" });
      return;
    }

    const forceChangeNonce = user.privateMetadata?.mustChangePasswordNonce;
    if (typeof forceChangeNonce !== "string" || !forceChangeNonce) {
      res.status(409).json({
        error: "Geçici şifre durumu doğrulanamadı. Yönetici yeni bir geçici şifre oluşturmalıdır.",
      });
      return;
    }

    const originalTemporaryPassword = req.get("x-tourpilot-force-change-proof");
    if (!originalTemporaryPassword || originalTemporaryPassword.length > 512) {
      res.status(400).json({ error: "Geçici şifre doğrulaması gerekli" });
      return;
    }

    try {
      await clerkClient.users.verifyPassword({
        userId: userId!,
        password: originalTemporaryPassword,
      });
    } catch {
      // Clerk rejecting the original temporary password is the authoritative
      // proof that a new credential replaced it.  Do not reveal whether the
      // supplied value was correct and never log or persist this header.
      await clerkClient.users.updateUserMetadata(userId!, {
        publicMetadata: { mustChangePassword: false },
        privateMetadata: { mustChangePasswordNonce: null },
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true });
      return;
    }

    // The original temporary credential still works.  Keep the account gated.
    // A successful verifyPassword response can only occur when it matched.
    if (forceChangeNonce) {
      res.status(409).json({
        error: "Yeni şifre geçici şifre ile aynı olamaz.",
      });
      return;
    }
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
