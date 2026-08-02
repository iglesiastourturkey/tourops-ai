import { Router } from "express";
import { db } from "@workspace/db";
import {
  toursTable,
  quotationsTable,
  operationTasksTable,
  operationsTable,
  operationReceiptsTable,
} from "@workspace/db/schema";
import { eq, gte, lt, and, inArray, ne, not, desc, isNull } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";

const router = Router();
router.use(requireAuth);

const TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().split("T")[0]; }
function daysAhead(n: number) {
  return new Date(Date.now() + n * 86_400_000).toISOString().split("T")[0];
}

// ─── /stats  (all authenticated roles, role-aware response) ───────────────────

router.get("/stats", requirePermission("dashboard", "view"), async (req, res) => {
  try {
    const profile = res.locals.profile;
    const role: string = profile.role;
    const today = todayStr();

    // ── Guide ──────────────────────────────────────────────────────────────
    if (role === "guide") {
      const cuid = profile.clerkUserId;

      const [allAssigned, todayOps] = await Promise.all([
        db.select({ id: operationsTable.id }).from(operationsTable)
          .where(eq(operationsTable.assignedGuideUserId, cuid)),
        db.select({ id: operationsTable.id }).from(operationsTable)
          .where(and(
            eq(operationsTable.assignedGuideUserId, cuid),
            eq(operationsTable.startDate, today),
          )),
      ]);

      const opIds = allAssigned.map(o => o.id);
      const pendingTasks = opIds.length > 0
        ? await db.select({ id: operationTasksTable.id }).from(operationTasksTable)
            .where(and(
              inArray(operationTasksTable.operationId, opIds),
              ne(operationTasksTable.status, "completed"),
            ))
        : [];

      return res.json({
        role: "guide",
        assignedOperationsCount: allAssigned.length,
        todayOperationsCount: todayOps.length,
        pendingTasksCount: pendingTasks.length,
      });
    }

    // ── Accounting ─────────────────────────────────────────────────────────
    if (role === "accounting") {
      const [receipts, missingPhotos, expenses, pendingQuotations] = await Promise.all([
        db.select({ id: operationReceiptsTable.id }).from(operationReceiptsTable),
        db.select({ id: operationReceiptsTable.id }).from(operationReceiptsTable)
          .where(isNull(operationReceiptsTable.photoObjectPath)),
        db.select({ amount: operationReceiptsTable.amount, currency: operationReceiptsTable.currency })
          .from(operationReceiptsTable),
        db.select({ id: quotationsTable.id }).from(quotationsTable)
          .where(inArray(quotationsTable.status, ["draft", "sent", "viewed"])),
      ]);

      const totalRecordedExpenses = expenses
        .filter(r => r.currency === "TRY")
        .reduce((s, r) => s + r.amount, 0);

      return res.json({
        role: "accounting",
        receiptCount: receipts.length,
        receiptsMissingPhotos: missingPhotos.length,
        totalRecordedExpenses,
        pendingQuotations: pendingQuotations.length,
      });
    }

    // ── Operations ─────────────────────────────────────────────────────────
    if (role === "operations") {
      const sevenDays = daysAhead(7);
      const [todayOps, unassigned, incompleteTasks, upcomingDeps, activeOps] = await Promise.all([
        db.select({ id: operationsTable.id }).from(operationsTable)
          .where(and(eq(operationsTable.startDate, today), ne(operationsTable.status, "archived"))),
        db.select({ id: operationsTable.id }).from(operationsTable)
          .where(and(
            isNull(operationsTable.assignedGuideUserId),
            not(inArray(operationsTable.status, ["completed", "archived", "cancelled"])),
          )),
        db.select({ id: operationTasksTable.id }).from(operationTasksTable)
          .where(ne(operationTasksTable.status, "completed")),
        db.select({ id: operationsTable.id }).from(operationsTable)
          .where(and(gte(operationsTable.startDate, today), lt(operationsTable.startDate, sevenDays))),
        db.select({ completionRate: operationsTable.completionRate }).from(operationsTable)
          .where(eq(operationsTable.status, "active")),
      ]);

      const avgCompletionRate = activeOps.length > 0
        ? Math.round(activeOps.reduce((s, o) => s + (o.completionRate ?? 0), 0) / activeOps.length)
        : 0;

      return res.json({
        role: "operations",
        todayOperations: todayOps.length,
        unassignedCount: unassigned.length,
        incompleteTasksCount: incompleteTasks.length,
        upcomingDepartures: upcomingDeps.length,
        avgCompletionRate,
      });
    }

    // ── Admin / super_admin ────────────────────────────────────────────────
    const sevenDays = daysAhead(7);
    const [activeTours, allOpenQuotations, tasksDueToday, todayOps, missingGuide, missingPhotos, acceptedQuotations] =
      await Promise.all([
        db.select({ id: toursTable.id }).from(toursTable)
          .where(inArray(toursTable.status, ["approved", "active"])),
        db.select({ id: quotationsTable.id }).from(quotationsTable)
          .where(inArray(quotationsTable.status, ["draft", "sent", "viewed"])),
        db.select({ id: operationTasksTable.id }).from(operationTasksTable)
          .where(and(eq(operationTasksTable.dueDate, today), ne(operationTasksTable.status, "completed"))),
        db.select({ id: operationsTable.id }).from(operationsTable)
          .where(and(eq(operationsTable.startDate, today), ne(operationsTable.status, "archived"))),
        db.select({ id: operationsTable.id }).from(operationsTable)
          .where(and(
            isNull(operationsTable.assignedGuideUserId),
            gte(operationsTable.startDate, today),
            lt(operationsTable.startDate, sevenDays),
            not(inArray(operationsTable.status, ["completed", "archived", "cancelled"])),
          )),
        db.select({ id: operationReceiptsTable.id }).from(operationReceiptsTable)
          .where(isNull(operationReceiptsTable.photoObjectPath)),
        db.select({ finalPrice: quotationsTable.finalPrice, currency: quotationsTable.currency })
          .from(quotationsTable).where(eq(quotationsTable.status, "accepted")),
      ]);

    const tryQ = acceptedQuotations.filter(q => q.currency === "TRY");
    const revenueSource = tryQ.length > 0 ? tryQ : acceptedQuotations;
    const totalEstimatedRevenue = revenueSource.reduce((s, q) => s + (q.finalPrice ?? 0), 0);
    const displayCurrency = tryQ.length > 0 ? "TRY" : (acceptedQuotations[0]?.currency ?? "TRY");

    const toursWithMargin = await db
      .select({ profitMargin: toursTable.profitMargin }).from(toursTable);
    const withVal = toursWithMargin.filter(t => t.profitMargin != null);
    const avgProfitMargin = withVal.length > 0
      ? Math.round(withVal.reduce((s, t) => s + (t.profitMargin ?? 0), 0) / withVal.length)
      : 0;

    return res.json({
      role: "admin",
      activeTours: activeTours.length,
      pendingQuotations: allOpenQuotations.length,
      tasksDueToday: tasksDueToday.length,
      todayOperations: todayOps.length,
      totalEstimatedRevenue,
      avgProfitMargin,
      currency: displayCurrency,
      missingGuideAssignments: missingGuide.length,
      receiptsMissingPhotos: missingPhotos.length,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to get stats" });
  }
});

// ─── /alerts  (all authenticated roles, role-aware) ───────────────────────────

router.get("/alerts", requirePermission("dashboard", "view"), async (req, res) => {
  try {
    const profile = res.locals.profile;
    const role: string = profile.role;
    const today = todayStr();
    const threeDays = daysAhead(3);
    const sevenDays  = daysAhead(7);

    const alerts: Array<{
      id: string; type: string; message: string;
      severity: string; relatedId: number | null; relatedType: string | null;
    }> = [];

    if (role === "guide") {
      // Guides see only alerts relevant to their assigned operations
      const myOps = await db.select({ id: operationsTable.id, startDate: operationsTable.startDate, tourId: operationsTable.tourId })
        .from(operationsTable)
        .where(and(eq(operationsTable.assignedGuideUserId, profile.clerkUserId), gte(operationsTable.startDate, today)));

      for (const op of myOps) {
        if (op.startDate === today) {
          // Get tour name if possible
          const [tour] = op.tourId
            ? await db.select({ name: toursTable.name }).from(toursTable).where(eq(toursTable.id, op.tourId)).limit(1)
            : [];
          const name = tour?.name ?? `Operasyon #${op.id}`;
          alerts.push({
            id: `op-today-${op.id}`, type: "operation_today",
            message: `Bugün başlıyor: ${name}`,
            severity: "warning", relatedId: op.id, relatedType: "operation",
          });
        }
      }
      return res.json(alerts);
    }

    // Tours starting in next 3 days
    const upcoming = await db.select().from(toursTable)
      .where(and(gte(toursTable.startDate, today), lt(toursTable.startDate, threeDays)));
    for (const t of upcoming) {
      alerts.push({
        id: `tour-${t.id}`, type: "departure",
        message: `"${t.name}" turu ${t.startDate} tarihinde başlıyor`,
        severity: "warning", relatedId: t.id, relatedType: "tour",
      });
    }

    // Expiring quotations (sent, expires within 3 days)
    const expiring = await db.select().from(quotationsTable)
      .where(and(eq(quotationsTable.status, "sent"), lt(quotationsTable.expiresAt, threeDays)));
    for (const q of expiring) {
      alerts.push({
        id: `quot-${q.id}`, type: "quotation_expiry",
        message: `${q.number} numaralı teklif ${q.expiresAt} tarihinde sona eriyor`,
        severity: "critical", relatedId: q.id, relatedType: "quotation",
      });
    }

    if (role === "admin" || role === "super_admin" || role === "operations") {
      // Operations in next 7 days without a guide
      const unassigned = await db.select({ id: operationsTable.id, startDate: operationsTable.startDate })
        .from(operationsTable)
        .where(and(
          isNull(operationsTable.assignedGuideUserId),
          gte(operationsTable.startDate, today),
          lt(operationsTable.startDate, sevenDays),
          not(inArray(operationsTable.status, ["completed", "archived", "cancelled"])),
        ));
      for (const op of unassigned) {
        alerts.push({
          id: `unassigned-${op.id}`, type: "missing_guide",
          message: `Operasyon #${op.id} (${op.startDate}) için rehber atanmamış`,
          severity: "warning", relatedId: op.id, relatedType: "operation",
        });
      }
    }

    return res.json(alerts);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to get alerts" });
  }
});

// ─── /charts  (admin / operations only) ───────────────────────────────────────

router.get("/charts", requirePermission("dashboard", "view"), async (req, res) => {
  try {
    const now = new Date();
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { year: d.getFullYear(), month: d.getMonth(), label: TR_MONTHS[d.getMonth()] };
    });

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

    const allTours = await db.select({ status: toursTable.status }).from(toursTable);
    const statusLabels: Record<string, string> = {
      draft: "Taslak", approved: "Onaylı", completed: "Tamamlandı",
      cancelled: "İptal", archived: "Arşiv",
    };
    const statusCounts: Record<string, number> = {};
    for (const t of allTours) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    const tourStatusDistribution = Object.entries(statusCounts)
      .map(([s, count]) => ({ label: statusLabels[s] ?? s, value: count }));

    const toursWithDest = await db.select({ mainDestination: toursTable.mainDestination }).from(toursTable);
    const destCounts: Record<string, number> = {};
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
        { label: "Pamukkale", value: 0 },
      );
    }

    res.json({ monthlyQuotations, monthlySales, tourStatusDistribution, topDestinations });
  } catch {
    res.status(500).json({ error: "Failed to get charts" });
  }
});

