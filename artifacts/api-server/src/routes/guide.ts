import { operationDetailRead } from "../lib/operation-detail-read";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  operationsTable,
  toursTable,
  customersTable,
  operationLocationsTable,
  profilesTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";

const router = Router();
router.use(requireAuth);

/** Narrows an Express route param (string | string[]) to a plain string. */
function paramStr(v: string | string[]): string {
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

/**
 * GET /guide/my-operations
 *
 * Returns the signed-in guide's assigned operations with joined tour and
 * customer data. Restricted to the guide role (admin/super_admin can pass
 * ?guideUserId= for preview/testing).
 *
 * Response array items include:
 *   id, status, startDate, endDate, completionRate,
 *   notes, guideName, guidePhone,
 *   driverName, driverPhone, vehiclePlate,
 *   emergencyContact1Name, emergencyContact1Phone,
 *   emergencyContact2Name, emergencyContact2Phone,
 *   tourName, customerName
 */
router.get(
  "/my-operations",
  requirePermission("guide_workspace", "view"),
  async (req, res) => {
    try {
      const { userId } = getAuth(req);
      const profile = res.locals.profile;
      const role: string = profile?.role;

      let guideUserId: string | null = null;

      if (role === "guide") {
        guideUserId = userId ?? null;
      } else if (role === "admin" || role === "super_admin") {
        guideUserId = (req.query.guideUserId as string) ?? null;
      }

      if (!guideUserId) return res.json([]);

      const rows = await db
        .select({
          id: operationsTable.id,
          status: operationsTable.status,
          startDate: operationsTable.startDate,
          endDate: operationsTable.endDate,
          completionRate: operationsTable.completionRate,
          notes: operationsTable.notes,
          guideName: operationsTable.guideName,
          guidePhone: operationsTable.guidePhone,
          driverName: operationsTable.driverName,
          driverPhone: operationsTable.driverPhone,
          vehiclePlate: operationsTable.vehiclePlate,
          emergencyContact1Name: operationsTable.emergencyContact1Name,
          emergencyContact1Phone: operationsTable.emergencyContact1Phone,
          emergencyContact2Name: operationsTable.emergencyContact2Name,
          emergencyContact2Phone: operationsTable.emergencyContact2Phone,
          tourName: toursTable.name,
          customerName: customersTable.name,
        })
        .from(operationsTable)
        .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
        .leftJoin(customersTable, eq(operationsTable.customerId, customersTable.id))
        .where(eq(operationsTable.assignedGuideUserId, guideUserId))
        .orderBy(desc(operationsTable.startDate));

      return res.json(rows);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Operasyonlar yüklenemedi" });
    }
  }
);

/**
 * GET /guide/my-operations/:id
 *
 * Returns a single guide-owned operation with joined tour/customer data.
 * Enforces that the signed-in guide is the assignedGuideUserId.
 */
router.get(
  "/my-operations/:id",
  requirePermission("guide_workspace", "view"),
  async (req, res) => {
    try {
      const { userId } = getAuth(req);
      const profile = res.locals.profile;
      const role: string = profile?.role;
      const operationId = parseInt(req.params.id as string);

      // Determine whose operations to check
      let guideUserId: string | null = null;
      if (role === "guide") {
        guideUserId = userId ?? null;
      } else if (role === "admin" || role === "super_admin") {
        guideUserId = (req.query.guideUserId as string) ?? null;
      }

      const [row] = await db
        .select({
          id: operationsTable.id,
          status: operationsTable.status,
          startDate: operationsTable.startDate,
          endDate: operationsTable.endDate,
          completionRate: operationsTable.completionRate,
          notes: operationsTable.notes,
          guideName: operationsTable.guideName,
          guidePhone: operationsTable.guidePhone,
          driverName: operationsTable.driverName,
          driverPhone: operationsTable.driverPhone,
          vehiclePlate: operationsTable.vehiclePlate,
          emergencyContact1Name: operationsTable.emergencyContact1Name,
          emergencyContact1Phone: operationsTable.emergencyContact1Phone,
          emergencyContact2Name: operationsTable.emergencyContact2Name,
          emergencyContact2Phone: operationsTable.emergencyContact2Phone,
          assignedGuideUserId: operationsTable.assignedGuideUserId,
          tourName: toursTable.name,
          customerName: customersTable.name,
        })
        .from(operationsTable)
        .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
        .leftJoin(customersTable, eq(operationsTable.customerId, customersTable.id))
        .where(eq(operationsTable.id, operationId))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Operasyon bulunamadı" });

      // Guides may only see their own operation
      if (role === "guide" && row.assignedGuideUserId !== guideUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      return res.json(row);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Operasyon yüklenemedi" });
    }
  }
);

// ── Location sharing ──────────────────────────────────────────────────────────

/**
 * POST /guide/operations/:id/location
 * Guide shares their one-shot GPS position for the given operation.
 * The guide must be the assigned guide for the operation.
 */
router.post(
  "/operations/:id/location",
  requirePermission("guide_workspace", "upload"),
  async (req, res) => {
    const opId = parseInt(paramStr(req.params.id), 10);
    if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz operasyon ID" });

    const { latitude, longitude, accuracy } = req.body ?? {};
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return res.status(400).json({ error: "latitude ve longitude zorunlu sayısal değerler" });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: "Koordinat değerleri geçersiz aralıkta" });
    }

    const { userId } = getAuth(req);
    const profile = res.locals.profile;
    const role = profile?.role;

    const [op] = await db
      .select({ id: operationsTable.id, assignedGuideUserId: operationsTable.assignedGuideUserId })
      .from(operationsTable)
      .where(eq(operationsTable.id, opId))
      .limit(1);
    if (!op) return res.status(404).json({ error: "Operasyon bulunamadı" });

    // Guides may only share location for their own operation
    if (role === "guide" && op.assignedGuideUserId !== userId) {
      return res.status(403).json({ error: "Bu operasyon için konum paylaşamazsınız" });
    }

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
  },
);

/**
 * GET /guide/operations/:id/location
 * Returns the latest shared location for the operation.
 * Only the assigned guide and staff roles may view it.
 */
router.get(
  "/operations/:id/location",
  requirePermission("guide_workspace", "view"),
  async (req, res) => {
    const opId = parseInt(paramStr(req.params.id), 10);
    if (isNaN(opId)) return res.status(400).json({ error: "Geçersiz operasyon ID" });

    const { userId } = getAuth(req);
    const profile = res.locals.profile;
    const role = profile?.role;

    const [op] = await db
      .select({ assignedGuideUserId: operationsTable.assignedGuideUserId })
      .from(operationsTable)
      .where(eq(operationsTable.id, opId))
      .limit(1);
    if (!op) return res.status(404).json({ error: "Operasyon bulunamadı" });

    // Guides may only view location for their own operation
    if (role === "guide" && op.assignedGuideUserId !== userId) {
      return res.status(403).json({ error: "Yetkisiz erişim" });
    }

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
  },
);

router.get("/my-operations/:id/detail", requirePermission("guide_workspace", "view"), operationDetailRead);

export default router;
