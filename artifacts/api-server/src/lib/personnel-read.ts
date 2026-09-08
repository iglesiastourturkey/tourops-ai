/**
 * Read models for the canonical Personnel/Guide identity foundation
 * (Phase 2D.1). See docs/architecture/phase2d1-personnel-identity-foundation.md.
 *
 * Deliberately excludes any auth secret/session data from every response —
 * a linked profile is surfaced only as a minimal summary (id, name, email,
 * role, isActive), never clerkUserId or anything session-related.
 */
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { resourcesTable, resourceAliasesTable, profilesTable } from "@workspace/db/schema";
import { and, eq, ilike, or, asc } from "drizzle-orm";
import { RESOURCE_TYPES } from "./personnel-write";
import { matchResourceIdentity, type MatchResourceIdentityOptions } from "./personnel-identity";

function paramStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function personnelListRead(req: Request, res: Response) {
  try {
    const { type, active, q } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (type && (RESOURCE_TYPES as readonly string[]).includes(type)) {
      conditions.push(eq(resourcesTable.type, type));
    }
    if (active === "true" || active === "false") {
      conditions.push(eq(resourcesTable.active, active === "true"));
    }
    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(or(
        ilike(resourcesTable.name, term),
        ilike(resourcesTable.phone, term),
        ilike(resourcesTable.email, term),
        ilike(resourcesTable.company, term),
      ));
    }

    const rows = await db
      .select({
        id: resourcesTable.id,
        type: resourcesTable.type,
        name: resourcesTable.name,
        phone: resourcesTable.phone,
        email: resourcesTable.email,
        languages: resourcesTable.languages,
        company: resourcesTable.company,
        licenseNumber: resourcesTable.licenseNumber,
        active: resourcesTable.active,
        linkedProfileId: resourcesTable.linkedProfileId,
        createdAt: resourcesTable.createdAt,
        updatedAt: resourcesTable.updatedAt,
      })
      .from(resourcesTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(resourcesTable.name));

    res.json(rows.map(r => ({ ...r, hasLinkedLogin: r.linkedProfileId != null })));
  } catch (err) {
    req.log?.error({ err }, "personnel list read failed");
    res.status(500).json({ error: "Personel listesi alınamadı" });
  }
}

export async function personnelDetailRead(req: Request, res: Response) {
  try {
    const id = parseInt(paramStr(req.params["id"]), 10);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Geçersiz ID" });
      return;
    }

    const [resource] = await db.select().from(resourcesTable).where(eq(resourcesTable.id, id)).limit(1);
    if (!resource) {
      res.status(404).json({ error: "Personel bulunamadı" });
      return;
    }

    const [aliases, linkedProfile] = await Promise.all([
      db.select({
        id: resourceAliasesTable.id,
        source: resourceAliasesTable.source,
        alias: resourceAliasesTable.alias,
        normalizedAlias: resourceAliasesTable.normalizedAlias,
        createdAt: resourceAliasesTable.createdAt,
      }).from(resourceAliasesTable)
        .where(eq(resourceAliasesTable.resourceId, id))
        .orderBy(asc(resourceAliasesTable.createdAt)),
      resource.linkedProfileId
        ? db.select({
            id: profilesTable.id,
            name: profilesTable.name,
            email: profilesTable.email,
            role: profilesTable.role,
            isActive: profilesTable.isActive,
          }).from(profilesTable).where(eq(profilesTable.id, resource.linkedProfileId)).limit(1)
        : Promise.resolve([]),
    ]);

    res.json({
      ...resource,
      aliases,
      linkedProfile: linkedProfile[0] ?? null,
    });
  } catch (err) {
    req.log?.error({ err }, "personnel detail read failed");
    res.status(500).json({ error: "Personel detayı alınamadı" });
  }
}

// Exported for the matching-service caller (routes/resources.ts) so the
// route stays the only place that touches the DB, matching the separation
// used by reservation-record-read/write.ts.
export async function fetchIdentityCandidates(type: "GUIDE" | "DRIVER") {
  const [resources, aliasRows] = await Promise.all([
    db.select({ id: resourcesTable.id, normalizedName: resourcesTable.normalizedName })
      .from(resourcesTable)
      .where(and(eq(resourcesTable.type, type), eq(resourcesTable.active, true))),
    db.select({ resourceId: resourceAliasesTable.resourceId, normalizedAlias: resourceAliasesTable.normalizedAlias })
      .from(resourceAliasesTable)
      .innerJoin(resourcesTable, eq(resourceAliasesTable.resourceId, resourcesTable.id))
      .where(and(eq(resourcesTable.type, type), eq(resourcesTable.active, true))),
  ]);
  return { resources, aliasRows };
}

// ── Import-pipeline convenience wrapper ──────────────────────────────────
//
// Combines fetchIdentityCandidates() (DB) with matchResourceIdentity()
// (pure, lib/personnel-identity.ts) for a future Excel/email-import
// pipeline to call directly. Not exposed as an HTTP route in this phase —
// nothing consumes it yet (performance-workbook import is explicitly out
// of scope for Phase 2D.1). Kept here, not in personnel-identity.ts, so
// that file stays DB-free and directly unit-testable.
export async function matchResourceIdentityByName(
  rawName: string,
  type: "GUIDE" | "DRIVER",
  options?: MatchResourceIdentityOptions,
) {
  const { resources, aliasRows } = await fetchIdentityCandidates(type);
  return matchResourceIdentity(rawName, resources, aliasRows, options);
}
