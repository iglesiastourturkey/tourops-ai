/**
 * /api/system — system control (super_admin only)
 *
 * GET  /system/mode      public — returns current mode + message (for frontend maintenance screen)
 * GET  /system/settings  full settings (super_admin only)
 * PATCH /system/settings update mode / maintenance config
 */

import { Router } from "express";
import { requireAuth, requirePermission } from "../lib/auth";
import { getSystemSettings, invalidateSystemMode } from "../lib/permissions";
import { createAuditLog } from "../lib/audit";
import { db } from "@workspace/db";
import { systemSettingsTable, profilesTable, SYSTEM_MODES } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

const router = Router();

// ── GET /system/mode — public (no auth required) ──────────────────────────────
// Used by the frontend to check if it should show a maintenance/disabled screen
router.get("/mode", async (_req, res) => {
  try {
    const settings = await getSystemSettings();
    res.json({
      mode:    settings.systemMode,
      message: settings.maintenanceMessage ?? null,
    });
  } catch {
    res.json({ mode: "active", message: null });
  }
});

// All other system endpoints: super_admin only
router.use(requireAuth, requirePermission("system_control", "manage"));

// ── GET /system/settings ──────────────────────────────────────────────────────
router.get("/settings", async (_req, res) => {
  const settings = await getSystemSettings();

  // Enrich maintenance_allowed_profile_ids with user info
  let allowedUsers: Array<{ id: number; name: string | null; email: string | null }> = [];
  if ((settings.maintenanceAllowedProfileIds ?? []).length > 0) {
    allowedUsers = await db
      .select({ id: profilesTable.id, name: profilesTable.name, email: profilesTable.email })
      .from(profilesTable)
      .where(
        eq(profilesTable.id, settings.maintenanceAllowedProfileIds![0]),
      );
    // Fetch all in one query using IN — build dynamically
    const ids = settings.maintenanceAllowedProfileIds!;
    allowedUsers = await db
      .select({ id: profilesTable.id, name: profilesTable.name, email: profilesTable.email })
      .from(profilesTable);
    allowedUsers = allowedUsers.filter(u => ids.includes(u.id));
  }

  res.json({ ...settings, allowedUsers });
});

// ── PATCH /system/settings ────────────────────────────────────────────────────
const patchSchema = z.object({
  systemMode:                   z.enum([...SYSTEM_MODES] as [string, ...string[]]).optional(),
  maintenanceMessage:           z.string().max(500).nullable().optional(),
  maintenanceStartAt:           z.string().nullable().optional(),
  maintenanceEndAt:             z.string().nullable().optional(),
  maintenanceAllowedProfileIds: z.array(z.number().int().positive()).optional(),
});

router.patch("/settings", async (req, res) => {
  const actor = res.locals.profile;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Geçersiz istek", details: parsed.error.issues });
    return;
  }

  const body = parsed.data;

  // Safety: super_admin cannot lock himself out
  if (body.systemMode === "disabled") {
    // Still allowed — super_admin always bypasses disabled mode
  }

  const oldSettings = await getSystemSettings();

  const updatePayload: Partial<{
    systemMode: string;
    maintenanceMessage: string | null;
    maintenanceStartAt: Date | null;
    maintenanceEndAt: Date | null;
    maintenanceAllowedProfileIds: number[] | null;
  }> = {};

  if (body.systemMode           !== undefined) updatePayload.systemMode = body.systemMode;
  if (body.maintenanceMessage   !== undefined) updatePayload.maintenanceMessage = body.maintenanceMessage;
  if (body.maintenanceStartAt   !== undefined)
    updatePayload.maintenanceStartAt = body.maintenanceStartAt ? new Date(body.maintenanceStartAt) : null;
  if (body.maintenanceEndAt     !== undefined)
    updatePayload.maintenanceEndAt = body.maintenanceEndAt ? new Date(body.maintenanceEndAt) : null;
  if (body.maintenanceAllowedProfileIds !== undefined)
    updatePayload.maintenanceAllowedProfileIds = body.maintenanceAllowedProfileIds;

  await db.update(systemSettingsTable).set(updatePayload).where(eq(systemSettingsTable.id, oldSettings.id));
  invalidateSystemMode();

  await createAuditLog({
    eventType:      "system_mode_changed",
    actorProfileId: actor.id,
    oldValue:       { mode: oldSettings.systemMode },
    newValue:       { mode: body.systemMode ?? oldSettings.systemMode, ...updatePayload },
  });

  const updated = await getSystemSettings();
  res.json(updated);
});

export default router;
