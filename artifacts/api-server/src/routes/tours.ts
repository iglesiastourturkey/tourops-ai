import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { toursTable, tourDaysTable, tourCostsTable, quotationsTable, operationsTable } from "@workspace/db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireAuth, requireAnyRole } from "../lib/auth";
import type { UserRole } from "@workspace/db/schema";

const router = Router();
router.use(requireAuth);

/**
 * Returns the set of tourIds that the given guide user is allowed to access,
 * based on their assigned operations.
 */
async function getGuideAllowedTourIds(userId: string): Promise<Set<number>> {
  const ops = await db.select({ tourId: operationsTable.tourId })
    .from(operationsTable)
    .where(eq(operationsTable.assignedGuideUserId, userId));
  const tourIds = new Set<number>();
  for (const op of ops) {
    if (op.tourId != null) tourIds.add(op.tourId);
  }
  return tourIds;
}

// Tours CRUD
router.get("/", requireAnyRole("admin", "operations", "guide", "accounting"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole;
    const { search, status, tourType } = req.query as Record<string, string>;
    let rows = await db.select().from(toursTable).orderBy(desc(toursTable.createdAt));

    // Guides only see tours linked to their assigned operations
    if (role === "guide") {
      const allowedTourIds = await getGuideAllowedTourIds(userId!);
      rows = rows.filter(r => allowedTourIds.has(r.id));
    }

    if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase()));
    if (status) rows = rows.filter(r => r.status === status);
    if (tourType) rows = rows.filter(r => r.tourType === tourType);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list tours" }); }
});

router.post("/", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const body = req.body;
    if (!body.code) {
      body.code = `TUR-${Date.now().toString(36).toUpperCase()}`;
    }
    const [row] = await db.insert(toursTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: "Failed to create tour" }); }
});

router.get("/:id", requireAnyRole("admin", "operations", "guide", "accounting"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole;
    const tourId = parseInt(req.params.id as string);
    const [row] = await db.select().from(toursTable).where(eq(toursTable.id, tourId));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    // Guides may only access tours linked to their assigned operations
    if (role === "guide") {
      const allowedTourIds = await getGuideAllowedTourIds(userId!);
      if (!allowedTourIds.has(tourId)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to get tour" }); }
});

router.patch("/:id", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const [row] = await db.update(toursTable).set(req.body).where(eq(toursTable.id, parseInt(req.params.id as string))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update tour" }); }
});

router.delete("/:id", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const tourId = parseInt(req.params.id as string);
    // Prevent deleting a tour that has active quotations or operations
    const [activeQuotations, activeOperations] = await Promise.all([
      db.select({ id: quotationsTable.id }).from(quotationsTable).where(
        and(
          eq(quotationsTable.tourId, tourId),
          inArray(quotationsTable.status, ["draft", "sent", "viewed", "accepted"])
        )
      ),
      db.select({ id: operationsTable.id }).from(operationsTable).where(
        and(eq(operationsTable.tourId, tourId), inArray(operationsTable.status, ["active"]))
      ),
    ]);
    if (activeQuotations.length > 0 || activeOperations.length > 0) {
      res.status(409).json({ error: "Tour has active quotations or operations and cannot be deleted" });
      return;
    }
    await db.delete(toursTable).where(eq(toursTable.id, tourId));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete tour" }); }
});

// Tour cost summary — financial data; guides are excluded
router.get("/:id/cost-summary", requireAnyRole("admin", "operations", "accounting"), async (req, res) => {
  try {
    const tourId = parseInt(req.params.id as string);
    const [tour] = await db.select().from(toursTable).where(eq(toursTable.id, tourId));
    if (!tour) { res.status(404).json({ error: "Not found" }); return; }
    const costs = await db.select().from(tourCostsTable).where(eq(tourCostsTable.tourId, tourId));
    const pax = (tour.adultCount || 1) + (tour.childCount || 0);
    const fixedCosts = costs.filter(c => !c.isPerPerson).reduce((s, c) => s + (c.total || 0), 0);
    const variableCosts = costs.filter(c => c.isPerPerson).reduce((s, c) => s + (c.total || 0) * pax, 0);
    const totalCost = fixedCosts + variableCosts;
    const taxAmount = costs.reduce((s, c) => s + ((c.total || 0) * (c.taxRate || 0) / 100), 0);
    const margin = tour.profitMargin ?? 20;
    const profitAmount = totalCost * (margin / 100);
    const suggestedSellingPrice = totalCost + profitAmount;
    res.json({
      totalCost,
      costPerPerson: pax > 0 ? totalCost / pax : 0,
      fixedCosts,
      variableCosts,
      taxAmount,
      commission: 0,
      profitAmount,
      profitMargin: margin,
      suggestedSellingPrice,
      breakEvenPrice: totalCost,
      currency: "TRY",
    });
  } catch { res.status(500).json({ error: "Failed to compute cost summary" }); }
});

// Tour days — guides may read days for tours linked to their operations
router.get("/:id/days", requireAnyRole("admin", "operations", "guide", "accounting"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole;
    const tourId = parseInt(req.params.id as string);
    if (role === "guide") {
      const allowedTourIds = await getGuideAllowedTourIds(userId!);
      if (!allowedTourIds.has(tourId)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    const rows = await db.select().from(tourDaysTable).where(eq(tourDaysTable.tourId, tourId)).orderBy(tourDaysTable.dayNumber);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list tour days" }); }
});

router.post("/:id/days", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const [row] = await db.insert(tourDaysTable).values({ ...req.body, tourId: parseInt(req.params.id as string) }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create tour day" }); }
});

router.patch("/:id/days/:dayId", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const [row] = await db.update(tourDaysTable).set(req.body).where(eq(tourDaysTable.id, parseInt(req.params.dayId as string))).returning();
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update tour day" }); }
});

router.delete("/:id/days/:dayId", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    await db.delete(tourDaysTable).where(eq(tourDaysTable.id, parseInt(req.params.dayId as string)));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete tour day" }); }
});

// Tour costs — financial data; guides are excluded
router.get("/:id/costs", requireAnyRole("admin", "operations", "accounting"), async (req, res) => {
  try {
    const rows = await db.select().from(tourCostsTable).where(eq(tourCostsTable.tourId, parseInt(req.params.id as string)));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list tour costs" }); }
});

router.post("/:id/costs", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const body = { ...req.body, tourId: parseInt(req.params.id as string) };
    body.total = (body.quantity || 1) * (body.unitCost || 0);
    const [row] = await db.insert(tourCostsTable).values(body).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create tour cost" }); }
});

router.patch("/:id/costs/:costId", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.quantity !== undefined || body.unitCost !== undefined) {
      const [existing] = await db.select().from(tourCostsTable).where(eq(tourCostsTable.id, parseInt(req.params.costId as string)));
      const q = body.quantity ?? existing?.quantity ?? 1;
      const u = body.unitCost ?? existing?.unitCost ?? 0;
      body.total = q * u;
    }
    const [row] = await db.update(tourCostsTable).set(body).where(eq(tourCostsTable.id, parseInt(req.params.costId as string))).returning();
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update tour cost" }); }
});

router.delete("/:id/costs/:costId", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    await db.delete(tourCostsTable).where(eq(tourCostsTable.id, parseInt(req.params.costId as string)));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete tour cost" }); }
});

export default router;
