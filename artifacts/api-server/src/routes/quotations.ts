import { Router } from "express";
import { db } from "@workspace/db";
import { quotationsTable, operationsTable } from "@workspace/db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireAuth, requireAnyRole } from "../lib/auth";

const router = Router();
router.use(requireAuth);

function genQuotationNumber() {
  const now = new Date();
  return `TEK-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

router.get("/", requireAnyRole("admin", "operations", "accounting"), async (req, res) => {
  try {
    const { status, customerId } = req.query as Record<string, string>;
    let rows = await db.select().from(quotationsTable).orderBy(desc(quotationsTable.createdAt));
    if (status) rows = rows.filter(r => r.status === status);
    if (customerId) rows = rows.filter(r => r.customerId === parseInt(customerId));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list quotations" }); }
});

router.post("/", requireAnyRole("admin", "operations", "accounting"), async (req, res) => {
  try {
    const body = { ...req.body };
    if (!body.number) body.number = genQuotationNumber();
    const [row] = await db.insert(quotationsTable).values(body).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create quotation" }); }
});

router.get("/:id", requireAnyRole("admin", "operations", "accounting"), async (req, res) => {
  try {
    const [row] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, parseInt(req.params.id as string)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to get quotation" }); }
});

router.patch("/:id", requireAnyRole("admin", "operations", "accounting"), async (req, res) => {
  try {
    const [row] = await db.update(quotationsTable).set(req.body).where(eq(quotationsTable.id, parseInt(req.params.id as string))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update quotation" }); }
});

// DELETE /quotations/:id — blocked if quotation has an active operation
router.delete("/:id", requireAnyRole("admin", "operations", "accounting"), async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const activeOps = await db.select({ id: operationsTable.id }).from(operationsTable).where(
      and(eq(operationsTable.quotationId, id), inArray(operationsTable.status, ["active"]))
    );
    if (activeOps.length > 0) {
      res.status(409).json({ error: "Bu teklife bağlı aktif bir operasyon bulunmaktadır." });
      return;
    }
    await db.delete(quotationsTable).where(eq(quotationsTable.id, id));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete quotation" }); }
});

// PATCH /quotations/:id/status
router.patch("/:id/status", requireAnyRole("admin", "operations", "accounting"), async (req, res) => {
  try {
    const { status } = req.body;
    const updates: Record<string, unknown> = { status };
    if (status === "sent") updates.sentAt = new Date();
    if (status === "viewed") updates.viewedAt = new Date();
    if (["accepted", "rejected"].includes(status)) updates.respondedAt = new Date();
    const [row] = await db.update(quotationsTable).set(updates).where(eq(quotationsTable.id, parseInt(req.params.id as string))).returning();
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update status" }); }
});

// POST /quotations/:id/duplicate
router.post("/:id/duplicate", requireAnyRole("admin", "operations", "accounting"), async (req, res) => {
  try {
    const [orig] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, parseInt(req.params.id as string)));
    if (!orig) { res.status(404).json({ error: "Not found" }); return; }
    const { id, createdAt, updatedAt, number, sentAt, viewedAt, respondedAt, ...rest } = orig;
    const [row] = await db.insert(quotationsTable).values({ ...rest, number: genQuotationNumber(), status: "draft" }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to duplicate quotation" }); }
});

// POST /quotations/:id/convert-to-operation
router.post("/:id/convert-to-operation", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const [quot] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, parseInt(req.params.id as string)));
    if (!quot) { res.status(404).json({ error: "Not found" }); return; }
    const [op] = await db.insert(operationsTable).values({
      quotationId: quot.id,
      tourId: quot.tourId ?? undefined,
      customerId: quot.customerId,
      status: "active",
      completionRate: 0,
    }).returning();
    await db.update(quotationsTable).set({ status: "accepted" }).where(eq(quotationsTable.id, quot.id));
    res.status(201).json(op);
  } catch { res.status(500).json({ error: "Failed to convert to operation" }); }
});

export default router;
