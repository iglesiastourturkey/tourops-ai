import { Router } from "express";
import { db } from "@workspace/db";
import { customersTable, quotationsTable, operationsTable } from "@workspace/db/schema";
import { eq, like, or, desc, and, isNull, inArray } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";

const router = Router();
router.use(requireAuth);

// GET /api/customers
router.get("/", requirePermission("customers", "view"), async (req, res) => {
  try {
    const { search, customerType } = req.query as Record<string, string>;
    let rows = await db.select().from(customersTable).orderBy(desc(customersTable.createdAt));
    if (search) rows = rows.filter(r =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.email?.toLowerCase().includes(search.toLowerCase()) ||
      r.phone?.toLowerCase().includes(search.toLowerCase())
    );
    if (customerType) rows = rows.filter(r => r.customerType === customerType);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list customers" }); }
});

// POST /api/customers
router.post("/", requirePermission("customers", "create"), async (req, res) => {
  try {
    const [customer] = await db.insert(customersTable).values(req.body).returning();
    res.status(201).json(customer);
  } catch { res.status(500).json({ error: "Failed to create customer" }); }
});

// GET /api/customers/:id
router.get("/:id", requirePermission("customers", "view"), async (req, res) => {
  try {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, parseInt(req.params.id as string)));
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
    res.json(customer);
  } catch { res.status(500).json({ error: "Failed to get customer" }); }
});

// PATCH /api/customers/:id (also used for archive: set archivedAt)
router.patch("/:id", requirePermission("customers", "update"), async (req, res) => {
  try {
    const [updated] = await db.update(customersTable).set(req.body).where(eq(customersTable.id, parseInt(req.params.id as string))).returning();
    if (!updated) { res.status(404).json({ error: "Customer not found" }); return; }
    res.json(updated);
  } catch { res.status(500).json({ error: "Failed to update customer" }); }
});

// DELETE /api/customers/:id — blocked if customer has active quotations or operations
router.delete("/:id", requirePermission("customers", "delete"), async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const [activeQuotations, activeOperations] = await Promise.all([
      db.select({ id: quotationsTable.id }).from(quotationsTable).where(
        and(eq(quotationsTable.customerId, id), inArray(quotationsTable.status, ["draft", "sent", "viewed", "accepted"]))
      ),
      db.select({ id: operationsTable.id }).from(operationsTable).where(
        and(eq(operationsTable.customerId, id), inArray(operationsTable.status, ["active"]))
      ),
    ]);
    if (activeQuotations.length > 0 || activeOperations.length > 0) {
      res.status(409).json({ error: "Bu müşteriye bağlı aktif teklif veya operasyon bulunmaktadır." });
      return;
    }
    await db.delete(customersTable).where(eq(customersTable.id, id));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete customer" }); }
});

export default router;