// ─── /upcoming  (admin / operations / accounting) ─────────────────────────────

router.get("/upcoming", requirePermission("dashboard", "view"), async (req, res) => {
  try {
    const today = todayStr();
    const fourteenDays = daysAhead(14);

    const rows = await db
      .select({
        id: operationsTable.id,
        startDate: operationsTable.startDate,
        endDate: operationsTable.endDate,
        status: operationsTable.status,
        guideName: operationsTable.guideName,
        assignedGuideUserId: operationsTable.assignedGuideUserId,
        tourName: toursTable.name,
      })
      .from(operationsTable)
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .where(and(
        gte(operationsTable.startDate, today),
        lt(operationsTable.startDate, fourteenDays),
        not(inArray(operationsTable.status, ["archived", "cancelled"])),
      ))
      .orderBy(operationsTable.startDate)
      .limit(8);

    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to get upcoming operations" });
  }
});

// ─── /guide-ops  (guide's assigned operations; admin/super_admin can pass ?guideUserId=) ─

router.get("/guide-ops", requirePermission("dashboard", "view"), async (req, res) => {
  try {
    const profile = res.locals.profile;
    const role: string = profile.role;

    let guideClerkUserId: string | null = null;

    if (role === "guide") {
      guideClerkUserId = profile.clerkUserId;
    } else if (role === "admin" || role === "super_admin") {
      guideClerkUserId = (req.query.guideUserId as string) ?? null;
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!guideClerkUserId) return res.json([]);

    const rows = await db
      .select({
        id: operationsTable.id,
        startDate: operationsTable.startDate,
        endDate: operationsTable.endDate,
        status: operationsTable.status,
        completionRate: operationsTable.completionRate,
        guideName: operationsTable.guideName,
        tourName: toursTable.name,
      })
      .from(operationsTable)
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .where(eq(operationsTable.assignedGuideUserId, guideClerkUserId))
      .orderBy(desc(operationsTable.startDate))
      .limit(10);

    return res.json(rows);
  } catch {
    return res.status(500).json({ error: "Failed to get guide operations" });
  }
});

export default router;
