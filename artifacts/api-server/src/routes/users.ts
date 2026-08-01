import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { profilesTable, VALID_ROLES } from "@workspace/db/schema";
import { eq, and, not, like, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import type { UserRole } from "@workspace/db/schema";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch all non-pending profiles and enrich each one with live Clerk data. */
async function getEnrichedUsers() {
  const profiles = await db
    .select()
    .from(profilesTable)
    .where(not(like(profilesTable.clerkUserId, "pending-%")))
    .orderBy(profilesTable.createdAt);

  if (profiles.length === 0) return [];

  // Fetch matching Clerk users in one call
  const userIds = profiles.map(p => p.clerkUserId);
  let clerkUsers: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    emailAddresses: Array<{ id: string; emailAddress: string }>;
    primaryEmailAddressId: string | null;
    lastSignInAt: number | null;
    imageUrl: string;
  }> = [];

  try {
    const result = await clerkClient.users.getUserList({
      userId: userIds,
      limit: 100,
    });
    clerkUsers = result.data as typeof clerkUsers;
  } catch {
    /* use profile data as fallback */
  }

  const clerkMap = new Map(clerkUsers.map(u => [u.id, u]));

  return profiles.map(profile => {
    const cu = clerkMap.get(profile.clerkUserId);
    const clerkEmail =
      cu?.emailAddresses.find(e => e.id === cu.primaryEmailAddressId)
        ?.emailAddress ?? "";
    const clerkName =
      cu
        ? [cu.firstName, cu.lastName].filter(Boolean).join(" ").trim() || null
        : null;

    return {
      id: profile.id,
      clerkUserId: profile.clerkUserId,
      email: clerkEmail || profile.email || "",
      name: clerkName || profile.name || "",
      role: profile.role,
      isActive: profile.isActive,
      createdAt: profile.createdAt,
      lastSignInAt: cu?.lastSignInAt ?? null,
      imageUrl: cu?.imageUrl ?? null,
    };
  });
}

/** Count currently active super_admins (excludes invite stubs). */
async function countActiveSuperAdmins(): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(profilesTable)
    .where(
      and(
        eq(profilesTable.role, "super_admin"),
        eq(profilesTable.isActive, true),
        not(like(profilesTable.clerkUserId, "pending-%")),
      ),
    );
  return Number(count);
}

// ── GET /api/users ────────────────────────────────────────────────────────────
router.get(
  "/users",
  requireAuth,
  requireRole("super_admin"),
  async (_req, res) => {
    try {
      const users = await getEnrichedUsers();
      res.json(users);
    } catch {
      res.status(500).json({ error: "Kullanıcılar listelenemedi" });
    }
  },
);

// ── PATCH /api/users/:clerkUserId ─────────────────────────────────────────────
router.patch(
  "/users/:clerkUserId",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const { userId: callerUserId } = getAuth(req);
      const clerkUserId = req.params.clerkUserId as string;
      const { role, isActive } = req.body as {
        role?: string;
        isActive?: boolean;
      };

      if (role === undefined && isActive === undefined) {
        res.status(400).json({ error: "Güncellenecek alan yok" });
        return;
      }

      // Cannot touch own role or status
      if (role !== undefined && clerkUserId === callerUserId) {
        res.status(403).json({ error: "Kendi rolünüzü değiştiremezsiniz" });
        return;
      }
      if (isActive === false && clerkUserId === callerUserId) {
        res
          .status(403)
          .json({ error: "Kendi hesabınızı devre dışı bırakamazsınız" });
        return;
      }

      // Validate role value
      if (
        role !== undefined &&
        !(VALID_ROLES as readonly string[]).includes(role)
      ) {
        res.status(400).json({
          error: `Geçersiz rol. Kabul edilen: ${VALID_ROLES.join(", ")}`,
        });
        return;
      }

      // Fetch target
      const [target] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.clerkUserId, clerkUserId))
        .limit(1);
      if (!target) {
        res.status(404).json({ error: "Kullanıcı bulunamadı" });
        return;
      }

      // Last-active-super-admin protection
      if (target.role === "super_admin") {
        const superAdminCount = await countActiveSuperAdmins();
        if (isActive === false && superAdminCount <= 1) {
          res
            .status(403)
            .json({ error: "Son aktif süper yönetici devre dışı bırakılamaz" });
          return;
        }
        if (role !== undefined && role !== "super_admin" && superAdminCount <= 1) {
          res.status(403).json({
            error: "Son aktif süper yöneticinin rolü değiştirilemez",
          });
          return;
        }
      }

      const [updated] = await db
        .update(profilesTable)
        .set({
          ...(role !== undefined ? { role: role as UserRole } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        })
        .where(eq(profilesTable.clerkUserId, clerkUserId))
        .returning();

      res.json(updated);
    } catch {
      res.status(500).json({ error: "Kullanıcı güncellenemedi" });
    }
  },
);

