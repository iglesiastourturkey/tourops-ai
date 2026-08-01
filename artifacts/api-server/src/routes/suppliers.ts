import { Router } from "express";
import { db } from "@workspace/db";
import { suppliersTable } from "@workspace/db/schema";
import { eq, like, or, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const { search, category, isActive } = req.query as Record<string, string>;
    let rows = await db.select().from(suppliersTable).orderBy(desc(suppliersTable.createdAt));
    if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.city?.toLowerCase().includes(search.toLowerCase()));
    if (category) rows = rows.filter(r => r.category === category);
    if (isActive !== undefined) rows = rows.filter(r => r.isActive === (isActive === "true"));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list suppliers" }); }
});

router.post("/", async (req, res) => {
  try {
    const [row] = await db.insert(suppliersTable).values(req.body).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create supplier" }); }
});

router.get("/:id", async (req, res) => {
  try {
    const [row] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to get supplier" }); }
});

router.patch("/:id", async (req, res) => {
  try {
    const [row] = await db.update(suppliersTable).set(req.body).where(eq(suppliersTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update supplier" }); }
});

router.delete("/:id", async (req, res) => {
  try {
    await db.delete(suppliersTable).where(eq(suppliersTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete supplier" }); }
});

export default router;
