import { operationDetailRead } from "../lib/operation-detail-read";
/**
 * /api/field/* — Field Operations Center
 *
 * Accessible to: field_operations, operations, admin, super_admin
 * Guide role is explicitly denied.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  operationsTable,
  operationTasksTable,
  operationReceiptsTable,
  operationStatusHistoryTable,
  fieldIncidentsTable,
  operationFieldNotesTable,
  operationLocationsTable,
  profilesTable,
  toursTable,
  customersTable,
  resourcesTable,
} from "@workspace/db/schema";
import {
  eq, desc, asc, and, or, gte, lte, sql, isNull, ne, not, like,
} from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";
import { replayIdempotentResponse, rememberIdempotentResponse } from "../lib/idempotency";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { createAuditLog } from "../lib/audit";
import { createNotification as createNotificationEntry } from "../lib/notifications";
import { hasPermission } from "../lib/permissions";
import { validateAssignmentCandidate, scanResourceConflicts } from "../lib/operation-assignment";
import multer from "multer";
import type { Request, Response } from "express";

const router = Router();
router.use(requireAuth);

/** Narrows an Express route param (string | string[]) to a plain string. */
function paramStr(v: string | string[]): string {
  return Array.isArray(v) ? (v[0] ?? "") : v;
}


const objectStorageService = new ObjectStorageService();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function plusDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// Thin wrapper over the shared helper in lib/notifications.ts, which owns both
// the DB row and Web Push delivery. Kept as a local function so the four
// call sites below (and notifyRoles) keep their existing positional signature.
async function createNotification(
  recipientProfileId: number | null,
  type: string,
  title: string,
  message: string,
  relatedId?: number,
) {
  if (!recipientProfileId) return;
  await createNotificationEntry({
    profileId: recipientProfileId,
    type,
    title,
    message,
    relatedId,
  });
}

// Notify all users with relevant roles about an operation event
async function notifyRoles(
  roles: string[],
  type: string,
  title: string,
  message: string,
  relatedId?: number,
) {
  try {
    const profiles = await db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(
        and(
          eq(profilesTable.isActive, true),
          not(like(profilesTable.clerkUserId, "pending-%")),
          sql`${profilesTable.role} = ANY(ARRAY[${sql.raw(roles.map(r => `'${r}'`).join(","))}]::text[])`,
        ),
      );
    for (const p of profiles) {
      await createNotification(p.id, type, title, message, relatedId);
    }
  } catch {
    // best-effort
  }
}

// ── GET /field/dashboard ──────────────────────────────────────────────────────

router.get("/dashboard", requirePermission("field_operations", "view"), async (req: Request, res: Response) => {
  try {
    const today = todayISO();
    const upcoming = plusDays(7);

    // Run all aggregate queries in parallel
    const [
      todayOps,
      activeOps,
      waitingOps,
      missingGuide,
      missingVehicle,
      overdueTaskRows,
      pendingReceipts,
      openIncidents,
      todayOpList,
      upcomingOpList,
      openIncidentList,
    ] = await Promise.all([
      // Total today ops
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operationsTable)
        .where(
          and(
            eq(operationsTable.startDate, today),
            not(sql`${operationsTable.status} = ANY(ARRAY['cancelled','archived']::text[])`),
          ),
        ),
      // Active/in-progress ops (today or spanning today)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operationsTable)
        .where(
          and(
            sql`${operationsTable.status} = ANY(ARRAY['active','started','in_progress']::text[])`,
            lte(operationsTable.startDate, today),
            or(isNull(operationsTable.endDate), gte(operationsTable.endDate, today)),
          ),
        ),
      // Waiting to start today (planned/ready)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operationsTable)
        .where(
          and(
            eq(operationsTable.startDate, today),
            sql`${operationsTable.status} = ANY(ARRAY['planned','ready']::text[])`,
          ),
        ),
      // Missing guide (no guideName or no assignedGuideUserId) for upcoming ops
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operationsTable)
        .where(
          and(
            gte(operationsTable.startDate, today),
            not(sql`${operationsTable.status} = ANY(ARRAY['completed','cancelled','archived']::text[])`),
            or(isNull(operationsTable.guideName), eq(operationsTable.guideName, "")),
          ),
        ),
      // Missing vehicle for upcoming ops
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operationsTable)
        .where(
          and(
            gte(operationsTable.startDate, today),
            not(sql`${operationsTable.status} = ANY(ARRAY['completed','cancelled','archived']::text[])`),
            or(isNull(operationsTable.vehiclePlate), eq(operationsTable.vehiclePlate, "")),
          ),
        ),
      // Overdue tasks
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operationTasksTable)
        .where(
          and(
            lte(operationTasksTable.dueDate, today),
            not(sql`${operationTasksTable.status} = ANY(ARRAY['completed','cancelled']::text[])`),
          ),
        ),
      // Missing docs (receipts pending review)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.reviewStatus, "pending_review")),
      // Open incidents
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(fieldIncidentsTable)
        .where(
          sql`${fieldIncidentsTable.status} = ANY(ARRAY['open','investigating']::text[])`,
        ),
      // Today's operation list
      db
        .select({
          id: operationsTable.id,
          operationType: operationsTable.operationType,
          status: operationsTable.status,
          startDate: operationsTable.startDate,
          endDate: operationsTable.endDate,
          guideName: operationsTable.guideName,
          guidePhone: operationsTable.guidePhone,
          driverName: operationsTable.driverName,
          driverPhone: operationsTable.driverPhone,
          vehiclePlate: operationsTable.vehiclePlate,
          notes: operationsTable.notes,
          completionRate: operationsTable.completionRate,
         version: operationsTable.version,
          tourName: toursTable.name,
          customerName: customersTable.name,
        })
        .from(operationsTable)
        .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
        .leftJoin(customersTable, eq(operationsTable.customerId, customersTable.id))
        .where(
          and(
            eq(operationsTable.startDate, today),
            not(sql`${operationsTable.status} = ANY(ARRAY['archived']::text[])`),
          ),
        )
        .orderBy(asc(operationsTable.id)),
      // Upcoming operation list (next 7 days, not today)
      db
        .select({
          id: operationsTable.id,
          operationType: operationsTable.operationType,
          status: operationsTable.status,
          startDate: operationsTable.startDate,
          endDate: operationsTable.endDate,
          guideName: operationsTable.guideName,
          guidePhone: operationsTable.guidePhone,
          driverName: operationsTable.driverName,
          vehiclePlate: operationsTable.vehiclePlate,
          completionRate: operationsTable.completionRate,
          tourName: toursTable.name,
          customerName: customersTable.name,
        })
        .from(operationsTable)
        .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
        .leftJoin(customersTable, eq(operationsTable.customerId, customersTable.id))
        .where(
          and(
            sql`${operationsTable.startDate} > ${today}`,
            lte(operationsTable.startDate, upcoming),
            not(sql`${operationsTable.status} = ANY(ARRAY['completed','cancelled','archived']::text[])`),
          ),
        )
        .orderBy(asc(operationsTable.startDate))
        .limit(10),
      // Open incidents list
      db
        .select()
        .from(fieldIncidentsTable)
        .where(
          sql`${fieldIncidentsTable.status} = ANY(ARRAY['open','investigating']::text[])`,
        )
        .orderBy(desc(fieldIncidentsTable.createdAt))
        .limit(10),
    ]);

    return res.json({
      kpis: {
        todayTotal: todayOps[0]?.count ?? 0,
        active: activeOps[0]?.count ?? 0,
        waiting: waitingOps[0]?.count ?? 0,
        missingGuide: missingGuide[0]?.count ?? 0,
        missingVehicle: missingVehicle[0]?.count ?? 0,
        overdueTask: overdueTaskRows[0]?.count ?? 0,
        missingDoc: pendingReceipts[0]?.count ?? 0,
        openIncident: openIncidents[0]?.count ?? 0,
      },
      todayOperations: todayOpList,
      upcomingOperations: upcomingOpList,
      openIncidents: openIncidentList,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Saha paneli yüklenemedi" });
  }
});