// ── POST /api/users/invite ────────────────────────────────────────────────────
router.post(
  "/users/invite",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const { email, name, role } = req.body as {
        email?: string;
        name?: string;
        role?: string;
      };

      if (!email || typeof email !== "string" || !email.includes("@")) {
        res.status(400).json({ error: "Geçerli bir e-posta adresi giriniz" });
        return;
      }
      if (!role || !(VALID_ROLES as readonly string[]).includes(role)) {
        res.status(400).json({ error: "Geçerli bir rol seçiniz" });
        return;
      }

      const trimmedEmail = email.trim().toLowerCase();
      const trimmedName = name?.trim() || null;

      // Send Clerk invitation
      try {
        await clerkClient.invitations.createInvitation({
          emailAddress: trimmedEmail,
          publicMetadata: { pendingRole: role },
          ignoreExisting: true,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
        res.status(400).json({ error: `Davet gönderilemedi: ${msg}` });
        return;
      }

      // Pre-create profile stub so role is preserved on first sign-in
      await db
        .insert(profilesTable)
        .values({
          clerkUserId: `pending-${trimmedEmail}`,
          email: trimmedEmail,
          name: trimmedName,
          role: role as UserRole,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: profilesTable.clerkUserId,
          set: { role: role as UserRole, name: trimmedName, email: trimmedEmail },
        });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Davet gönderilemedi" });
    }
  },
);

// ── POST /api/users/:clerkUserId/revoke-sessions ──────────────────────────────
router.post(
  "/users/:clerkUserId/revoke-sessions",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const { userId: callerUserId } = getAuth(req);
      const clerkUserId = req.params.clerkUserId as string;

      if (clerkUserId === callerUserId) {
        res
          .status(403)
          .json({ error: "Kendi oturumlarınızı bu yolla sonlandıramazsınız" });
        return;
      }

      const sessions = await clerkClient.sessions.getSessionList({
        userId: clerkUserId,
        status: "active",
      });

      let revokedCount = 0;
      for (const session of sessions.data) {
        try {
          await clerkClient.sessions.revokeSession(session.id);
          revokedCount++;
        } catch {
          /* skip failed revocations */
        }
      }

      res.json({ ok: true, revokedCount });
    } catch {
      res.status(500).json({ error: "Oturumlar sonlandırılamadı" });
    }
  },
);

// ── POST /api/users/:clerkUserId/password-reset ───────────────────────────────
// Generates a 24-hour sign-in token and returns a magic link the admin can send.
router.post(
  "/users/:clerkUserId/password-reset",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const clerkUserId = req.params.clerkUserId as string;

      const token = await clerkClient.signInTokens.createSignInToken({
        userId: clerkUserId,
        expiresInSeconds: 86400, // 24 hours
      });

      // The token.url is the Clerk-hosted sign-in page with the ticket pre-filled.
      // For custom flows, the URL scheme is: <frontend>/sign-in?__clerk_ticket=<token.token>
      res.json({ url: token.url, token: token.token });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
      res.status(500).json({ error: `Şifre sıfırlama bağlantısı oluşturulamadı: ${msg}` });
    }
  },
);

// ── GET /api/invitations ──────────────────────────────────────────────────────
router.get(
  "/invitations",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const validStatuses = ["pending", "accepted", "expired", "revoked"] as const;
      type InvitationStatus = typeof validStatuses[number];

      const params: { limit: number; status?: InvitationStatus } = { limit: 100 };
      if (status && (validStatuses as readonly string[]).includes(status)) {
        params.status = status as InvitationStatus;
      }

      const result = await clerkClient.invitations.getInvitationList(params);

      // Enrich with the pre-assigned role from our DB stubs
      const invites = await Promise.all(
        result.data.map(async inv => {
          const [stub] = await db
            .select({ role: profilesTable.role })
            .from(profilesTable)
            .where(eq(profilesTable.clerkUserId, `pending-${inv.emailAddress}`))
            .limit(1);
          return {
            id: inv.id,
            emailAddress: inv.emailAddress,
            status: inv.status,
            role: stub?.role ?? (inv.publicMetadata as Record<string, unknown>)?.pendingRole ?? null,
            createdAt: inv.createdAt,
          };
        }),
      );

      res.json(invites);
    } catch {
      res.status(500).json({ error: "Davetler listelenemedi" });
    }
  },
);

// ── POST /api/invitations/:id/revoke ─────────────────────────────────────────
router.post(
  "/invitations/:id/revoke",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const invId = req.params.id as string;
      await clerkClient.invitations.revokeInvitation(invId);

      // Also clean up the DB stub for this invitation (look up by status)
      // We don't know the email here, so we skip DB cleanup (stub remains inert)
      res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
      res.status(500).json({ error: `Davet iptal edilemedi: ${msg}` });
    }
  },
);

// ── POST /api/invitations/:id/resend ─────────────────────────────────────────
// Revoke the existing invitation and re-send a new one to the same email.
router.post(
  "/invitations/:id/resend",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const invId = req.params.id as string;

      // Get the invitation details first
      const allInvites = await clerkClient.invitations.getInvitationList({
        limit: 500,
      });
      const inv = allInvites.data.find(i => i.id === invId);
      if (!inv) {
        res.status(404).json({ error: "Davet bulunamadı" });
        return;
      }

      // Revoke the old invitation (only possible when still pending)
      try {
        await clerkClient.invitations.revokeInvitation(invId);
      } catch {
        /* already revoked or expired, continue */
      }

      // Determine role from metadata or DB stub
      const meta = inv.publicMetadata as Record<string, unknown>;
      const role = meta?.pendingRole as string | undefined;

      // Re-send
      await clerkClient.invitations.createInvitation({
        emailAddress: inv.emailAddress,
        publicMetadata: { pendingRole: role },
        ignoreExisting: true,
      });

      res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
      res.status(500).json({ error: `Davet yeniden gönderilemedi: ${msg}` });
    }
  },
);

export default router;
