/**
 * Permission cache service
 *
 * Provides in-memory caching of permission sets so each API request does not
 * hit the DB. Cache entries expire after PERM_TTL_MS; they are also evicted
 * explicitly when the super_admin changes role- or user-permissions.
 *
 * System-mode is cached separately with a shorter TTL so mode changes propagate
 * within ~30 seconds without requiring a restart.
 */

import { db } from "@workspace/db";
import {
  permissionsTable,
  rolePermissionsTable,
  userPermissionsTable,
  systemSettingsTable,
  type SystemSettings,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

// ── Config ────────────────────────────────────────────────────────────────────
const PERM_TTL_MS = 5 * 60 * 1000;   // 5 min
const MODE_TTL_MS =      30 * 1000;  // 30 sec

// ── Profile permission cache ──────────────────────────────────────────────────
const profilePermCache = new Map<number, { perms: Set<string>; loadedAt: number }>();

async function loadPermissionsForProfile(
  profileId: number,
  role: string,
): Promise<Set<string>> {
  const [rolePerms, userPerms] = await Promise.all([
    db
      .select({ module: permissionsTable.module, action: permissionsTable.action })
      .from(rolePermissionsTable)
      .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
      .where(
        and(
          eq(rolePermissionsTable.roleName,  role),
          eq(rolePermissionsTable.granted,   true),
        ),
      ),
    db
      .select({
        module:  permissionsTable.module,
        action:  permissionsTable.action,
        granted: userPermissionsTable.granted,
      })
      .from(userPermissionsTable)
      .innerJoin(permissionsTable, eq(userPermissionsTable.permissionId, permissionsTable.id))
      .where(eq(userPermissionsTable.profileId, profileId)),
  ]);

  const perms = new Set(rolePerms.map(p => `${p.module}.${p.action}`));

  // User overrides win over role defaults
  for (const up of userPerms) {
    const key = `${up.module}.${up.action}`;
    if (up.granted) perms.add(key);
    else             perms.delete(key);
  }

  return perms;
}

/**
 * Returns the full permission set for a profile, using the cache when fresh.
 */
export async function getPermissionsForProfile(
  profileId: number,
  role: string,
): Promise<Set<string>> {
  const cached = profilePermCache.get(profileId);
  if (cached && Date.now() - cached.loadedAt < PERM_TTL_MS) return cached.perms;

  const perms = await loadPermissionsForProfile(profileId, role);
  profilePermCache.set(profileId, { perms, loadedAt: Date.now() });
  return perms;
}

/**
 * Returns true if the profile has the given (module, action) permission.
 * super_admin always returns true; the DB is not consulted.
 */
export async function hasPermission(
  profileId: number,
  role:      string,
  module:    string,
  action:    string,
): Promise<boolean> {
  if (role === "super_admin") return true;
  const perms = await getPermissionsForProfile(profileId, role);
  return perms.has(`${module}.${action}`);
}

/** Evict a single profile's permission cache (call after user_permissions change). */
export function invalidatePermissionsFor(profileId: number): void {
  profilePermCache.delete(profileId);
}

/** Evict the entire permission cache (call after role_permissions change). */
export function invalidateAllPermissions(): void {
  profilePermCache.clear();
}

// ── System-mode cache ─────────────────────────────────────────────────────────
let systemModeCache: { settings: SystemSettings; loadedAt: number } | null = null;

/**
 * Returns the current system settings row, creating it with defaults if absent.
 * Result is cached for MODE_TTL_MS.
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  if (systemModeCache && Date.now() - systemModeCache.loadedAt < MODE_TTL_MS) {
    return systemModeCache.settings;
  }

  let [settings] = await db.select().from(systemSettingsTable).limit(1);
  if (!settings) {
    [settings] = await db
      .insert(systemSettingsTable)
      .values({ systemMode: "active" })
      .returning();
  }

  systemModeCache = { settings, loadedAt: Date.now() };
  return settings;
}

/** Force the next getSystemSettings() call to re-read from DB. */
export function invalidateSystemMode(): void {
  systemModeCache = null;
}
