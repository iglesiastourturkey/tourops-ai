import { Router } from "express";
import { db } from "@workspace/db";
import { exchangeRatesTable, agencySettingsTable, emailTemplatesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireAnyRole, requireRole } from "../lib/auth";

const router = Router();
router.use(requireAuth);

// --- Exchange rates ---
router.get("/exchange-rates", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    res.json(await db.select().from(exchangeRatesTable));
  } catch { res.status(500).json({ error: "Failed to list exchange rates" }); }
});

router.post("/exchange-rates", requireRole("admin"), async (req, res) => {
  try {
    const [row] = await db.insert(exchangeRatesTable).values(req.body).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create exchange rate" }); }
});

router.patch("/exchange-rates/:id", requireRole("admin"), async (req, res) => {
  try {
    const [row] = await db.update(exchangeRatesTable).set(req.body).where(eq(exchangeRatesTable.id, parseInt(req.params.id as string))).returning();
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update exchange rate" }); }
});

router.delete("/exchange-rates/:id", requireRole("admin"), async (req, res) => {
  try {
    await db.delete(exchangeRatesTable).where(eq(exchangeRatesTable.id, parseInt(req.params.id as string)));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete exchange rate" }); }
});

// --- Agency settings ---
router.get("/agency-settings", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const [row] = await db.select().from(agencySettingsTable).limit(1);
    if (row) { res.json(row); return; }
    const [created] = await db.insert(agencySettingsTable).values({ name: "TourPilot Acentesi" }).returning();
    res.json(created);
  } catch { res.status(500).json({ error: "Failed to get agency settings" }); }
});

router.patch("/agency-settings", requireRole("admin"), async (req, res) => {
  try {
    const [existing] = await db.select().from(agencySettingsTable).limit(1);
    if (existing) {
      const [row] = await db.update(agencySettingsTable).set(req.body).where(eq(agencySettingsTable.id, existing.id)).returning();
      res.json(row);
    } else {
      const [row] = await db.insert(agencySettingsTable).values(req.body).returning();
      res.json(row);
    }
  } catch { res.status(500).json({ error: "Failed to update agency settings" }); }
});

// --- Email templates ---
router.get("/email-templates", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    res.json(await db.select().from(emailTemplatesTable));
  } catch { res.status(500).json({ error: "Failed to list email templates" }); }
});

router.post("/email-templates", requireRole("admin"), async (req, res) => {
  try {
    const [row] = await db.insert(emailTemplatesTable).values(req.body).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create email template" }); }
});

router.get("/email-templates/:id", requireAnyRole("admin", "operations"), async (req, res) => {
  try {
    const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, parseInt(req.params.id as string)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to get email template" }); }
});

router.patch("/email-templates/:id", requireRole("admin"), async (req, res) => {
  try {
    const [row] = await db.update(emailTemplatesTable).set(req.body).where(eq(emailTemplatesTable.id, parseInt(req.params.id as string))).returning();
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update email template" }); }
});

router.delete("/email-templates/:id", requireRole("admin"), async (req, res) => {
  try {
    await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, parseInt(req.params.id as string)));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete email template" }); }
});

export default router;
