/**
 * usePermission — check if the current user has a specific permission.
 *
 * Returns true for super_admin (all permissions), otherwise checks the
 * permission set fetched from /api/profiles/me/permissions on login.
 *
 * Usage:
 *   const canCreate = usePermission("customers", "create");
 *   const canExport = usePermission("exports", "export");
 */

import { useProfile } from "@/contexts/ProfileContext";

export function usePermission(module: string, action: string): boolean {
  const { permissionSet, allPermissions } = useProfile();
  if (allPermissions) return true;
  return permissionSet.has(`${module}.${action}`);
}

/**
 * Returns true if the user has ANY of the listed permissions.
 * Useful for showing UI elements that have multiple valid paths.
 */
export function useAnyPermission(checks: Array<[module: string, action: string]>): boolean {
  const { permissionSet, allPermissions } = useProfile();
  if (allPermissions) return true;
  return checks.some(([m, a]) => permissionSet.has(`${m}.${a}`));
}
