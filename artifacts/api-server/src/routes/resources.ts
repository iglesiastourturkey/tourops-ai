/**
 * Canonical Personnel/Guide identity foundation (Phase 2D.1) — admin/
 * operations-facing management of `resources` (GUIDE/DRIVER identities),
 * their aliases, and the optional link to a TourPilot login. See
 * docs/architecture/phase2d1-personnel-identity-foundation.md.
 *
 * Deliberately mounted at /resources, a path nothing else currently
 * claims (confirmed via routes/index.ts). This phase does NOT touch
 * PATCH /field/operations/:id/assignments or any other operation
 * assignment path — that rewiring is explicitly Phase 2C's job (see the
 * architecture document's Section B/G). Existing operations, whether or
 * not they carry a guide_resource_id/driver_resource_id, are unaffected
 * by anything in this file.
 *
 * New "personnel" permission resource (view/create/update), seeded in
 * lib/seed-permissions.ts for admin/operations — deliberately no `delete`
 * action: a Resource is deactivated via PATCH (active: false), never hard
 * deleted, consistent with how "active" already works on this table and
 * avoiding an FK-cascade surprise for any operation still referencing it.
 *
 * Every mutation below wraps its write(s) together with createAuditLog in
 * a single db.transaction, passing `tx` as createAuditLog's executor —
 * the same pattern reservation-records.ts uses — so a failure partway
 * through (e.g. the audit insert failing after the row write) rolls back
 * the whole request instead of leaving a written row with no audit trail.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { resourcesTable, resourceAliasesTable, profilesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { diffChangedFields } from "../lib/reservation-record-write";
import { personnelListRead, personnelDetailRead } from "../lib/personnel-read";
import { normalizePersonName } from "../lib/personnel-identity";
import { resourceCreateSchema, resourceUpdateSchema, resourceAliasCreateSchema } from "../lib/personnel-write";

const router = Router();
router.use(requireAuth);

function paramStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Postgres unique_violation. Used to turn a race-condition duplicate
// (alias insert, or linked_profile_id) into a clean 409 instead of a 500.
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

router.get("/", requirePermission("personnel", "view"), personnelListRead);
router.get("/:id", requirePermission("personnel", "view"), personnelDetailRead);

router.post("/", requirePermission("personnel", "create"), async (req: Request, res: Response) => {
  try {
    const parsed = resourceCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Geçersiz alanlar", issues: parsed.error.issues });
      return;
    }
    const input = parsed.data;
    const normalizedName = normalizePersonName(input.name);

    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(resourcesTable).values({
        type: input.type,
        name: input.name,
        normalizedName,
        phone: input.phone ?? null,
        email: input.email ?? null,
        languages: input.languages ?? null,
        company: input.company ?? null,
        licenseNumber: input.licenseNumber ?? null,
        notes: input.notes ?? null,
      }).returning();

      await createAuditLog({
        eventType: "personnel_created",
        actorProfileId: res.locals.profile.id,
        module: "personnel",
        entityType: "resource",
        entityId: inserted!.id,
        newValue: { type: inserted!.type, name: inserted!.name },
        description: "Personel kaydı oluşturuldu",
      }, tx);

      return inserted;
    });

    res.status(201).json(row);
  } catch (err) {
    req.log?.error({ err }, "personnel create failed");
    res.status(500).json({ error: "Personel oluşturulamadı" });
  }
});

router.patch("/:id", requirePermission("personnel", "update"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(paramStr(req.params["id"]), 10);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Geçersiz ID" });
      return;
    }
    const parsed = resourceUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Geçersiz alanlar", issues: parsed.error.issues });
      return;
    }
    const input = parsed.data;

    const result = await db.transaction(async (tx) => {
      // Row-locked for the duration of the transaction (matches the
      // select-for-update pattern in reservation-records.ts) so a
      // concurrent PATCH on the same resource can't interleave with the
      // linked-profile conflict check below and both "win".
      const [current] = await tx.select().from(resourcesTable)
        .where(eq(resourcesTable.id, id)).for("update");
      if (!current) return { notFound: true as const };

      // linkedProfileId is validated against live data (profile existence +
      // "not already linked elsewhere") here, not in the zod schema, since
      // that needs a DB read. Explicit null unlinks; undefined leaves as-is.
      if (input.linkedProfileId !== undefined && input.linkedProfileId !== null) {
        const [profile] = await tx.select({ id: profilesTable.id })
          .from(profilesTable).where(eq(profilesTable.id, input.linkedProfileId)).limit(1);
        if (!profile) return { profileNotFound: true as const };

        const conflictingRows = await tx.select({ id: resourcesTable.id })
          .from(resourcesTable).where(eq(resourcesTable.linkedProfileId, input.linkedProfileId));
        const conflicting = conflictingRows.filter(r => r.id !== id);
        if (conflicting.length > 0) {
          return { conflict: conflicting[0]!.id };
        }
      }

      const updates: Partial<typeof resourcesTable.$inferInsert> = {};
      if (input.name !== undefined) { updates.name = input.name; updates.normalizedName = normalizePersonName(input.name); }
      if (input.phone !== undefined) updates.phone = input.phone;
      if (input.email !== undefined) updates.email = input.email;
      if (input.languages !== undefined) updates.languages = input.languages;
      if (input.company !== undefined) updates.company = input.company;
      if (input.licenseNumber !== undefined) updates.licenseNumber = input.licenseNumber;
      if (input.notes !== undefined) updates.notes = input.notes;
      if (input.active !== undefined) updates.active = input.active;
      if (input.linkedProfileId !== undefined) updates.linkedProfileId = input.linkedProfileId;

      const changedFields = diffChangedFields(current, updates);
      let updated = current;
      if (changedFields.length > 0) {
        [updated] = await tx.update(resourcesTable).set(updates).where(eq(resourcesTable.id, id)).returning();

        await createAuditLog({
          eventType: "personnel_updated",
          actorProfileId: res.locals.profile.id,
          module: "personnel",
          entityType: "resource",
          entityId: id,
          metadata: { changedFields },
          description: "Personel kaydı güncellendi",
        }, tx);
      }

      return { updated };
    });

    if ("notFound" in result) {
      res.status(404).json({ error: "Personel bulunamadı" });
      return;
    }
    if ("profileNotFound" in result) {
      res.status(400).json({ error: "Belirtilen profil bulunamadı" });
      return;
    }
    if ("conflict" in result) {
      res.status(409).json({
        error: "Bu profil zaten başka bir personel kaydına bağlı",
        conflictingResourceId: result.conflict,
      });
      return;
    }
    res.json(result.updated);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Bu profil zaten başka bir personel kaydına bağlı" });
      return;
    }
    req.log?.error({ err }, "personnel update failed");
    res.status(500).json({ error: "Personel güncellenemedi" });
  }
});

// ── Aliases ────────────────────────────────────────────────────────────
//
// Adding an alias never merges, never creates a Resource, and never
// resolves ambiguity — it only records one more known spelling for an
// already-existing Resource that a human has already identified.

router.post("/:id/aliases", requirePermission("personnel", "update"), async (req: Request, res: Response) => {
  try {
    const resourceId = parseInt(paramStr(req.params["id"]), 10);
    if (!Number.isSafeInteger(resourceId) || resourceId < 1) {
      res.status(400).json({ error: "Geçersiz ID" });
      return;
    }
    const parsed = resourceAliasCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Geçersiz alanlar", issues: parsed.error.issues });
      return;
    }
    const { source, alias } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [resource] = await tx.select({ id: resourcesTable.id }).from(resourcesTable)
        .where(eq(resourcesTable.id, resourceId)).for("update");
      if (!resource) return { notFound: true as const };

      const [row] = await tx.insert(resourceAliasesTable).values({
        resourceId,
        source,
        alias,
        normalizedAlias: normalizePersonName(alias),
      }).returning();

      await createAuditLog({
        eventType: "personnel_alias_added",
        actorProfileId: res.locals.profile.id,
        module: "personnel",
        entityType: "resource",
        entityId: resourceId,
        newValue: { source, alias },
        description: "Personel takma adı eklendi",
      }, tx);

      return { row };
    });

    if ("notFound" in result) {
      res.status(404).json({ error: "Personel bulunamadı" });
      return;
    }
    res.status(201).json(result.row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Bu takma ad zaten bu personel için kayıtlı" });
      return;
    }
    req.log?.error({ err }, "personnel alias create failed");
    res.status(500).json({ error: "Takma ad eklenemedi" });
  }
});

router.delete("/:id/aliases/:aliasId", requirePermission("personnel", "update"), async (req: Request, res: Response) => {
  try {
    const resourceId = parseInt(paramStr(req.params["id"]), 10);
    const aliasId = parseInt(paramStr(req.params["aliasId"]), 10);
    if (!Number.isSafeInteger(resourceId) || !Number.isSafeInteger(aliasId)) {
      res.status(400).json({ error: "Geçersiz ID" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [deleted] = await tx.delete(resourceAliasesTable)
        .where(and(eq(resourceAliasesTable.id, aliasId), eq(resourceAliasesTable.resourceId, resourceId)))
        .returning();
      if (!deleted) return { notFound: true as const };

      await createAuditLog({
        eventType: "personnel_alias_removed",
        actorProfileId: res.locals.profile.id,
        module: "personnel",
        entityType: "resource",
        entityId: resourceId,
        oldValue: { source: deleted.source, alias: deleted.alias },
        description: "Personel takma adı silindi",
      }, tx);

      return { deleted };
    });

    if ("notFound" in result) {
      res.status(404).json({ error: "Takma ad bulunamadı" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log?.error({ err }, "personnel alias delete failed");
    res.status(500).json({ error: "Takma ad silinemedi" });
  }
});

export default router;
