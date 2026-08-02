/**
 * systemMode middleware
 *
 * Enforces the global system mode on every /api request (except /api/healthz
 * and Clerk proxy paths).  Must be mounted BEFORE requirePermission / requireRole.
 *
 * Mode matrix:
 *   active      → pass all requests
 *   maintenance → only super_admin and explicitly allowed profile IDs may pass
 *   read_only   → allow GET/HEAD; block POST/PUT/PATCH/DELETE for non-super_admin
 *   disabled    → only super_admin may pass
 */

import { type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { getOrCreateProfile } from "../lib/auth";
import { getSystemSettings } from "../lib/permissions";

const PASS_PATHS = ["/healthz", "/__clerk"];
const MUTATING   = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function systemModeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Always allow health checks and Clerk proxy
  if (PASS_PATHS.some(p => req.path.startsWith(p))) {
    next();
    return;
  }

  const settings = await getSystemSettings();
  if (settings.systemMode === "active") {
    next();
    return;
  }

  // Non-active mode: resolve the caller's profile for super_admin bypass
  const { userId, sessionClaims } = getAuth(req);
  let profileId: number | null = null;
  let isSuperAdmin = false;

  if (userId) {
    try {
      const email = (sessionClaims?.email as string) ?? "";
      const name  = (sessionClaims?.name  as string) ?? undefined;
      const profile = await getOrCreateProfile(userId, email, name);
      // Pre-load into res.locals so requirePermission doesn't double-query
      res.locals.profile = profile;
      profileId    = profile.id;
      isSuperAdmin = profile.role === "super_admin";
    } catch {
      // Proceed; if auth is needed, the next middleware will reject
    }
  }

  if (isSuperAdmin) {
    next();
    return;
  }

  switch (settings.systemMode) {
    case "disabled":
      res.status(503).json({
        error: "Sistem geçici olarak hizmet dışıdır.",
        mode:  "disabled",
      });
      return;

    case "maintenance": {
      const allowed =
        profileId !== null &&
        (settings.maintenanceAllowedProfileIds ?? []).includes(profileId);
      if (!allowed) {
        res.status(503).json({
          error: settings.maintenanceMessage ??
            "Sistem bakım modundadır. Lütfen daha sonra tekrar deneyin.",
          mode: "maintenance",
        });
        return;
      }
      break;
    }

    case "read_only":
      if (MUTATING.has(req.method)) {
        res.status(503).json({
          error: "Sistem salt okunur modundadır. Yalnızca görüntüleme işlemlerine izin verilmektedir.",
          mode:  "read_only",
        });
        return;
      }
      break;
  }

  next();
}
