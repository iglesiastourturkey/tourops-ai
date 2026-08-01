import { Router } from "express";
import { db } from "@workspace/db";
import { toursTable, quotationsTable, operationsTable, operationTasksTable, notificationsTable } from "@workspace/db/schema";
import { eq, gte, lt, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

router.get("/stats", async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const sevenDays = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString().split("T")[0];

    const [activeTours, pendingQuotations, upcomingDeps, tasksDueToday, allTours] = await Promise.all([
      db.select().from(toursTable).where(eq(toursTable.status, "approved")),
      db.select().from(quotationsTable).where(eq(quotationsTable.status, "sent")),
      db.select().from(toursTable).where(and(gte(toursTable.startDate, today), lt(toursTable.startDate, sevenDays))),
      db.select().from(operationTasksTable).where(and(eq(operationTasksTable.dueDate, today), eq(operationTasksTable.status, "not_started"))),
      db.select().from(quotationsTable).where(eq(quotationsTable.status, "accepted")),
    ]);

    const totalEstimatedRevenue = allTours.reduce((s, q) => s + (q.finalPrice ?? 0), 0);

    res.json({
      activeTours: activeTours.length,
      pendingQuotations: pendingQuotations.length,
      upcomingDepartures: upcomingDeps.length,
      unconfirmedReservations: 0,
      totalEstimatedRevenue,
      avgProfitMargin: 20,
      tasksDueToday: tasksDueToday.length,
      currency: "TRY",
    });
  } catch { res.status(500).json({ error: "Failed to get stats" }); }
});

router.get("/alerts", async (req, res) => {
  try {
    const alerts: Array<{ id: string; type: string; message: string; severity: string; relatedId: number | null; relatedType: string | null }> = [];

    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const threeDays = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString().split("T")[0];

    // Tours starting in 3 days
    const upcoming = await db.select().from(toursTable).where(and(gte(toursTable.startDate, today), lt(toursTable.startDate, threeDays)));
    for (const t of upcoming) {
      alerts.push({ id: `tour-${t.id}`, type: "departure", message: `"${t.name}" turu ${t.startDate} tarihinde başlıyor`, severity: "warning", relatedId: t.id, relatedType: "tour" });
    }

    // Expiring quotations
    const expiring = await db.select().from(quotationsTable).where(and(eq(quotationsTable.status, "sent"), lt(quotationsTable.expiresAt, threeDays)));
    for (const q of expiring) {
      alerts.push({ id: `quot-${q.id}`, type: "quotation_expiry", message: `${q.number} numaralı teklif ${q.expiresAt} tarihinde sona eriyor`, severity: "critical", relatedId: q.id, relatedType: "quotation" });
    }

    res.json(alerts);
  } catch { res.status(500).json({ error: "Failed to get alerts" }); }
});

router.get("/charts", async (req, res) => {
  try {
    const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
    const now = new Date();
    // Simplified: return 6 months of zeroed chart data — real data populates as tours/quotations are created
    const quotationsByMonth = Array.from({ length: 6 }, (_, i) => {
      const m = (now.getMonth() - 5 + i + 12) % 12;
      return { month: months[m], count: 0 };
    });
    const salesByMonth = Array.from({ length: 6 }, (_, i) => {
      const m = (now.getMonth() - 5 + i + 12) % 12;
      return { month: months[m], revenue: 0 };
    });
    const tourStatusDist = [
      { status: "Taslak", count: 0 },
      { status: "Onaylı", count: 0 },
      { status: "Tamamlandı", count: 0 },
    ];
    const topDestinations = [
      { destination: "Efes", count: 0 },
      { destination: "Kuşadası", count: 0 },
      { destination: "Pamukkale", count: 0 },
    ];
    res.json({ quotationsByMonth, salesByMonth, tourStatusDist, topDestinations });
  } catch { res.status(500).json({ error: "Failed to get charts" }); }
});

export default router;
