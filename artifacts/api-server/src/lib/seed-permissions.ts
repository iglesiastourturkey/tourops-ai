/**
 * seed-permissions.ts
 *
 * Idempotently populates:
 *   roles            — one row per named role
 *   permissions      — every (module, action) pair
 *   role_permissions — the full matrix with defaults that match current behaviour
 *   system_settings  — creates the row if absent
 *
 * Safe to call on every server startup; uses ON CONFLICT DO NOTHING / DO UPDATE.
 *
 * role_permissions rows flagged manually_set are never overwritten here — see
 * seedDefaultGranted() and the setWhere clause below.
 */

import { db } from "@workspace/db";
import {
  rolesTable,
  permissionsTable,
  rolePermissionsTable,
  systemSettingsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ── Role metadata ─────────────────────────────────────────────────────────────
const ROLE_DEFS = [
  { name: "super_admin",     displayName: "Süper Yönetici",    description: "Tüm sistem yetkilerine sahip; kısıtlanamaz",  sortOrder: 0 },
  { name: "admin",           displayName: "Yönetici",          description: "Sistem yönetimi ve tüm modüllere tam erişim", sortOrder: 1 },
  { name: "operations",      displayName: "Operasyon",         description: "Tur, teklif ve operasyon yönetimi",           sortOrder: 2 },
  { name: "accounting",      displayName: "Muhasebe",          description: "Muhasebe ve raporlara erişim",                sortOrder: 3 },
  { name: "guide",           displayName: "Rehber",            description: "Atandığı operasyonlara erişim",              sortOrder: 4 },
  { name: "field_operations",displayName: "Saha Operasyon",    description: "Saha görevleri, olaylar ve fişler",          sortOrder: 5 },
] as const;

// ── Permission matrix ─────────────────────────────────────────────────────────
// [module, action, roles_that_have_it_by_default]
// super_admin is NEVER listed — it bypasses all checks at the middleware level.
type PermRow = [string, string, string[]];

const MATRIX: PermRow[] = [
  // dashboard
  ["dashboard", "view",    ["admin","operations","guide","accounting","field_operations"]],
  ["dashboard", "export",  ["admin","operations","accounting"]],
  ["dashboard", "manage",  ["admin"]],

  // customers
  ["customers", "view",    ["admin","operations","accounting"]],
  ["customers", "create",  ["admin","operations"]],
  ["customers", "update",  ["admin","operations"]],
  ["customers", "delete",  ["admin"]],
  ["customers", "archive", ["admin","operations"]],

  // suppliers
  ["suppliers", "view",    ["admin","operations","accounting"]],
  ["suppliers", "create",  ["admin","operations"]],
  ["suppliers", "update",  ["admin","operations"]],
  ["suppliers", "delete",  ["admin"]],
  ["suppliers", "archive", ["admin","operations"]],

  // tours
  ["tours", "view",    ["admin","operations","guide","accounting"]],
  ["tours", "create",  ["admin","operations"]],
  ["tours", "update",  ["admin","operations"]],
  ["tours", "delete",  ["admin","operations"]],
  ["tours", "archive", ["admin","operations"]],

  // quotations
  ["quotations", "view",    ["admin","operations","accounting"]],
  ["quotations", "create",  ["admin","operations"]],
  ["quotations", "update",  ["admin","operations"]],
  ["quotations", "delete",  ["admin","operations"]],
  ["quotations", "approve", ["admin","operations"]],
  ["quotations", "archive", ["admin","operations"]],
  ["quotations", "manage",  ["admin","operations"]],  // convert-to-operation

  // operations
  ["operations", "view",    ["admin","operations","accounting","guide"]],
  ["operations", "create",  ["admin","operations"]],
  ["operations", "update",  ["admin","operations","guide"]],  // guide can update tasks
  // operations.delete still covers the sub-resources (tasks, documents) it
  // always did. Destroying a whole operation — with its receipts, field notes
  // and the accounting links the FKs would null — is a different order of
  // action and gets its own permission rather than riding along on this one.
  ["operations", "delete",  ["admin","operations"]],
  ["operations", "purge",   ["admin"]],
  ["operations", "approve", ["admin"]],
  ["operations", "assign",  ["admin","operations"]],
  ["operations", "archive", ["admin","operations"]],

  // guide_workspace
  ["guide_workspace", "view",   ["admin","guide","field_operations"]],
  ["guide_workspace", "create", ["admin","guide"]],
  ["guide_workspace", "update", ["admin","guide"]],
  ["guide_workspace", "assign", ["admin","operations"]],
  ["guide_workspace", "upload", ["admin","guide"]],

  // field_operations
  ["field_operations", "view",   ["admin","operations","field_operations"]],
  ["field_operations", "create", ["admin","operations","field_operations"]],
  ["field_operations", "update", ["admin","operations","field_operations"]],
  ["field_operations", "delete", ["admin","operations"]],
  ["field_operations", "assign", ["admin","operations"]],
  ["field_operations", "upload", ["admin","field_operations"]],

  // incidents
  ["incidents", "view",    ["admin","operations","field_operations","guide"]],
  ["incidents", "create",  ["admin","operations","field_operations","guide"]],
  ["incidents", "update",  ["admin","operations","field_operations"]],
  ["incidents", "delete",  ["admin","operations"]],
  ["incidents", "assign",  ["admin","operations"]],
  ["incidents", "approve", ["admin"]],
  ["incidents", "upload",  ["admin","operations","field_operations"]],

  // receipts
  ["receipts", "view",     ["admin","operations","accounting","guide","field_operations"]],
  ["receipts", "create",   ["admin","operations","guide","field_operations"]],
  ["receipts", "update",   ["admin","operations"]],
  ["receipts", "delete",   ["admin","operations"]],
  ["receipts", "approve",  ["admin","operations"]],
  ["receipts", "upload",   ["admin","operations","guide","field_operations"]],
  ["receipts", "download", ["admin","accounting"]],

  // documents
  ["documents", "view",     ["admin","accounting","operations"]],
  ["documents", "download", ["admin","accounting","operations"]],
  ["documents", "manage",   ["admin"]],

  // accounting
  ["accounting", "view",     ["admin","accounting","operations"]],
  ["accounting", "create",   ["admin","accounting"]],
  ["accounting", "update",   ["admin","accounting"]],
  ["accounting", "delete",   ["admin"]],
  ["accounting", "manage",   ["admin","accounting"]],
  ["accounting", "approve",  ["admin"]],
  ["accounting", "export",   ["admin","accounting"]],
  ["accounting", "download", ["admin","accounting","operations"]],

  // accounting_ai
  ["accounting_ai", "view",   ["admin","accounting"]],
  ["accounting_ai", "manage", ["admin"]],

  // reports
  ["reports", "view",     ["admin","operations","accounting"]],
  ["reports", "export",   ["admin","operations","accounting"]],
  ["reports", "download", ["admin","accounting"]],

  // notifications
  ["notifications", "view",   ["admin","operations","guide","accounting","field_operations"]],
  ["notifications", "manage", ["admin"]],

  // users — admin also gets full access; super_admin bypasses the check entirely
  ["users", "view",   ["admin"]],
  ["users", "create", ["admin"]],
  ["users", "update", ["admin"]],
  ["users", "delete", ["admin"]],
  ["users", "manage", ["admin"]],

  // roles — super_admin only
  ["roles", "view",   []],
  ["roles", "manage", []],

  // settings
  ["settings", "view",   ["admin","operations"]],
  ["settings", "manage", ["admin","operations"]],

  // Gmail reservation intake
  ["reservations", "view",   ["admin","operations"]],
  ["reservations", "create", ["admin","operations"]],
  ["reservations", "update", ["admin","operations"]],
  // Permanent deletion is irreversible and has no recovery path, so it is not
  // part of the day-to-day operations grant. Kept separate from
  // reservations.update for the same reason: an operator who reviews inbox rows
  // does not thereby need the ability to destroy them.
  ["reservations", "delete", ["admin"]],

  // personnel — Phase 2D.1 canonical Guide/Driver identity foundation.
  // No delete: a Resource is deactivated via personnel.update (active:
  // false), never hard-deleted, matching the existing convention for
  // records still referenceable from historical data (same reasoning as
  // suppliers/customers using archive instead of delete).
  ["personnel", "view",   ["admin","operations"]],
  ["personnel", "create", ["admin","operations"]],
  ["personnel", "update", ["admin","operations"]],

  // system_control — super_admin only
  ["system_control", "view",   []],
  ["system_control", "manage", []],

  // exports
  ["exports", "export",   ["admin","operations","accounting"]],
  ["exports", "download", ["admin","accounting"]],

  // ai
  ["ai", "view",   ["admin","operations","guide","accounting","field_operations"]],
  ["ai", "manage", ["admin"]],

  // historical_migration — Faz 3D: review/approve/reject/promote legacy
  // GEMI/SEJOUR staging rows into real operations. Admin-only by default:
  // this is irreversible historical-record promotion, not day-to-day
  // operations work, matching operations.purge/operations.approve above.
  ["historical_migration", "review",  ["admin"]],
  ["historical_migration", "remediate", ["admin"]],
  ["historical_migration", "approve", ["admin"]],
  ["historical_migration", "reject",  ["admin"]],
  ["historical_migration", "promote", ["admin"]],
  ["historical_migration", "pickup_time_correct", ["admin"]],
  ["historical_migration", "customer_review", ["admin"]],
  ["historical_migration", "customer_link",   ["admin"]],
  // Phase 3H.4B — customer identity & projection foundation. Dedicated
  // split (never the broad promote permission): PLAN is read-only,
  // CREATE/ LINK gate the future 3H.4C APPLY paths separately.
  ["historical_migration", "customer_projection_plan", ["admin"]],
  ["historical_migration", "customer_create",          ["admin"]],
  ["historical_migration", "customer_link_projection", ["admin"]],
];

// Non-super roles that appear in the matrix
const SEEDABLE_ROLES = ["admin", "operations", "accounting", "guide", "field_operations"] as const;

// ── Seed default lookup ───────────────────────────────────────────────────────
// `${role}.${module}.${action}` → the granted value this matrix defines.
const SEED_DEFAULTS = new Map<string, boolean>();
for (const role of SEEDABLE_ROLES) {
  for (const [module, action, grantedRoles] of MATRIX) {
    SEED_DEFAULTS.set(`${role}.${module}.${action}`, grantedRoles.includes(role));
  }
}

/**
 * The value seedPermissions() would write for this (role, module, action),
 * or null when the pair is not part of the seed matrix at all — e.g. a role
 * outside SEEDABLE_ROLES, or a permission row left in the DB after being
 * removed from MATRIX in a later release.
 *
 * Used by PATCH /api/roles/:roleName/permissions/:permId to decide whether a
 * super_admin's change is an override (differs from the default → freeze the
 * row) or a return to the default (→ hand the row back to the seed).
 */
export function seedDefaultGranted(
  role:   string,
  module: string,
  action: string,
): boolean | null {
  return SEED_DEFAULTS.get(`${role}.${module}.${action}`) ?? null;
}

export async function seedPermissions(): Promise<void> {
  // 1. Upsert roles
  await db
    .insert(rolesTable)
    .values([...ROLE_DEFS])
    .onConflictDoUpdate({
      target: rolesTable.name,
      set: {
        displayName: sql`excluded.display_name`,
        description: sql`excluded.description`,
        sortOrder:   sql`excluded.sort_order`,
      },
    });

  // 2. Upsert permissions (module+action pairs)
  const permValues = MATRIX.map(([module, action]) => ({ module, action }));
  await db
    .insert(permissionsTable)
    .values(permValues)
    .onConflictDoNothing();

  // 3. Re-fetch all permissions to get their IDs
  const allPerms = await db.select().from(permissionsTable);
  const permIdMap = new Map(allPerms.map(p => [`${p.module}.${p.action}`, p.id]));

  // 4. Upsert role_permissions for every (role, permission) pair
  const rpValues: Array<{ roleName: string; permissionId: number; granted: boolean }> = [];
  for (const role of SEEDABLE_ROLES) {
    for (const [module, action, grantedRoles] of MATRIX) {
      const permId = permIdMap.get(`${module}.${action}`);
      if (!permId) continue;
      rpValues.push({
        roleName:     role,
        permissionId: permId,
        granted:      grantedRoles.includes(role),
      });
    }
  }

  // Batch in chunks of 100 to avoid huge single inserts
  const CHUNK = 100;
  for (let i = 0; i < rpValues.length; i += CHUNK) {
    await db
      .insert(rolePermissionsTable)
      .values(rpValues.slice(i, i + CHUNK))
      // Permissions added in a later release must update the default matrix for
      // existing installations. A no-op conflict left already-created admin and
      // operations roles without the reservations grants.
      //
      // setWhere narrows that update to rows the seed still owns: a manually_set
      // row was deliberately changed by a super_admin from the /roles screen and
      // must survive restarts, which an unconditional DO UPDATE silently undid.
      // Rows that do not exist yet are plain INSERTs and are unaffected, so new
      // permissions keep rolling out to existing installations.
      .onConflictDoUpdate({
        target: [rolePermissionsTable.roleName, rolePermissionsTable.permissionId],
        set: { granted: sql`excluded.granted` },
        setWhere: sql`${rolePermissionsTable.manuallySet} = false`,
      });
  }

  // 5. Ensure system_settings row exists
  const [existing] = await db.select().from(systemSettingsTable).limit(1);
  if (!existing) {
    await db.insert(systemSettingsTable).values({ systemMode: "active" });
  }
}
