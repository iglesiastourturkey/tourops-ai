/**
 * /api/roles  — permission matrix management (super_admin only)
 *
 * GET  /roles                              full matrix for all roles
 * GET  /roles/:roleName                    single role's permissions
 * PATCH /roles/:roleName/permissions/:id   toggle one role-permission
 * GET  /roles/user-overrides/:profileId    user-specific overrides
 * PUT  /roles/user-overrides/:profileId/:permId  set override (granted t/f)
 * DELETE /roles/user-overrides/:profileId/:permId remove override
 */

import { Router } from "express";
import { requireAuth, requirePermission } from "../lib/auth";
import { invalidatePermissionsFor, invalidateAllPermissions } from "../lib/permissions";
import { seedDefaultGranted } from "../lib/seed-permissions";
import { createAuditLog } from "../lib/audit";
import { db } from "@workspace/db";
import {
  rolesTable,
  permissionsTable,
  rolePermissionsTable,
  userPermissionsTable,
  profilesTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

function paramInt(v: string | string[]): number {
  return parseInt(Array.isArray(v) ? v[0] : v, 10);
}

const router = Router();

// All role-management endpoints require super_admin (via requirePermission bypass)
router.use(requireAuth, requirePermission("roles", "manage"));

// ── GET /roles ─────────────────────────────────────────────────────────────────
// Returns: { roles: Role[], permissions: Permission[], matrix: RolePermission[] }
router.get("/", async (_req, res) => {
  const [roles, permissions, matrix] = await Promise.all([
    db.select().from(rolesTable).orderBy(rolesTable.sortOrder),
    db.select().from(permissionsTable).orderBy(permissionsTable.module, permissionsTable.action),
    db.select().from(rolePermissionsTable),
  ]);
  res.json({ roles, permissions, matrix });
});

// ── GET /roles/:roleName ────────────────────────────────────────────────────────
router.get("/:roleName", async (req, res) => {
  const { roleName } = req.params;
  const [role, perms] = await Promise.all([
    db.select().from(rolesTable).where(eq(rolesTable.name, roleName)).limit(1),
    db
      .select({ permission: permissionsTable, granted: rolePermissionsTable.granted })
      .from(rolePermissionsTable)
      .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
      .where(eq(rolePermissionsTable.roleName, roleName)),
  ]);
  if (!role[0]) { res.status(404).json({ error: "Rol bulunamadı" }); return; }
  res.json({ role: role[0], permissions: perms });
});

// ── PATCH /roles/:roleName/permissions/:permId ──────────────────────────────────
// Body: { granted: boolean }
router.patch("/:roleName/permissions/:permId", async (req, res) => {
  const { roleName } = req.params;
  const permId  = paramInt(req.params["permId"]);
  const { granted } = req.body as { granted: boolean };
  const actor   = res.locals.profile;

  if (roleName === "super_admin") {
    res.status(400).json({ error: "Süper yönetici yetkisi değiştirilemez" });
    return;
  }
  if (typeof granted !== "boolean") {
    res.status(400).json({ error: "granted alanı boolean olmalı" });
    return;
  }

  // Fetch old value for audit
  const [existing] = await db
    .select()
    .from(rolePermissionsTable)
    .where(and(eq(rolePermissionsTable.roleName, roleName), eq(rolePermissionsTable.permissionId, permId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Yetki girişi bulunamadı" });
    return;
  }

  const [perm] = await db.select().from(permissionsTable).where(eq(permissionsTable.id, permId)).limit(1);
  if (!perm) {
    res.status(404).json({ error: "Yetki girişi bulunamadı" });
    return;
  }

  // Flag the row only while it actually diverges from the seed matrix, so the
  // startup seed skips it (see seed-permissions.ts). Toggling a permission back
  // to its default clears the flag and returns the row to seed management —
  // otherwise a one-off change would freeze it against every future default
  // change with no way to undo it from the UI.
  const defaultGranted = seedDefaultGranted(roleName, perm.module, perm.action);
  const manuallySet    = defaultGranted === null || granted !== defaultGranted;

  await db
    .update(rolePermissionsTable)
    .set({ granted, manuallySet })
    .where(and(eq(rolePermissionsTable.roleName, roleName), eq(rolePermissionsTable.permissionId, permId)));

  // Invalidate cache for this role
  invalidateAllPermissions();

  // Audit
  await createAuditLog({
    eventType:      "permission_changed",
    actorProfileId: actor.id,
    oldValue:       { roleName, module: perm.module, action: perm.action, granted: existing.granted, manuallySet: existing.manuallySet },
    newValue:       { roleName, module: perm.module, action: perm.action, granted, manuallySet },
  });

  res.json({ ok: true, manuallySet });
});

// ── GET /roles/user-overrides/:profileId ───────────────────────────────────────
router.get("/user-overrides/:profileId", async (req, res) => {
  const profileId = paramInt(req.params["profileId"]);
  const overrides = await db
    .select({ permission: permissionsTable, granted: userPermissionsTable.granted, grantedAt: userPermissionsTable.grantedAt })
    .from(userPermissionsTable)
    .innerJoin(permissionsTable, eq(userPermissionsTable.permissionId, permissionsTable.id))
    .where(eq(userPermissionsTable.profileId, profileId));
  res.json(overrides);
});

// ── PUT /roles/user-overrides/:profileId/:permId ──────────────────────────────
// Body: { granted: boolean }
router.put("/user-overrides/:profileId/:permId", async (req, res) => {
  const profileId = paramInt(req.params["profileId"]);
  const permId    = paramInt(req.params["permId"]);
  const { granted } = req.body as { granted: boolean };
  const actor     = res.locals.profile;

  // Safety: cannot override super_admin
  const [target] = await db.select().from(profilesTable).where(eq(profilesTable.id, profileId)).limit(1);
  if (!target) { res.status(404).json({ error: "Profil bulunamadı" }); return; }
  if (target.role === "super_admin") {
    res.status(400).json({ error: "Süper yöneticiye kullanıcı geçersiz kılma uygulanamaz" });
    return;
  }

  await db
    .insert(userPermissionsTable)
    .values({ profileId, permissionId: permId, granted, grantedByProfileId: actor.id })
    .onConflictDoUpdate({
      target:  [userPermissionsTable.profileId, userPermissionsTable.permissionId],
      set:     { granted, grantedByProfileId: actor.id, grantedAt: new Date() },
    });

  invalidatePermissionsFor(profileId);

  await createAuditLog({
    eventType:       "user_override_set",
    actorProfileId:  actor.id,
    targetProfileId: profileId,
    newValue:        { permissionId: permId, granted },
  });

  res.json({ ok: true });
});

// ── DELETE /roles/user-overrides/:profileId/:permId ───────────────────────────
router.delete("/user-overrides/:profileId/:permId", async (req, res) => {
  const profileId = paramInt(req.params["profileId"]);
  const permId    = paramInt(req.params["permId"]);
  const actor     = res.locals.profile;

  await db
    .delete(userPermissionsTable)
    .where(
      and(
        eq(userPermissionsTable.profileId,    profileId),
        eq(userPermissionsTable.permissionId, permId),
      ),
    );

  invalidatePermissionsFor(profileId);

  await createAuditLog({
    eventType:       "user_override_removed",
    actorProfileId:  actor.id,
    targetProfileId: profileId,
    newValue:        { permissionId: permId },
  });

  res.json({ ok: true });
});

export default router;
