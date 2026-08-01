import { Router } from "express";
import { db } from "@workspace/db";
import { customersTable } from "@workspace/db/schema";
import { eq, like, or, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

router.use(requireAuth);

// GET /api/customers
router.get("/", async (req, res) => {
  try {
    const { search, customerType, page = "1", limit = "50" } = req.query as Record<string, string>;
    let query = db.select().from(customersTable).$dynamic();
    const conditions = [];
    if (search) conditions.push(or(like(customersTable.name, `%${search}%`), like(customersTable.email, `%${search}%`), like(customersTable.phone, `%${search}%`)));
    if (customerType) conditions.push(eq(customersTable.customerType, customerType));
    if (conditions.length) query = query.where(conditions.length === 1 ? conditions[0] : conditions[0]); // simplified
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const customers = await query.orderBy(desc(customersTable.createdAt)).limit(parseInt(limit)).offset(offset);
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: "Failed to list customers" });
  }
});

// POST /api/customers
router.post("/", async (req, res) => {
  try {
    const [customer] = await db.insert(customersTable).values(req.body).returning();
    res.status(201).json(customer);
  } catch (err) {
    res.status(500).json({ error: "Failed to create customer" });
  }
});

// GET /api/customers/:id
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: "Failed to get customer" });
  }
});

// PATCH /api/customers/:id
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [updated] = await db.update(customersTable).set(req.body).where(eq(customersTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Customer not found" }); return; }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// DELETE /api/customers/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(customersTable).where(eq(customersTable.id, id));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete customer" });
  }
});

export default router;