// ── GET /field/operations ─────────────────────────────────────────────────────

router.get("/operations", requirePermission("field_operations", "view"), async (req: Request, res: Response) => {
  try {
    const today = todayISO();
    const upcoming = plusDays(14);

    const rows = await db
      .select({
        id: operationsTable.id,
        status: operationsTable.status,
        startDate: operationsTable.startDate,
        endDate: operationsTable.endDate,
        guideName: operationsTable.guideName,
        guidePhone: operationsTable.guidePhone,
        driverName: operationsTable.driverName,
        driverPhone: operationsTable.driverPhone,
        vehiclePlate: operationsTable.vehiclePlate,
        notes: operationsTable.notes,
        completionRate: operationsTable.completionRate,
        tourName: toursTable.name,
        customerName: customersTable.name,
      })
      .from(operationsTable)
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .leftJoin(customersTable, eq(operationsTable.customerId, customersTable.id))
      .where(
        and(
          lte(operationsTable.startDate, upcoming),
          not(sql`${operationsTable.status} = ANY(ARRAY['archived']::text[])`),
        ),
      )
      .orderBy(desc(operationsTable.startDate));

    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Operasyon listesi yüklenemedi" });
  }
});

// ── GET /field/operations/:id ─────────────────────────────────────────────────

router.get("/operations/:id", requirePermission("field_operations", "view"), async (req: Request, res: Response) => {
  try {
    const opId = parseInt(paramStr(req.params["id"]), 10);
    if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz ID" });

    const [op] = await db
      .select({
        id: operationsTable.id,
        operationType: operationsTable.operationType,
        status: operationsTable.status,
        startDate: operationsTable.startDate,
        endDate: operationsTable.endDate,
        guideName: operationsTable.guideName,
        guidePhone: operationsTable.guidePhone,
        driverName: operationsTable.driverName,
        driverPhone: operationsTable.driverPhone,
        vehiclePlate: operationsTable.vehiclePlate,
        assignedGuideUserId: operationsTable.assignedGuideUserId,
        // Phase 2C: canonical Personnel/Resource identity FK, additive.
        guideResourceId: operationsTable.guideResourceId,
        driverResourceId: operationsTable.driverResourceId,
        emergencyContact1Name: operationsTable.emergencyContact1Name,
        emergencyContact1Phone: operationsTable.emergencyContact1Phone,
        emergencyContact2Name: operationsTable.emergencyContact2Name,
        emergencyContact2Phone: operationsTable.emergencyContact2Phone,
        notes: operationsTable.notes,
        completionRate: operationsTable.completionRate,
        tourName: toursTable.name,
        customerName: customersTable.name,
        tourId: operationsTable.tourId,
        customerId: operationsTable.customerId,
        quotationId: operationsTable.quotationId,
         version: operationsTable.version,
      })
      .from(operationsTable)
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .leftJoin(customersTable, eq(operationsTable.customerId, customersTable.id))
      .where(eq(operationsTable.id, opId))
      .limit(1);

    if (!op) return res.status(404).json({ error: "Operasyon bulunamadı" });

    const [tasks, receipts, notes, incidents, history] = await Promise.all([
      db
        .select()
        .from(operationTasksTable)
        .where(eq(operationTasksTable.operationId, opId))
        .orderBy(asc(operationTasksTable.sortOrder)),
      db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.operationId, opId))
        .orderBy(desc(operationReceiptsTable.createdAt)),
      db
        .select()
        .from(operationFieldNotesTable)
        .where(eq(operationFieldNotesTable.operationId, opId))
        .orderBy(desc(operationFieldNotesTable.createdAt)),
      db
        .select()
        .from(fieldIncidentsTable)
        .where(eq(fieldIncidentsTable.operationId, opId))
        .orderBy(desc(fieldIncidentsTable.createdAt)),
      db
        .select()
        .from(operationStatusHistoryTable)
        .where(eq(operationStatusHistoryTable.operationId, opId))
        .orderBy(desc(operationStatusHistoryTable.createdAt))
        .limit(20),
    ]);

    return res.json({ ...op, tasks, receipts, notes, incidents, history });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Operasyon detayı yüklenemedi" });
  }
});

