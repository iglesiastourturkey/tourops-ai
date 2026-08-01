import { Router } from "express";
import { db } from "@workspace/db";
import { toursTable, tourDaysTable, tourCostsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

// Tours CRUD
router.get("/", async (req, res) => {
  try {
    const { search, status, tourType } = req.query as Record<string, string>;
    let rows = await db.select().from(toursTable).orderBy(desc(toursTable.createdAt));
    if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase()));
    if (status) rows = rows.filter(r => r.status === status);
    if (tourType) rows = rows.filter(r => r.tourType === tourType);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list tours" }); }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body;
    if (!body.code) {
      body.code = `TUR-${Date.now().toString(36).toUpperCase()}`;
    }
    const [row] = await db.insert(toursTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: "Failed to create tour" }); }
});

router.get("/:id", async (req, res) => {
  try {
    const [row] = await db.select().from(toursTable).where(eq(toursTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to get tour" }); }
});

router.patch("/:id", async (req, res) => {
  try {
    const [row] = await db.update(toursTable).set(req.body).where(eq(toursTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update tour" }); }
});

router.delete("/:id", async (req, res) => {
  try {
    await db.delete(toursTable).where(eq(toursTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete tour" }); }
});

// Tour cost summary
router.get("/:id/cost-summary", async (req, res) => {
  try {
    const tourId = parseInt(req.params.id);
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

// Tour days
router.get("/:id/days", async (req, res) => {
  try {
    const rows = await db.select().from(tourDaysTable).where(eq(tourDaysTable.tourId, parseInt(req.params.id))).orderBy(tourDaysTable.dayNumber);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list tour days" }); }
});

router.post("/:id/days", async (req, res) => {
  try {
    const [row] = await db.insert(tourDaysTable).values({ ...req.body, tourId: parseInt(req.params.id) }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create tour day" }); }
});

router.patch("/:id/days/:dayId", async (req, res) => {
  try {
    const [row] = await db.update(tourDaysTable).set(req.body).where(eq(tourDaysTable.id, parseInt(req.params.dayId))).returning();
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update tour day" }); }
});

router.delete("/:id/days/:dayId", async (req, res) => {
  try {
    await db.delete(tourDaysTable).where(eq(tourDaysTable.id, parseInt(req.params.dayId)));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete tour day" }); }
});

// Tour costs
router.get("/:id/costs", async (req, res) => {
  try {
    const rows = await db.select().from(tourCostsTable).where(eq(tourCostsTable.tourId, parseInt(req.params.id)));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list tour costs" }); }
});

router.post("/:id/costs", async (req, res) => {
  try {
    const body = { ...req.body, tourId: parseInt(req.params.id) };
    body.total = (body.quantity || 1) * (body.unitCost || 0);
    const [row] = await db.insert(tourCostsTable).values(body).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create tour cost" }); }
});

router.patch("/:id/costs/:costId", async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.quantity !== undefined || body.unitCost !== undefined) {
      const [existing] = await db.select().from(tourCostsTable).where(eq(tourCostsTable.id, parseInt(req.params.costId)));
      const q = body.quantity ?? existing?.quantity ?? 1;
      const u = body.unitCost ?? existing?.unitCost ?? 0;
      body.total = q * u;
    }
    const [row] = await db.update(tourCostsTable).set(body).where(eq(tourCostsTable.id, parseInt(req.params.costId))).returning();
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update tour cost" }); }
});

router.delete("/:id/costs/:costId", async (req, res) => {
  try {
    await db.delete(tourCostsTable).where(eq(tourCostsTable.id, parseInt(req.params.costId)));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete tour cost" }); }
});

export default router;
