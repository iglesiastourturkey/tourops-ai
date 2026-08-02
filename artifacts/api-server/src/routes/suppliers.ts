import { Router } from "express";
import { db } from "@workspace/db";
import { suppliersTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";

const router = Router();
router.use(requireAuth);

router.get("/", requirePermission("suppliers", "view"), async (req, res) => {
  try {
    const { search, category, isActive } = req.query as Record<string, string>;
    let rows = await db.select().from(suppliersTable).orderBy(desc(suppliersTable.createdAt));
    if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.city?.toLowerCase().includes(search.toLowerCase()));
    if (category) rows = rows.filter(r => r.category === category);
    if (isActive !== undefined) rows = rows.filter(r => r.isActive === (isActive === "true"));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list suppliers" }); }
});

router.post("/", requirePermission("suppliers", "create"), async (req, res) => {
  try {
    const [row] = await db.insert(suppliersTable).values(req.body).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create supplier" }); }
});

router.get("/:id", requirePermission("suppliers", "view"), async (req, res) => {
  try {
    const [row] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, parseInt(req.params.id as string)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to get supplier" }); }
});

// PATCH /suppliers/:id (also used for archive: set archivedAt)
router.patch("/:id", requirePermission("suppliers", "update"), async (req, res) => {
  try {
    const [row] = await db.update(suppliersTable).set(req.body).where(eq(suppliersTable.id, parseInt(req.params.id as string))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update supplier" }); }
});

// DELETE /suppliers/:id — no FK constraints block deletion for suppliers
router.delete("/:id", requirePermission("suppliers", "delete"), async (req, res) => {
  try {
    await db.delete(suppliersTable).where(eq(suppliersTable.id, parseInt(req.params.id as string)));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete supplier" }); }
});

export default router;