// ── PATCH /field/operations/:id/status ───────────────────────────────────────

router.patch("/operations/:id/status", requirePermission("field_operations", "update"), async (req: Request, res: Response) => {
  try {
    const opId = parseInt(paramStr(req.params["id"]), 10);
    if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz ID" });

    if (await replayIdempotentResponse(req, res)) return;
    const { status, note, expectedVersion } = req.body as { status: string; note?: string; expectedVersion?: number };
    const VALID = ["planned", "ready", "active", "started", "in_progress", "delayed", "completed", "cancelled"];
    if (!status || !VALID.includes(status)) {
      return res.status(400).json({ error: "Geçersiz durum" });
    }

    const profile = res.locals.profile;
    const [current] = await db
      .select({ status: operationsTable.status, version: operationsTable.version })
      .from(operationsTable)
      .where(eq(operationsTable.id, opId))
      .limit(1);

    if (!current) return res.status(404).json({ error: "Operasyon bulunamadı" });
    if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      return res.status(400).json({ error: "Geçersiz operasyon sürümü" });
    }

    const [updated] = await db
      .update(operationsTable)
      .set({ status, version: sql`${operationsTable.version} + 1` })
      .where(and(
        eq(operationsTable.id, opId),
        expectedVersion === undefined ? sql`TRUE` : eq(operationsTable.version, expectedVersion),
      ))
      .returning();
    if (!updated) {
      return res.status(409).json({
        error: "Operasyon sunucuda değişti. Yerel değişiklik uygulanmadı.",
        conflict: { server: current, expectedVersion },
      });
    }
    await db.insert(operationStatusHistoryTable).values({
      operationId: opId,
      fromStatus: current.status,
      toStatus: status,
      actorProfileId: profile?.id ?? null,
      note: note ?? null,
    });

    // Notifications for key transitions
    const STATUS_LABELS: Record<string, string> = {
      started: "Operasyon başladı",
      in_progress: "Operasyon devam ediyor",
      delayed: "Operasyon gecikti",
      completed: "Operasyon tamamlandı",
      cancelled: "Operasyon iptal edildi",
    };
    if (STATUS_LABELS[status]) {
      await notifyRoles(
        ["admin", "operations", "super_admin"],
        "operation",
        STATUS_LABELS[status],
        `OPR-${opId} durumu: ${STATUS_LABELS[status]}`,
        opId,
      );
    }

    const payload = { ...updated, offlineReplay: Boolean(req.get("Idempotency-Key")) };
    await rememberIdempotentResponse(req, res, payload, 200, opId);
    return res.json(payload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Durum güncellenemedi" });
  }
});

// ── PATCH /field/operations/:id/assignments ───────────────────────────────────

