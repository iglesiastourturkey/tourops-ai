import { Router } from "express";
import { db } from "@workspace/db";
import { toursTable, quotationsTable, operationTasksTable } from "@workspace/db/schema";
import { eq, gte, lt, and, inArray, ne, not, desc } from "drizzle-orm";
import { requireAuth, requireAnyRole } from "../lib/auth";

const router = Router();
router.use(requireAuth);
router.use(requireAnyRole("admin", "operations", "accounting"));

const TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

router.get("/stats", async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const sevenDays = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString().split("T")[0];

    // Active Tours = approved (and 'active' if that status ever appears)
    const [activeTours, allQuotations, upcomingDeps, tasksDueToday, allTours] = await Promise.all([
      db.select().from(toursTable).where(inArray(toursTable.status, ["approved", "active"])),
      // Pending = draft + sent + viewed (open/actionable quotations)
      db.select().from(quotationsTable).where(
        inArray(quotationsTable.status, ["draft", "sent", "viewed"])
      ),
      db.select().from(toursTable).where(
        and(gte(toursTable.startDate, today), lt(toursTable.startDate, sevenDays))
      ),
      // Tasks due today that are NOT completed
      db.select().from(operationTasksTable).where(
        and(
          eq(operationTasksTable.dueDate, today),
          ne(operationTasksTable.status, "completed")
        )
      ),
      // Accepted quotations for revenue — use TRY ones for the primary display currency
      db.select({
        finalPrice: quotationsTable.finalPrice,
        currency: quotationsTable.currency,
      }).from(quotationsTable).where(eq(quotationsTable.status, "accepted")),
    ]);

    // Revenue: sum TRY accepted quotations; fall back to all if none are TRY
    const tryQuotations = allTours.filter(q => q.currency === "TRY");
    const revenueSource = tryQuotations.length > 0 ? tryQuotations : allTours;
    const totalEstimatedRevenue = revenueSource.reduce((s, q) => s + (q.finalPrice ?? 0), 0);
    const displayCurrency = tryQuotations.length > 0 ? "TRY" : (allTours[0]?.currency ?? "TRY");

    // Avg profit margin from tours that have it set
    const toursWithMargin = (await db.select({ profitMargin: toursTable.profitMargin }).from(toursTable)).filter(t => t.profitMargin != null);
    const avgProfitMargin = toursWithMargin.length > 0
      ? Math.round(toursWithMargin.reduce((s, t) => s + (t.profitMargin ?? 0), 0) / toursWithMargin.length)
      : 0;

    res.json({
      activeTours: activeTours.length,
      pendingQuotations: allQuotations.length,
      upcomingDepartures: upcomingDeps.length,
      unconfirmedReservations: 0,
      totalEstimatedRevenue,
      avgProfitMargin,
      tasksDueToday: tasksDueToday.length,
      currency: displayCurrency,
    });
  } catch { res.status(500).json({ error: "Failed to get stats" }); }
});

router.get("/alerts", async (req, res) => {
  try {
    const alerts: Array<{ id: string; type: string; message: string; severity: string; relatedId: number | null; relatedType: string | null }> = [];

    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const threeDays = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString().split("T")[0];

    // Tours starting in next 3 days
    const upcoming = await db.select().from(toursTable).where(
      and(gte(toursTable.startDate, today), lt(toursTable.startDate, threeDays))
    );
    for (const t of upcoming) {
      alerts.push({ id: `tour-${t.id}`, type: "departure", message: `"${t.name}" turu ${t.startDate} tarihinde başlıyor`, severity: "warning", relatedId: t.id, relatedType: "tour" });
    }

    // Expiring quotations (sent, expires within 3 days)
    const expiring = await db.select().from(quotationsTable).where(
      and(eq(quotationsTable.status, "sent"), lt(quotationsTable.expiresAt, threeDays))
    );
    for (const q of expiring) {
      alerts.push({ id: `quot-${q.id}`, type: "quotation_expiry", message: `${q.number} numaralı teklif ${q.expiresAt} tarihinde sona eriyor`, severity: "critical", relatedId: q.id, relatedType: "quotation" });
    }

    res.json(alerts);
  } catch { res.status(500).json({ error: "Failed to get alerts" }); }
});

router.get("/charts", async (req, res) => {
  try {
    const now = new Date();

    // Build last-6-months buckets
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { year: d.getFullYear(), month: d.getMonth(), label: TR_MONTHS[d.getMonth()] };
    });

    // Fetch all quotations once and bin them client-side in JS (avoids DB-specific date functions)
    const allQuotations = await db.select({
      createdAt: quotationsTable.createdAt,
      finalPrice: quotationsTable.finalPrice,
      currency: quotationsTable.currency,
    }).from(quotationsTable).orderBy(desc(quotationsTable.createdAt));

    const monthlyQuotations = buckets.map(({ year, month, label }) => ({
      label,
      value: allQuotations.filter(q => {
        const d = new Date(q.createdAt);
        return d.getFullYear() === year && d.getMonth() === month;
      }).length,
    }));

    const monthlySales = buckets.map(({ year, month, label }) => ({
      label,
      value: allQuotations
        .filter(q => {
          const d = new Date(q.createdAt);
          return d.getFullYear() === year && d.getMonth() === month && q.currency === "TRY";
        })
        .reduce((s, q) => s + (q.finalPrice ?? 0), 0),
    }));

    // Tour status distribution
    const allTours = await db.select({ status: toursTable.status }).from(toursTable);
    const statusLabels: Record<string, string> = { draft: "Taslak", approved: "Onaylı", completed: "Tamamlandı", cancelled: "İptal", archived: "Arşiv" };
    const statusCounts: Record<string, number> = {};
    for (const t of allTours) {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    }
    const tourStatusDistribution = Object.entries(statusCounts).map(([s, count]) => ({
      label: statusLabels[s] ?? s,
      value: count,
    }));

    // Top destinations from tours
    const destCounts: Record<string, number> = {};
    const toursWithDest = await db.select({ mainDestination: toursTable.mainDestination }).from(toursTable);
    for (const t of toursWithDest) {
      if (t.mainDestination) destCounts[t.mainDestination] = (destCounts[t.mainDestination] || 0) + 1;
    }
    const topDestinations = Object.entries(destCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dest, count]) => ({ label: dest, value: count }));

    if (topDestinations.length === 0) {
      topDestinations.push(
        { label: "Efes", value: 0 },
        { label: "Kuşadası", value: 0 },
        { label: "Pamukkale", value: 0 }
      );
    }

    res.json({ monthlyQuotations, monthlySales, tourStatusDistribution, topDestinations });
  } catch { res.status(500).json({ error: "Failed to get charts" }); }
});

export default router;
