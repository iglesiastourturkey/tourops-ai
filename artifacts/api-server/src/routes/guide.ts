import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { operationsTable, toursTable, customersTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth, getProfile, requireAnyRole } from "../lib/auth";

const router = Router();
router.use(requireAuth, getProfile);

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
  requireAnyRole("guide", "admin", "super_admin"),
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
  requireAnyRole("guide", "admin", "super_admin"),
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

export default router;