router.patch("/operations/:id/assignments", requirePermission("field_operations", "update"), async (req: Request, res: Response) => {
  try {
    const opId = parseInt(paramStr(req.params["id"]), 10);
    if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz ID" });

    const {
      guideName,
      guidePhone,
      assignedGuideUserId,
      driverName,
      driverPhone,
      vehiclePlate,
      guideResourceId,
      driverResourceId,
    } = req.body as {
      guideName?: string;
      guidePhone?: string;
      assignedGuideUserId?: string;
      driverName?: string;
      driverPhone?: string;
      vehiclePlate?: string;
      // Phase 2C: canonical Personnel/Resource assignment (GUIDE/DRIVER).
      // Optional and independent of assignedGuideUserId (login access) —
      // see operation-assignment.ts's module doc. `null` means "unassign
      // the canonical resource"; `undefined`/absent means "leave as-is".
      guideResourceId?: number | null;
      driverResourceId?: number | null;
    };

    // Phase 2C safety-review fix: the whole read-check-write sequence below
    // (load operation, validate resource, scan conflicts, update, audit) now
    // runs in one db.transaction — same convention as resources.ts / the
    // historical-migration-* files — instead of as separate unguarded
    // statements. Two protections, matching the codebase's own dual-layer
    // precedent in historical-migration-promote.ts:
    //  1. pg_advisory_xact_lock(2026, 8) — a dedicated key (existing keys:
    //     3=historical staging, 4=historical promotion, 5=customer-link,
    //     6=pickup-time-correction, 7=source-evidence-loader), serializing
    //     ALL concurrent canonical assignment mutations globally. This is
    //     what actually closes the race the row lock below cannot: two
    //     different operations (different rows) both racing to claim the
    //     same resource for overlapping dates never interleave their
    //     conflict-scan-then-write, because the second transaction cannot
    //     even begin its scan until the first has committed or rolled back.
    //  2. SELECT ... FOR UPDATE on the target operation's own row, so two
    //     concurrent PATCHes on the SAME operation can't interleave either.
    // Every early exit below returns a plain { error } descriptor instead of
    // calling res.* from inside the transaction callback, so the response is
    // sent exactly once, after the transaction has actually committed (or
    // rolled back) — never before, and never twice.
    type AssignmentTxResult =
      | { error: { status: number; body: Record<string, unknown> } }
      | { updated: typeof operationsTable.$inferSelect; warnings: string[]; notify: boolean };

    const result = await db.transaction(async (tx): Promise<AssignmentTxResult> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(2026, 8)`);

      const [op] = await tx
        .select()
        .from(operationsTable)
        .where(eq(operationsTable.id, opId))
        .for("update");
      if (!op) return { error: { status: 404, body: { error: "Operasyon bulunamadı" } } };

      // Phase 2C: assigning/changing/removing a canonical Resource is a
      // stricter capability than the legacy free-text fields this endpoint
      // already accepts — gated on the existing, previously-unused
      // operations.assign permission (see seed-permissions.ts) rather than
      // widening field_operations.update's existing meaning. Only enforced
      // when the caller actually touches these two fields, so every existing
      // legacy-only assignment request behaves exactly as before.
      if (guideResourceId !== undefined || driverResourceId !== undefined) {
        const canAssign = await hasPermission(res.locals.profile.id, res.locals.profile.role, "operations", "assign");
        if (!canAssign) {
          return { error: { status: 403, body: { error: "Personel ataması için yetkiniz bulunmamaktadır." } } };
        }
      }

      // Conflict checks
      const warnings: string[] = [];

      if (assignedGuideUserId && op.startDate && op.endDate) {
        const guideConflicts = await tx
          .select({ id: operationsTable.id })
          .from(operationsTable)
          .where(
            and(
              eq(operationsTable.assignedGuideUserId, assignedGuideUserId),
              ne(operationsTable.id, opId),
              not(sql`${operationsTable.status} = ANY(ARRAY['completed','cancelled','archived']::text[])`),
              lte(operationsTable.startDate, op.endDate),
              gte(operationsTable.endDate, op.startDate),
            ),
          );
        if (guideConflicts.length > 0) {
          return {
            error: {
              status: 409,
              body: { error: `Rehber ${guideName ?? "seçilen"} aynı tarihlerde başka bir operasyona atanmış durumda (OPR-${guideConflicts[0]?.id}).` },
            },
          };
        }
      }

      if (vehiclePlate && op.startDate && op.endDate) {
        const vehicleConflicts = await tx
          .select({ id: operationsTable.id })
          .from(operationsTable)
          .where(
            and(
              eq(operationsTable.vehiclePlate, vehiclePlate),
              ne(operationsTable.id, opId),
              not(sql`${operationsTable.status} = ANY(ARRAY['completed','cancelled','archived']::text[])`),
              lte(operationsTable.startDate, op.endDate),
              gte(operationsTable.endDate, op.startDate),
            ),
          );
        if (vehicleConflicts.length > 0) {
          warnings.push(`Araç ${vehiclePlate} aynı tarihlerde başka bir operasyonda kullanılıyor (OPR-${vehicleConflicts[0]?.id}).`);
        }
      }

      // Phase 2C: canonical Resource assignment (GUIDE/DRIVER). Validated
      // server-side regardless of what the frontend already checked — see
      // operation-assignment.ts. `null` unassigns (clears the FK only; the
      // legacy guideName/driverName text snapshot is left untouched, which is
      // exactly what makes the record read as LEGACY_ONLY afterwards rather
      // than silently losing its history — see classifyAssignmentState).
      let resolvedGuideResource: { id: number; name: string; phone: string | null } | null = null;
      let resolvedDriverResource: { id: number; name: string; phone: string | null } | null = null;

      if (guideResourceId != null) {
        const [candidate] = await tx.select({ id: resourcesTable.id, type: resourcesTable.type, active: resourcesTable.active, name: resourcesTable.name, phone: resourcesTable.phone })
          .from(resourcesTable).where(eq(resourcesTable.id, guideResourceId)).limit(1);
        const verdict = validateAssignmentCandidate(candidate, "GUIDE");
        if (!verdict.ok) return { error: { status: 400, body: { error: verdict.error, code: verdict.code } } };
        resolvedGuideResource = candidate!;

        const guideResourceOthers = await tx.select({ id: operationsTable.id, startDate: operationsTable.startDate, endDate: operationsTable.endDate, status: operationsTable.status })
          .from(operationsTable).where(and(eq(operationsTable.guideResourceId, guideResourceId), ne(operationsTable.id, opId)));
        const guideScan = scanResourceConflicts(
          { id: opId, startDate: op.startDate, endDate: op.endDate, status: op.status },
          guideResourceOthers,
        );
        if (guideScan.conflicts.length > 0) {
          return {
            error: {
              status: 409,
              body: { error: `${candidate!.name} aynı tarihlerde başka bir operasyona rehber olarak atanmış durumda (OPR-${guideScan.conflicts[0]!.id}).` },
            },
          };
        }
        for (const other of guideScan.indeterminate) {
          warnings.push(`${candidate!.name} için OPR-${other.id} ile tarih çakışması, tarih bilgisi eksik olduğundan doğrulanamadı.`);
        }
      }

      if (driverResourceId != null) {
        const [candidate] = await tx.select({ id: resourcesTable.id, type: resourcesTable.type, active: resourcesTable.active, name: resourcesTable.name, phone: resourcesTable.phone })
          .from(resourcesTable).where(eq(resourcesTable.id, driverResourceId)).limit(1);
        const verdict = validateAssignmentCandidate(candidate, "DRIVER");
        if (!verdict.ok) return { error: { status: 400, body: { error: verdict.error, code: verdict.code } } };
        resolvedDriverResource = candidate!;

        const driverResourceOthers = await tx.select({ id: operationsTable.id, startDate: operationsTable.startDate, endDate: operationsTable.endDate, status: operationsTable.status })
          .from(operationsTable).where(and(eq(operationsTable.driverResourceId, driverResourceId), ne(operationsTable.id, opId)));
        const driverScan = scanResourceConflicts(
          { id: opId, startDate: op.startDate, endDate: op.endDate, status: op.status },
          driverResourceOthers,
        );
        if (driverScan.conflicts.length > 0) {
          return {
            error: {
              status: 409,
              body: { error: `${candidate!.name} aynı tarihlerde başka bir operasyona şoför olarak atanmış durumda (OPR-${driverScan.conflicts[0]!.id}).` },
            },
          };
        }
        for (const other of driverScan.indeterminate) {
          warnings.push(`${candidate!.name} için OPR-${other.id} ile tarih çakışması, tarih bilgisi eksik olduğundan doğrulanamadı.`);
        }
      }

      const updates: Partial<typeof operationsTable.$inferInsert> = {};
      if (guideName !== undefined) updates.guideName = guideName;
      if (guidePhone !== undefined) updates.guidePhone = guidePhone;
      if (assignedGuideUserId !== undefined) updates.assignedGuideUserId = assignedGuideUserId;
      if (driverName !== undefined) updates.driverName = driverName;
      if (driverPhone !== undefined) updates.driverPhone = driverPhone;
      if (vehiclePlate !== undefined) updates.vehiclePlate = vehiclePlate;
      if (guideResourceId !== undefined) {
        updates.guideResourceId = guideResourceId;
        // Snapshot the resource's display name/phone into the legacy text
        // columns — same "write both together" precedent already established
        // by routes/sheet-import.ts's exact-match resolution — but only when
        // the caller did not already send an explicit guideName/guidePhone of
        // their own in this same request (an explicit human-typed value always
        // wins over the auto-snapshot).
        if (resolvedGuideResource && guideName === undefined) updates.guideName = resolvedGuideResource.name;
        if (resolvedGuideResource && guidePhone === undefined) updates.guidePhone = resolvedGuideResource.phone ?? null;
      }
      if (driverResourceId !== undefined) {
        updates.driverResourceId = driverResourceId;
        if (resolvedDriverResource && driverName === undefined) updates.driverName = resolvedDriverResource.name;
        if (resolvedDriverResource && driverPhone === undefined) updates.driverPhone = resolvedDriverResource.phone ?? null;
      }

      const [updated] = await tx
        .update(operationsTable)
        .set(updates)
        .where(eq(operationsTable.id, opId))
        .returning();

      const profile = res.locals.profile;

      // Audit trail — guide assignment change
      if (guideName !== undefined && guideName !== (op.guideName ?? "")) {
        const description = !op.guideName && guideName
          ? `Rehber ${guideName} olarak atandı.`
          : op.guideName && !guideName
            ? "Rehber ataması kaldırıldı."
            : `Rehber ${guideName} olarak değiştirildi.`;
        await createAuditLog({
          eventType: !op.guideName && guideName ? "guide_assigned" : !guideName ? "guide_unassigned" : "guide_changed",
          actorProfileId: profile.id,
          oldValue: { guideName: op.guideName, assignedGuideUserId: op.assignedGuideUserId },
          newValue: { guideName, assignedGuideUserId: assignedGuideUserId ?? op.assignedGuideUserId },
          module: "operations",
          entityType: "operation",
          entityId: opId,
          description,
        }, tx);
      }

      // Audit trail — driver assignment change
      if (driverName !== undefined && driverName !== (op.driverName ?? "")) {
        const description = !op.driverName && driverName
          ? `Şoför ${driverName} olarak atandı.`
          : op.driverName && !driverName
            ? "Şoför ataması kaldırıldı."
            : `Şoför ${driverName} olarak değiştirildi.`;
        await createAuditLog({
          eventType: !op.driverName && driverName ? "driver_assigned" : !driverName ? "driver_unassigned" : "driver_changed",
          actorProfileId: profile.id,
          oldValue: { driverName: op.driverName, driverPhone: op.driverPhone },
          newValue: { driverName, driverPhone: driverPhone ?? op.driverPhone },
          module: "operations",
          entityType: "operation",
          entityId: opId,
          description,
        }, tx);
      }

      // Audit trail — canonical guide Resource assignment change (Phase 2C).
      // Deliberately a distinct eventType from guide_assigned/guide_changed
      // above: that pair tracks the legacy text column, this pair tracks the
      // canonical identity FK, and the two are allowed to change independently.
      if (guideResourceId !== undefined && guideResourceId !== (op.guideResourceId ?? null)) {
        const description = op.guideResourceId == null && guideResourceId != null
          ? `Rehber personeli ${resolvedGuideResource?.name ?? guideResourceId} olarak atandı.`
          : op.guideResourceId != null && guideResourceId == null
            ? "Rehber personel ataması kaldırıldı."
            : `Rehber personeli ${resolvedGuideResource?.name ?? guideResourceId} olarak değiştirildi.`;
        await createAuditLog({
          eventType: op.guideResourceId == null && guideResourceId != null ? "guide_resource_assigned"
            : guideResourceId == null ? "guide_resource_unassigned" : "guide_resource_changed",
          actorProfileId: profile.id,
          oldValue: { guideResourceId: op.guideResourceId },
          newValue: { guideResourceId },
          module: "operations",
          entityType: "operation",
          entityId: opId,
          description,
        }, tx);
      }

      // Audit trail — canonical driver Resource assignment change (Phase 2C).
      if (driverResourceId !== undefined && driverResourceId !== (op.driverResourceId ?? null)) {
        const description = op.driverResourceId == null && driverResourceId != null
          ? `Şoför personeli ${resolvedDriverResource?.name ?? driverResourceId} olarak atandı.`
          : op.driverResourceId != null && driverResourceId == null
            ? "Şoför personel ataması kaldırıldı."
            : `Şoför personeli ${resolvedDriverResource?.name ?? driverResourceId} olarak değiştirildi.`;
        await createAuditLog({
          eventType: op.driverResourceId == null && driverResourceId != null ? "driver_resource_assigned"
            : driverResourceId == null ? "driver_resource_unassigned" : "driver_resource_changed",
          actorProfileId: profile.id,
          oldValue: { driverResourceId: op.driverResourceId },
          newValue: { driverResourceId },
          module: "operations",
          entityType: "operation",
          entityId: opId,
          description,
        }, tx);
      }

      return {
        updated: updated!,
        warnings,
        notify: assignedGuideUserId !== undefined || driverName !== undefined,
      };
    });

    if ("error" in result) {
      return res.status(result.error.status).json(result.error.body);
    }

    // Notify about assignment change — fired only after the transaction
    // above has actually committed, so a rolled-back mutation never produces
    // a notification about a change that didn't happen.
    if (result.notify) {
      await notifyRoles(
        ["admin", "operations", "field_operations", "super_admin"],
        "operation",
        "Atama değiştirildi",
        `OPR-${opId} rehber/şoför ataması güncellendi`,
        opId,
      );
    }

    return res.json({ ...result.updated, warnings: result.warnings });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Atama güncellenemedi" });
  }
});

// ── PATCH /field/operations/:id/tasks/:taskId ─────────────────────────────────

router.patch("/operations/:id/tasks/:taskId", requirePermission("field_operations", "update"), async (req: Request, res: Response) => {
  try {
    const opId = parseInt(paramStr(req.params["id"]), 10);
    const taskId = parseInt(paramStr(req.params["taskId"]), 10);
    if (isNaN(opId) || isNaN(taskId)) return res.status(400).json({ error: "Geçersiz ID" });

    if (await replayIdempotentResponse(req, res)) return;
    const { status, completionNote, expectedVersion } = req.body as { status?: string; completionNote?: string; expectedVersion?: number };
    const VALID_TASK_STATUS = ["pending", "in_progress", "completed", "blocked", "not_started", "cancelled"];
    if (status && !VALID_TASK_STATUS.includes(status)) {
      return res.status(400).json({ error: "Geçersiz görev durumu" });
    }

    const updates: Partial<typeof operationTasksTable.$inferInsert> = {};
    if (status) updates.status = status;
    if (completionNote !== undefined) updates.description = completionNote;
    if (status === "completed") updates.completedAt = new Date();

    if (expectedVersion !== undefined) {
      const [versioned] = await db
        .update(operationsTable)
        .set({ version: sql`${operationsTable.version} + 1` })
        .where(and(eq(operationsTable.id, opId), eq(operationsTable.version, expectedVersion)))
        .returning({ version: operationsTable.version });
      if (!versioned) return res.status(409).json({ error: "Operasyon sunucuda değişti. Görev uygulanmadı.", conflict: { expectedVersion } });
      const [updated] = await db
        .update(operationTasksTable)
        .set(updates)
        .where(and(eq(operationTasksTable.id, taskId), eq(operationTasksTable.operationId, opId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Görev bulunamadı" });
      const payload = { ...updated, version: versioned.version };
      await rememberIdempotentResponse(req, res, payload, 200, opId);
      return res.json(payload);
    }
    const [updated] = await db
      .update(operationTasksTable)
      .set(updates)
      .where(and(eq(operationTasksTable.id, taskId), eq(operationTasksTable.operationId, opId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Görev bulunamadı" });
    return res.json(updated);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Görev güncellenemedi" });
  }
});

// ── POST /field/operations/:id/tasks ─────────────────────────────────────────

router.post("/operations/:id/tasks", requirePermission("field_operations", "create"), async (req: Request, res: Response) => {
  try {
    const opId = parseInt(paramStr(req.params["id"]), 10);
    if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz ID" });

    const { title, description, assignedTo, dueDate, priority } = req.body as {
      title: string;
      description?: string;
      assignedTo?: string;
      dueDate?: string;
      priority?: string;
    };
    if (!title?.trim()) return res.status(400).json({ error: "Başlık zorunludur" });

    const [task] = await db
      .insert(operationTasksTable)
      .values({
        operationId: opId,
        title: title.trim(),
        description: description ?? null,
        assignedTo: assignedTo ?? null,
        dueDate: dueDate ?? null,
        priority: priority ?? "medium",
        status: "pending",
      })
      .returning();

    return res.status(201).json(task);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Görev eklenemedi" });
  }
});

// ── GET /field/operations/:id/notes ──────────────────────────────────────────

router.get("/operations/:id/notes", requirePermission("field_operations", "view"), async (req: Request, res: Response) => {
  try {
    const opId = parseInt(paramStr(req.params["id"]), 10);
    if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz ID" });

    const notes = await db
      .select({
        id: operationFieldNotesTable.id,
        operationId: operationFieldNotesTable.operationId,
        noteText: operationFieldNotesTable.noteText,
        category: operationFieldNotesTable.category,
        authorProfileId: operationFieldNotesTable.authorProfileId,
        photoObjectPath: operationFieldNotesTable.photoObjectPath,
        createdAt: operationFieldNotesTable.createdAt,
        authorName: profilesTable.name,
      })
      .from(operationFieldNotesTable)
      .leftJoin(profilesTable, eq(operationFieldNotesTable.authorProfileId, profilesTable.id))
      .where(eq(operationFieldNotesTable.operationId, opId))
      .orderBy(desc(operationFieldNotesTable.createdAt));

    return res.json(notes);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Notlar yüklenemedi" });
  }
});

// ── POST /field/operations/:id/notes ─────────────────────────────────────────

router.post(
  "/operations/:id/notes",
  requirePermission("field_operations", "create"),
  upload.single("photo"),
  async (req: Request, res: Response) => {
    try {
      const opId = parseInt(paramStr(req.params["id"]), 10);
      if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz ID" });
      if (await replayIdempotentResponse(req, res)) return;

      const { noteText, category } = req.body as { noteText: string; category?: string };
      if (!noteText?.trim()) return res.status(400).json({ error: "Not metni zorunludur" });

      const VALID_CATS = ["general", "customer", "guide", "driver", "supplier", "delay", "incident"];
      const cat = category && VALID_CATS.includes(category) ? category : "general";

      const profile = res.locals.profile;
      let photoObjectPath: string | null = null;

      if (req.file) {
        const ext = req.file.mimetype.split("/")[1] ?? "jpg";
        const key = `field-notes/op-${opId}/${Date.now()}.${ext}`;
        photoObjectPath = await objectStorageService.uploadFile(key, req.file.buffer, req.file.mimetype);
      }

      const [note] = await db
        .insert(operationFieldNotesTable)
        .values({
          operationId: opId,
          noteText: noteText.trim(),
          category: cat,
          authorProfileId: profile?.id ?? null,
          photoObjectPath,
        })
        .returning();

      const payload = { ...note, authorName: profile?.name ?? null, offlineReplay: Boolean(req.get("Idempotency-Key")) };
      await rememberIdempotentResponse(req, res, payload, 201, opId);
      return res.status(201).json(payload);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Not eklenemedi" });
    }
  },
);

// ── GET /field/guides ─────────────────────────────────────────────────────────
// Lists active guide profiles for assignment picker

router.get("/guides", requirePermission("field_operations", "view"), async (req: Request, res: Response) => {
  try {
    const today = todayISO();

    const guides = await db
      .select({
        id: profilesTable.id,
        clerkUserId: profilesTable.clerkUserId,
        name: profilesTable.name,
        email: profilesTable.email,
      })
      .from(profilesTable)
      .where(
        and(
          eq(profilesTable.role, "guide"),
          eq(profilesTable.isActive, true),
          not(like(profilesTable.clerkUserId, "pending-%")),
        ),
      )
      .orderBy(asc(profilesTable.name));

    // Enrich with today's operation count (workload indicator)
    const workloadRows = await db
      .select({
        userId: operationsTable.assignedGuideUserId,
        count: sql<number>`count(*)::int`,
      })
      .from(operationsTable)
      .where(
        and(
          eq(operationsTable.startDate, today),
          not(sql`${operationsTable.status} = ANY(ARRAY['completed','cancelled','archived']::text[])`),
          not(isNull(operationsTable.assignedGuideUserId)),
        ),
      )
      .groupBy(operationsTable.assignedGuideUserId);

    const workloadMap = new Map(workloadRows.map(r => [r.userId, r.count]));

    return res.json(
      guides.map(g => ({
        ...g,
        todayOperationCount: workloadMap.get(g.clerkUserId) ?? 0,
      })),
    );
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Rehber listesi yüklenemedi" });
  }
});

// ── GET /field/incidents ──────────────────────────────────────────────────────

router.get("/incidents", requirePermission("incidents", "view"), async (req: Request, res: Response) => {
  try {
    const { status, severity } = req.query as { status?: string; severity?: string };

    let conditions = [];
    if (status) conditions.push(eq(fieldIncidentsTable.status, status));
    if (severity) conditions.push(eq(fieldIncidentsTable.severity, severity));

    const rows = await db
      .select({
        id: fieldIncidentsTable.id,
        operationId: fieldIncidentsTable.operationId,
        type: fieldIncidentsTable.type,
        severity: fieldIncidentsTable.severity,
        title: fieldIncidentsTable.title,
        description: fieldIncidentsTable.description,
        status: fieldIncidentsTable.status,
        reportedByProfileId: fieldIncidentsTable.reportedByProfileId,
        assignedToProfileId: fieldIncidentsTable.assignedToProfileId,
        occurredAt: fieldIncidentsTable.occurredAt,
        resolvedAt: fieldIncidentsTable.resolvedAt,
        resolutionNote: fieldIncidentsTable.resolutionNote,
        createdAt: fieldIncidentsTable.createdAt,
        operationTourName: toursTable.name,
      })
      .from(fieldIncidentsTable)
      .leftJoin(operationsTable, eq(fieldIncidentsTable.operationId, operationsTable.id))
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(fieldIncidentsTable.createdAt));

    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Olaylar yüklenemedi" });
  }
});

// ── POST /field/incidents ─────────────────────────────────────────────────────

router.post(
  "/incidents",
  requirePermission("incidents", "upload"),
  upload.single("photo"),
  async (req: Request, res: Response) => {
    try {
      const {
        operationId,
        type,
        severity,
        title,
        description,
        occurredAt,
      } = req.body as {
        operationId?: string;
        type: string;
        severity: string;
        title: string;
        description?: string;
        occurredAt?: string;
      };

      if (!title?.trim()) return res.status(400).json({ error: "Başlık zorunludur" });
      if (await replayIdempotentResponse(req, res)) return;

      const VALID_TYPES = ["medical", "vehicle", "delay", "missing_person", "customer_complaint", "supplier", "document", "other"];
      const VALID_SEV = ["low", "medium", "high", "critical"];
      if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: "Geçersiz olay türü" });
      if (!VALID_SEV.includes(severity)) return res.status(400).json({ error: "Geçersiz önem derecesi" });

      const profile = res.locals.profile;
      let photoObjectPath: string | null = null;

      if (req.file) {
        const ext = req.file.mimetype.split("/")[1] ?? "jpg";
        const key = `field-incidents/${Date.now()}.${ext}`;
        photoObjectPath = await objectStorageService.uploadFile(key, req.file.buffer, req.file.mimetype);
      }

      const [incident] = await db
        .insert(fieldIncidentsTable)
        .values({
          operationId: operationId ? parseInt(operationId, 10) : null,
          type,
          severity,
          title: title.trim(),
          description: description ?? null,
          status: "open",
          reportedByProfileId: profile?.id ?? null,
          occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
          photoObjectPath,
        })
        .returning();

      // Notify for critical or high severity
      if (severity === "critical" || severity === "high") {
        await notifyRoles(
          ["admin", "operations", "field_operations", "super_admin"],
          "operation",
          severity === "critical" ? "🚨 KRİTİK OLAY" : "⚠️ Yüksek Öncelikli Olay",
          `${title}: ${description ?? "Detay yok"} (OPR-${operationId ?? "?"})`,
          incident.id,
        );
      }

      const payload = { ...incident, offlineReplay: Boolean(req.get("Idempotency-Key")) };
      await rememberIdempotentResponse(req, res, payload, 201, operationId ? parseInt(operationId, 10) : null);
      return res.status(201).json(payload);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Olay bildirilemedi" });
    }
  },
);

// ── GET /field/incidents/:id ──────────────────────────────────────────────────

router.get("/incidents/:id", requirePermission("incidents", "view"), async (req: Request, res: Response) => {
  try {
    const incId = parseInt(paramStr(req.params["id"]), 10);
    if (isNaN(incId)) return res.status(400).json({ error: "Geçersiz ID" });

    const [row] = await db
      .select({
        id: fieldIncidentsTable.id,
        operationId: fieldIncidentsTable.operationId,
        type: fieldIncidentsTable.type,
        severity: fieldIncidentsTable.severity,
        title: fieldIncidentsTable.title,
        description: fieldIncidentsTable.description,
        status: fieldIncidentsTable.status,
        reportedByProfileId: fieldIncidentsTable.reportedByProfileId,
        assignedToProfileId: fieldIncidentsTable.assignedToProfileId,
        photoObjectPath: fieldIncidentsTable.photoObjectPath,
        occurredAt: fieldIncidentsTable.occurredAt,
        resolvedAt: fieldIncidentsTable.resolvedAt,
        resolutionNote: fieldIncidentsTable.resolutionNote,
        createdAt: fieldIncidentsTable.createdAt,
        updatedAt: fieldIncidentsTable.updatedAt,
        operationTourName: toursTable.name,
      })
      .from(fieldIncidentsTable)
      .leftJoin(operationsTable, eq(fieldIncidentsTable.operationId, operationsTable.id))
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .where(eq(fieldIncidentsTable.id, incId))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Olay bulunamadı" });
    return res.json(row);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Olay detayı yüklenemedi" });
  }
});

// ── PATCH /field/incidents/:id ────────────────────────────────────────────────

router.patch("/incidents/:id", requirePermission("incidents", "update"), async (req: Request, res: Response) => {
  try {
    const incId = parseInt(paramStr(req.params["id"]), 10);
    if (isNaN(incId)) return res.status(400).json({ error: "Geçersiz ID" });

    const { status, assignedToProfileId, resolutionNote } = req.body as {
      status?: string;
      assignedToProfileId?: number;
      resolutionNote?: string;
    };

    const VALID_STATUS = ["open", "investigating", "resolved", "closed"];
    if (status && !VALID_STATUS.includes(status)) {
      return res.status(400).json({ error: "Geçersiz durum" });
    }

    const updates: Partial<typeof fieldIncidentsTable.$inferInsert> = {};
    if (status) updates.status = status;
    if (assignedToProfileId !== undefined) updates.assignedToProfileId = assignedToProfileId;
    if (resolutionNote !== undefined) updates.resolutionNote = resolutionNote;
    if (status === "resolved" || status === "closed") updates.resolvedAt = new Date();

    const [updated] = await db
      .update(fieldIncidentsTable)
      .set(updates)
      .where(eq(fieldIncidentsTable.id, incId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Olay bulunamadı" });

    if (status === "resolved" || status === "closed") {
      await notifyRoles(
        ["admin", "operations", "field_operations", "super_admin"],
        "operation",
        "Olay çözüldü",
        `OLY-${incId} durumu: ${status === "resolved" ? "Çözüldü" : "Kapatıldı"}`,
        incId,
      );
    }

    return res.json(updated);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Olay güncellenemedi" });
  }
});

// ── Location sharing ──────────────────────────────────────────────────────────

/**
 * POST /field/operations/:id/location
 * Body: { latitude: number, longitude: number, accuracy?: number }
 *
 * Saves the current user's one-shot location for the operation.
 * Accessible to: field_operations, operations, admin, super_admin.
 */
router.post("/operations/:id/location", requirePermission("field_operations", "create"), async (req, res) => {
  const opId = parseInt(paramStr(req.params.id), 10);
  if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz operasyon ID" });

  const { latitude, longitude, accuracy } = req.body ?? {};
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({ error: "latitude ve longitude zorunlu sayısal değerler" });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: "Koordinat değerleri geçersiz aralıkta" });
  }

  const [op] = await db
    .select({ id: operationsTable.id })
    .from(operationsTable)
    .where(eq(operationsTable.id, opId))
    .limit(1);
  if (!op) return res.status(404).json({ error: "Operasyon bulunamadı" });

  const profile = res.locals.profile;

  const [saved] = await db
    .insert(operationLocationsTable)
    .values({
      operationId: opId,
      profileId: profile?.id ?? null,
      latitude,
      longitude,
      accuracy: typeof accuracy === "number" ? accuracy : null,
      capturedAt: new Date(),
    })
    .returning();

  return res.status(201).json(saved);
});

/**
 * GET /field/operations/:id/location
 * Returns the most recent location entry for the operation.
 * Accessible to: field_operations, operations, admin, super_admin.
 */
router.get("/operations/:id/location", requirePermission("field_operations", "view"), async (req, res) => {
  const opId = parseInt(paramStr(req.params.id), 10);
  if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz operasyon ID" });

  const [row] = await db
    .select({
      id: operationLocationsTable.id,
      profileId: operationLocationsTable.profileId,
      latitude: operationLocationsTable.latitude,
      longitude: operationLocationsTable.longitude,
      accuracy: operationLocationsTable.accuracy,
      capturedAt: operationLocationsTable.capturedAt,
      profileName: profilesTable.name,
    })
    .from(operationLocationsTable)
    .leftJoin(profilesTable, eq(operationLocationsTable.profileId, profilesTable.id))
    .where(eq(operationLocationsTable.operationId, opId))
    .orderBy(desc(operationLocationsTable.capturedAt))
    .limit(1);

  if (!row) return res.status(404).json({ error: "Konum verisi bulunamadı" });
  return res.json(row);
});

router.get("/operations/:id/detail", requirePermission("field_operations", "view"), operationDetailRead);

export default router;
