/**
 * Faz 3D-A: server-side operator verification for historical_migration
 * actions (approve/reject/promote), used by CLI entrypoints that have no
 * Clerk/HTTP request context to pull a profile from.
 *
 * Deliberately thin: it does not invent a second RBAC system. Permission
 * evaluation is delegated entirely to the existing hasPermission()
 * (lib/permissions.ts), which already reads role_permissions/
 * user_permissions and special-cases super_admin - the same policy every
 * HTTP route's requirePermission() middleware enforces. Only the profile
 * existence/active check below is new, because a CLI caller supplies a bare
 * --operator-profile-id with no session to have already validated it.
 */

import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { hasPermission } from "./permissions";

export type OperatorVerification =
  | { ok: true; profileId: number; role: string }
  | { ok: false; code: "operator_not_found" | "operator_inactive" | "forbidden"; message: string };

export async function verifyOperatorPermission(
  profileId: number,
  module: string,
  action: string,
): Promise<OperatorVerification> {
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.id, profileId)).limit(1);
  if (!profile) {
    return { ok: false, code: "operator_not_found", message: `Operator profile ${profileId} bulunamadi` };
  }
  if (!profile.isActive) {
    return { ok: false, code: "operator_inactive", message: `Operator profile ${profileId} pasif durumda` };
  }
  // hasPermission() bypasses the DB entirely for super_admin, matching the
  // exact behaviour requirePermission() gives every HTTP route.
  const allowed = await hasPermission(profile.id, profile.role, module, action);
  if (!allowed) {
    return { ok: false, code: "forbidden", message: `Operator profile ${profileId} icin ${module}.${action} yetkisi yok` };
  }
  return { ok: true, profileId: profile.id, role: profile.role };
}
