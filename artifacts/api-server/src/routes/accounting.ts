import { Router } from "express";
import { db } from "@workspace/db";
import {
  accountingTransactionsTable,
  accountingDocumentsTable,
  accountingSettingsTable,
  operationReceiptsTable,
  operationsTable,
  toursTable,
  customersTable,
  suppliersTable,
  profilesTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, isNull, not, desc, or, sql } from "drizzle-orm";
import { requireAuth, getProfile, requireAnyRole } from "../lib/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router = Router();
router.use(requireAuth, getProfile);
const objectStorageService = new ObjectStorageService();

// Role helpers
const FULL_ACCESS = ["admin", "accounting"];
const READ_ACCESS = ["admin", "accounting", "operations"];

function canWrite(role: string) {
  return role === "super_admin" || FULL_ACCESS.includes(role);
}
function canRead(role: string) {
  return role === "super_admin" || READ_ACCESS.includes(role);
}

function todayStr() { return new Date().toISOString().split("T")[0]; }
function monthStartStr() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split("T")[0];
}
const TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

// ── Dashboard stats ────────────────────────────────────────────────────────────

router.get("/dashboard", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canRead(role)) return res.status(403).json({ error: "Forbidden" });

    const monthStart = monthStartStr();
    const today = todayStr();
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

    const [txRows, receiptPending, missingPhoto, upcomingDue,
           missingInfoReceipts, docPending, missingInfoDocs, overdueRows] = await Promise.all([
      db.select().from(accountingTransactionsTable)
        .where(not(inArray(accountingTransactionsTable.accountingStatus, ["rejected"]))),
      db.select({ id: operationReceiptsTable.id }).from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.reviewStatus, "pending_review")),
      db.select({ id: operationReceiptsTable.id }).from(operationReceiptsTable)
        .where(isNull(operationReceiptsTable.photoObjectPath)),
      db.select({
        id: accountingTransactionsTable.id,
        dueDate: accountingTransactionsTable.dueDate,
        amount: accountingTransactionsTable.amount,
        currency: accountingTransactionsTable.currency,
        description: accountingTransactionsTable.description,
        type: accountingTransactionsTable.type,
      }).from(accountingTransactionsTable)
        .where(and(
          gte(accountingTransactionsTable.dueDate, today),
          lte(accountingTransactionsTable.dueDate, nextWeek),
          not(inArray(accountingTransactionsTable.paymentStatus, ["paid", "cancelled"])),
        )).orderBy(accountingTransactionsTable.dueDate).limit(5),
      db.select({ id: operationReceiptsTable.id }).from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.reviewStatus, "missing_information")),
      db.select({ id: accountingDocumentsTable.id }).from(accountingDocumentsTable)
        .where(eq(accountingDocumentsTable.reviewStatus, "pending")),
      db.select({ id: accountingDocumentsTable.id }).from(accountingDocumentsTable)
        .where(eq(accountingDocumentsTable.reviewStatus, "missing_information")),
      db.select({
        id: accountingTransactionsTable.id,
        type: accountingTransactionsTable.type,
        dueDate: accountingTransactionsTable.dueDate,
        amount: accountingTransactionsTable.amount,
        currency: accountingTransactionsTable.currency,
        amountTry: accountingTransactionsTable.amountTry,
        description: accountingTransactionsTable.description,
      }).from(accountingTransactionsTable)
        .where(and(
          lte(accountingTransactionsTable.dueDate, today),
          not(inArray(accountingTransactionsTable.paymentStatus, ["paid", "cancelled"])),
        )).orderBy(accountingTransactionsTable.dueDate).limit(20),
    ]);

    // This month income / expenses (TRY equiv)
    const thisMonthTx = txRows.filter(t => t.transactionDate >= monthStart);
    const thisMonthIncome = thisMonthTx
      .filter(t => t.type === "income")
      .reduce((s, t) => s + (t.amountTry ?? (t.currency === "TRY" ? t.amount : 0)), 0);
    const thisMonthExpenses = thisMonthTx
      .filter(t => t.type === "expense")
      .reduce((s, t) => s + (t.amountTry ?? (t.currency === "TRY" ? t.amount : 0)), 0);

    // Pending receivables / payables (all-time unpaid, TRY equiv)
    const pendingReceivablesAmount = txRows
      .filter(t => t.type === "income" && !["paid", "cancelled"].includes(t.paymentStatus))
      .reduce((s, t) => s + (t.amountTry ?? (t.currency === "TRY" ? t.amount : 0)), 0);
    const pendingPayablesAmount = txRows
      .filter(t => t.type === "expense" && !["paid", "cancelled"].includes(t.paymentStatus))
      .reduce((s, t) => s + (t.amountTry ?? (t.currency === "TRY" ? t.amount : 0)), 0);

    // Overdue counts
    const overdueReceivablesCount = overdueRows.filter(t => t.type === "income").length;
    const overduePayablesCount = overdueRows.filter(t => t.type === "expense").length;

    // VAT total on approved transactions
    const vatApprovedTotal = txRows
      .filter(t => t.accountingStatus === "approved")
      .reduce((s, t) => s + ((t as { taxAmount?: number }).taxAmount ?? 0), 0);

    // Expense category breakdown (this month)
    const categoryBreakdown: Record<string, number> = {};
    thisMonthTx
      .filter(t => t.type === "expense")
      .forEach(t => {
        categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + (t.amountTry ?? t.amount);
      });

    // Monthly income vs expense (last 6 months)
    const now = new Date();
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { year: d.getFullYear(), month: d.getMonth(), label: TR_MONTHS[d.getMonth()] };
    });
    const monthlyChart = buckets.map(({ year, month, label }) => {
      const inMonth = txRows.filter(t => {
        if (!t.transactionDate) return false;
        const d = new Date(t.transactionDate);
        return d.getFullYear() === year && d.getMonth() === month;
      });
      return {
        label,
        income: inMonth.filter(t => t.type === "income").reduce((s, t) => s + (t.amountTry ?? t.amount), 0),
        expenses: inMonth.filter(t => t.type === "expense").reduce((s, t) => s + (t.amountTry ?? t.amount), 0),
      };
    });

    return res.json({
      thisMonthIncome,
      thisMonthExpenses,
      grossProfit: thisMonthIncome - thisMonthExpenses,
      netCashFlow: thisMonthIncome - thisMonthExpenses,
      pendingReviewCount: receiptPending.length + docPending.length,
      missingPhotoCount: missingPhoto.length,
      missingInfoCount: missingInfoReceipts.length + missingInfoDocs.length,
      unpaidTransactions: txRows.filter(t => t.type === "income" && t.paymentStatus === "pending").length,
      pendingReceivablesAmount,
      pendingPayablesAmount,
      overdueReceivablesCount,
      overduePayablesCount,
      vatApprovedTotal,
      upcomingDue,
      overdueItems: overdueRows.slice(0, 10),
      categoryBreakdown,
      monthlyChart,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Dashboard verileri yüklenemedi" });
  }
});

// ── Transactions ───────────────────────────────────────────────────────────────

router.get("/transactions", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canRead(role)) return res.status(403).json({ error: "Forbidden" });

    const q = req.query as Record<string, string>;
    const conditions = [];

    if (q.type) conditions.push(eq(accountingTransactionsTable.type, q.type));
    if (q.accountingStatus) conditions.push(eq(accountingTransactionsTable.accountingStatus, q.accountingStatus));
    if (q.paymentStatus) conditions.push(eq(accountingTransactionsTable.paymentStatus, q.paymentStatus));
    if (q.currency) conditions.push(eq(accountingTransactionsTable.currency, q.currency));
    if (q.category) conditions.push(eq(accountingTransactionsTable.category, q.category));
    if (q.operationId) conditions.push(eq(accountingTransactionsTable.operationId, parseInt(q.operationId)));
    if (q.tourId) conditions.push(eq(accountingTransactionsTable.tourId, parseInt(q.tourId)));
    if (q.customerId) conditions.push(eq(accountingTransactionsTable.customerId, parseInt(q.customerId)));
    if (q.supplierId) conditions.push(eq(accountingTransactionsTable.supplierId, parseInt(q.supplierId)));
    if (q.dateFrom) conditions.push(gte(accountingTransactionsTable.transactionDate, q.dateFrom));
    if (q.dateTo) conditions.push(lte(accountingTransactionsTable.transactionDate, q.dateTo));
    if (q.pendingReview === "true") conditions.push(eq(accountingTransactionsTable.accountingStatus, "pending_review"));

    // Operations role: only see transactions for their operations
    if (role === "operations") {
      conditions.push(not(isNull(accountingTransactionsTable.operationId)));
    }

    const rows = await db.select({
      id: accountingTransactionsTable.id,
      type: accountingTransactionsTable.type,
      category: accountingTransactionsTable.category,
      amount: accountingTransactionsTable.amount,
      currency: accountingTransactionsTable.currency,
      amountTry: accountingTransactionsTable.amountTry,
      paymentStatus: accountingTransactionsTable.paymentStatus,
      accountingStatus: accountingTransactionsTable.accountingStatus,
      transactionDate: accountingTransactionsTable.transactionDate,
      dueDate: accountingTransactionsTable.dueDate,
      description: accountingTransactionsTable.description,
      documentNumber: accountingTransactionsTable.documentNumber,
      customerId: accountingTransactionsTable.customerId,
      supplierId: accountingTransactionsTable.supplierId,
      tourId: accountingTransactionsTable.tourId,
      operationId: accountingTransactionsTable.operationId,
      receiptId: accountingTransactionsTable.receiptId,
      createdByProfileId: accountingTransactionsTable.createdByProfileId,
      approvedByProfileId: accountingTransactionsTable.approvedByProfileId,
      approvedAt: accountingTransactionsTable.approvedAt,
      rejectionReason: accountingTransactionsTable.rejectionReason,
      createdAt: accountingTransactionsTable.createdAt,
      customerName: customersTable.name,
      supplierName: suppliersTable.name,
      tourName: toursTable.name,
    })
    .from(accountingTransactionsTable)
    .leftJoin(customersTable, eq(accountingTransactionsTable.customerId, customersTable.id))
    .leftJoin(suppliersTable, eq(accountingTransactionsTable.supplierId, suppliersTable.id))
    .leftJoin(toursTable, eq(accountingTransactionsTable.tourId, toursTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(accountingTransactionsTable.transactionDate))
    .limit(200);

    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "İşlemler yüklenemedi" });
  }
});

router.post("/transactions", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const body = req.body;
    if (!body.amount || body.amount <= 0) return res.status(400).json({ error: "Tutar pozitif olmalıdır" });
    if (!body.type || !["income", "expense"].includes(body.type)) return res.status(400).json({ error: "Geçersiz işlem tipi" });
    if (!body.transactionDate) return res.status(400).json({ error: "İşlem tarihi zorunludur" });

    // Duplicate prevention: same receipt already linked to a transaction
    if (body.receiptId) {
      const [existing] = await db.select({ id: accountingTransactionsTable.id })
        .from(accountingTransactionsTable)
        .where(eq(accountingTransactionsTable.receiptId, body.receiptId))
        .limit(1);
      if (existing) return res.status(409).json({ error: "Bu makbuz için zaten bir işlem oluşturulmuş" });
    }

    const [row] = await db.insert(accountingTransactionsTable)
      .values({ ...body, createdByProfileId: profile.id })
      .returning();
    return res.status(201).json(row);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "İşlem oluşturulamadı" });
  }
});

router.get("/transactions/:id", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canRead(role)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id as string);
    const [row] = await db.select().from(accountingTransactionsTable).where(eq(accountingTransactionsTable.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "Bulunamadı" });
    return res.json(row);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "İşlem yüklenemedi" });
  }
});

router.patch("/transactions/:id", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id as string);
    const [existing] = await db.select({ accountingStatus: accountingTransactionsTable.accountingStatus })
      .from(accountingTransactionsTable).where(eq(accountingTransactionsTable.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Bulunamadı" });
    if (existing.accountingStatus === "approved") return res.status(409).json({ error: "Onaylı işlemler düzenlenemez" });

    const { approvedByProfileId, approvedAt, createdByProfileId, ...safeBody } = req.body;
    const [row] = await db.update(accountingTransactionsTable)
      .set(safeBody)
      .where(eq(accountingTransactionsTable.id, id))
      .returning();
    return res.json(row);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "İşlem güncellenemedi" });
  }
});

router.post("/transactions/:id/approve", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id as string);
    const [row] = await db.update(accountingTransactionsTable)
      .set({ accountingStatus: "approved", approvedByProfileId: profile.id, approvedAt: new Date() })
      .where(eq(accountingTransactionsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Bulunamadı" });
    return res.json(row);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Onaylama başarısız" });
  }
});

router.post("/transactions/:id/reject", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id as string);
    const { reason } = req.body as { reason?: string };
    if (!reason) return res.status(400).json({ error: "Red gerekçesi zorunludur" });

    const [row] = await db.update(accountingTransactionsTable)
      .set({ accountingStatus: "rejected", rejectionReason: reason })
      .where(eq(accountingTransactionsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Bulunamadı" });
    return res.json(row);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Reddetme başarısız" });
  }
});

router.post("/transactions/:id/cancel", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id as string);
    const [existing] = await db.select({ accountingStatus: accountingTransactionsTable.accountingStatus })
      .from(accountingTransactionsTable).where(eq(accountingTransactionsTable.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Bulunamadı" });
    if (existing.accountingStatus === "approved") return res.status(409).json({ error: "Onaylı işlemler silinemez, lütfen tersine işlem oluşturun" });

    const [row] = await db.update(accountingTransactionsTable)
      .set({ paymentStatus: "cancelled", accountingStatus: "rejected" })
      .where(eq(accountingTransactionsTable.id, id))
      .returning();
    return res.json(row);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "İptal edilemedi" });
  }
});

// ── Document review queue ──────────────────────────────────────────────────────

router.get("/documents", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canRead(role)) return res.status(403).json({ error: "Forbidden" });

    const q = req.query as Record<string, string>;
    const receiptConditions = [];
    const docConditions = [];

    if (q.reviewStatus) {
      receiptConditions.push(eq(operationReceiptsTable.reviewStatus, q.reviewStatus));
      docConditions.push(eq(accountingDocumentsTable.reviewStatus, q.reviewStatus));
    }
    if (q.operationId) {
      const opId = parseInt(q.operationId);
      receiptConditions.push(eq(operationReceiptsTable.operationId, opId));
      docConditions.push(eq(accountingDocumentsTable.operationId, opId));
    }
    if (q.missingPhoto === "true") {
      receiptConditions.push(isNull(operationReceiptsTable.photoObjectPath));
    }

    const [receipts, docs] = await Promise.all([
      db.select({
        id: operationReceiptsTable.id,
        _source: sql<string>`'receipt'`,
        operationId: operationReceiptsTable.operationId,
        amount: operationReceiptsTable.amount,
        currency: operationReceiptsTable.currency,
        supplierName: operationReceiptsTable.supplierName,
        date: operationReceiptsTable.receiptDate,
        guideNote: operationReceiptsTable.guideNote,
        photoObjectPath: operationReceiptsTable.photoObjectPath,
        reviewStatus: operationReceiptsTable.reviewStatus,
        reviewNotes: operationReceiptsTable.reviewNotes,
        ocrStatus: operationReceiptsTable.ocrStatus,
        linkedTransactionId: sql<number | null>`(SELECT id FROM accounting_transactions WHERE receipt_id = ${operationReceiptsTable.id} LIMIT 1)`,
        createdAt: operationReceiptsTable.createdAt,
        tourName: toursTable.name,
        guideName: operationsTable.guideName,
      })
      .from(operationReceiptsTable)
      .leftJoin(operationsTable, eq(operationReceiptsTable.operationId, operationsTable.id))
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .where(receiptConditions.length > 0 ? and(...receiptConditions) : undefined)
      .orderBy(desc(operationReceiptsTable.createdAt))
      .limit(100),

      db.select({
        id: accountingDocumentsTable.id,
        _source: sql<string>`'document'`,
        operationId: accountingDocumentsTable.operationId,
        documentType: accountingDocumentsTable.documentType,
        objectPath: accountingDocumentsTable.objectPath,
        originalFileName: accountingDocumentsTable.originalFileName,
        reviewStatus: accountingDocumentsTable.reviewStatus,
        notes: accountingDocumentsTable.notes,
        ocrStatus: accountingDocumentsTable.ocrStatus,
        transactionId: accountingDocumentsTable.transactionId,
        createdAt: accountingDocumentsTable.createdAt,
      })
      .from(accountingDocumentsTable)
      .where(docConditions.length > 0 ? and(...docConditions) : undefined)
      .orderBy(desc(accountingDocumentsTable.createdAt))
      .limit(100),
    ]);

    return res.json({ receipts, documents: docs });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Belgeler yüklenemedi" });
  }
});

router.post("/documents/:id/review", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id as string);
    const { action, notes } = req.body as { action: string; notes?: string };
    if (!action || !["approved", "rejected", "missing_information"].includes(action)) {
      return res.status(400).json({ error: "Geçersiz işlem" });
    }
    if (action === "rejected" && !notes) return res.status(400).json({ error: "Red gerekçesi zorunludur" });

    const [row] = await db.update(accountingDocumentsTable)
      .set({ reviewStatus: action, notes, reviewedByProfileId: profile.id, reviewedAt: new Date() })
      .where(eq(accountingDocumentsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Bulunamadı" });
    return res.json(row);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Belge inceleme başarısız" });
  }
});

// ── Receipt review ─────────────────────────────────────────────────────────────

router.post("/receipts/:id/review", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id as string);
    const { action, notes } = req.body as { action: string; notes?: string };
    if (!action || !["approved", "rejected", "missing_information"].includes(action)) {
      return res.status(400).json({ error: "Geçersiz işlem" });
    }
    if (action === "rejected" && !notes) return res.status(400).json({ error: "Red gerekçesi zorunludur" });

    const [row] = await db.update(operationReceiptsTable)
      .set({ reviewStatus: action, reviewNotes: notes, reviewedByProfileId: profile.id, reviewedAt: new Date() })
      .where(eq(operationReceiptsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Bulunamadı" });
    return res.json(row);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Makbuz inceleme başarısız" });
  }
});

router.post("/receipts/:id/create-transaction", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id as string);

    // Duplicate check
    const [duplicate] = await db.select({ id: accountingTransactionsTable.id })
      .from(accountingTransactionsTable)
      .where(eq(accountingTransactionsTable.receiptId, id))
      .limit(1);
    if (duplicate) return res.status(409).json({ error: "Bu makbuz için zaten bir işlem mevcut" });

    const [receipt] = await db.select().from(operationReceiptsTable).where(eq(operationReceiptsTable.id, id)).limit(1);
    if (!receipt) return res.status(404).json({ error: "Makbuz bulunamadı" });

    const today = todayStr();
    const [tx] = await db.insert(accountingTransactionsTable)
      .values({
        type: "expense",
        category: "other",
        amount: receipt.amount,
        currency: receipt.currency,
        transactionDate: receipt.receiptDate ?? today,
        description: receipt.guideNote ?? `Makbuz #${receipt.id}`,
        operationId: receipt.operationId,
        receiptId: receipt.id,
        createdByProfileId: profile.id,
        paymentStatus: "pending",
        accountingStatus: "pending_review",
      })
      .returning();
    return res.status(201).json(tx);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "İşlem oluşturulamadı" });
  }
});

// ── Operation accounting file ──────────────────────────────────────────────────

router.get("/operations/:id", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canRead(role)) return res.status(403).json({ error: "Forbidden" });

    const operationId = parseInt(req.params.id as string);

    const [operation, transactions, receipts, documents] = await Promise.all([
      db.select({
        id: operationsTable.id,
        startDate: operationsTable.startDate,
        endDate: operationsTable.endDate,
        status: operationsTable.status,
        completionRate: operationsTable.completionRate,
        guideName: operationsTable.guideName,
        driverName: operationsTable.driverName,
        notes: operationsTable.notes,
        assignedGuideUserId: operationsTable.assignedGuideUserId,
        customerId: operationsTable.customerId,
        tourId: operationsTable.tourId,
        quotationId: operationsTable.quotationId,
        tourName: toursTable.name,
        customerName: customersTable.name,
      })
      .from(operationsTable)
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .leftJoin(customersTable, eq(operationsTable.customerId, customersTable.id))
      .where(eq(operationsTable.id, operationId))
      .limit(1),

      db.select({
        id: accountingTransactionsTable.id,
        type: accountingTransactionsTable.type,
        category: accountingTransactionsTable.category,
        amount: accountingTransactionsTable.amount,
        currency: accountingTransactionsTable.currency,
        amountTry: accountingTransactionsTable.amountTry,
        paymentStatus: accountingTransactionsTable.paymentStatus,
        accountingStatus: accountingTransactionsTable.accountingStatus,
        transactionDate: accountingTransactionsTable.transactionDate,
        description: accountingTransactionsTable.description,
        documentNumber: accountingTransactionsTable.documentNumber,
        supplierName: suppliersTable.name,
      })
      .from(accountingTransactionsTable)
      .leftJoin(suppliersTable, eq(accountingTransactionsTable.supplierId, suppliersTable.id))
      .where(eq(accountingTransactionsTable.operationId, operationId))
      .orderBy(accountingTransactionsTable.transactionDate),

      db.select().from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.operationId, operationId))
        .orderBy(desc(operationReceiptsTable.createdAt)),

      db.select().from(accountingDocumentsTable)
        .where(eq(accountingDocumentsTable.operationId, operationId))
        .orderBy(desc(accountingDocumentsTable.createdAt)),
    ]);

    if (!operation[0]) return res.status(404).json({ error: "Operasyon bulunamadı" });

    // Currency totals
    const currencyTotals: Record<string, { income: number; expenses: number; net: number }> = {};
    for (const tx of transactions) {
      const cur = tx.currency;
      if (!currencyTotals[cur]) currencyTotals[cur] = { income: 0, expenses: 0, net: 0 };
      if (tx.type === "income") currencyTotals[cur].income += tx.amount;
      else currencyTotals[cur].expenses += tx.amount;
      currencyTotals[cur].net = currencyTotals[cur].income - currencyTotals[cur].expenses;
    }

    // Missing document warnings
    const missingWarnings: string[] = [];
    if (receipts.some(r => !r.photoObjectPath)) missingWarnings.push("Bazı makbuzlarda fotoğraf eksik");
    if (receipts.some(r => r.reviewStatus === "pending_review")) missingWarnings.push("İnceleme bekleyen makbuzlar var");
    if (transactions.some(t => t.accountingStatus === "pending_review")) missingWarnings.push("Onay bekleyen işlemler var");

    return res.json({
      operation: operation[0],
      transactions,
      receipts,
      documents,
      currencyTotals,
      missingWarnings,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Operasyon muhasebe dosyası yüklenemedi" });
  }
});

// ── Mark transaction as missing info ────────────────────────────────────────────

router.post("/transactions/:id/mark-missing", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });
    const id = parseInt(req.params.id as string);
    const [row] = await db.update(accountingTransactionsTable)
      .set({ accountingStatus: "missing_information" })
      .where(eq(accountingTransactionsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Bulunamadı" });
    return res.json(row);
  } catch (e) { console.error(e); return res.status(500).json({ error: "Güncelleme başarısız" }); }
});

// ── Mark transaction as paid ──────────────────────────────────────────────────

router.post("/transactions/:id/mark-paid", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });
    const id = parseInt(req.params.id as string);
    const [row] = await db.update(accountingTransactionsTable)
      .set({ paymentStatus: "paid", paidAt: new Date() })
      .where(eq(accountingTransactionsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Bulunamadı" });
    return res.json(row);
  } catch (e) { console.error(e); return res.status(500).json({ error: "Güncelleme başarısız" }); }
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get("/settings", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canRead(role)) return res.status(403).json({ error: "Forbidden" });
    const [settings] = await db.select().from(accountingSettingsTable).limit(1);
    if (!settings) {
      return res.json({
        id: null, defaultCurrency: "TRY", fiscalYearStartMonth: 1,
        defaultVatRate: 20, vatRates: '["0","1","8","10","20"]',
        paymentMethods: '["Nakit","Kredi Kartı","Havale/EFT","Çek","Döviz"]',
        documentNumberPrefix: "TRP", accountantNotes: null,
      });
    }
    return res.json(settings);
  } catch (e) { console.error(e); return res.status(500).json({ error: "Ayarlar yüklenemedi" }); }
});

router.put("/settings", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });
    const { id: _id, createdAt: _c, updatedAt: _u, ...body } = req.body;
    const [existing] = await db.select({ id: accountingSettingsTable.id }).from(accountingSettingsTable).limit(1);
    if (existing) {
      const [row] = await db.update(accountingSettingsTable).set(body).where(eq(accountingSettingsTable.id, existing.id)).returning();
      return res.json(row);
    }
    const [row] = await db.insert(accountingSettingsTable).values(body).returning();
    return res.status(201).json(row);
  } catch (e) { console.error(e); return res.status(500).json({ error: "Ayarlar kaydedilemedi" }); }
});

// ── Receivables ───────────────────────────────────────────────────────────────

router.get("/receivables", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canRead(role)) return res.status(403).json({ error: "Forbidden" });
    const today = todayStr();
    const rows = await db.select({
      id: accountingTransactionsTable.id,
      category: accountingTransactionsTable.category,
      amount: accountingTransactionsTable.amount,
      currency: accountingTransactionsTable.currency,
      amountTry: accountingTransactionsTable.amountTry,
      paymentStatus: accountingTransactionsTable.paymentStatus,
      transactionDate: accountingTransactionsTable.transactionDate,
      dueDate: accountingTransactionsTable.dueDate,
      description: accountingTransactionsTable.description,
      documentNumber: accountingTransactionsTable.documentNumber,
      operationId: accountingTransactionsTable.operationId,
      customerName: customersTable.name,
      tourName: toursTable.name,
    })
    .from(accountingTransactionsTable)
    .leftJoin(customersTable, eq(accountingTransactionsTable.customerId, customersTable.id))
    .leftJoin(toursTable, eq(accountingTransactionsTable.tourId, toursTable.id))
    .where(and(
      eq(accountingTransactionsTable.type, "income"),
      not(inArray(accountingTransactionsTable.paymentStatus, ["paid", "cancelled"])),
    ))
    .orderBy(accountingTransactionsTable.dueDate)
    .limit(200);
    return res.json(rows.map(r => ({
      ...r,
      overdueDays: r.dueDate && r.dueDate < today
        ? Math.floor((Date.now() - new Date(r.dueDate).getTime()) / 86400000) : 0,
      isOverdue: r.dueDate ? r.dueDate < today : false,
    })));
  } catch (e) { console.error(e); return res.status(500).json({ error: "Alacaklar yüklenemedi" }); }
});

// ── Payables ──────────────────────────────────────────────────────────────────

router.get("/payables", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canRead(role)) return res.status(403).json({ error: "Forbidden" });
    const today = todayStr();
    const rows = await db.select({
      id: accountingTransactionsTable.id,
      category: accountingTransactionsTable.category,
      amount: accountingTransactionsTable.amount,
      currency: accountingTransactionsTable.currency,
      amountTry: accountingTransactionsTable.amountTry,
      paymentStatus: accountingTransactionsTable.paymentStatus,
      transactionDate: accountingTransactionsTable.transactionDate,
      dueDate: accountingTransactionsTable.dueDate,
      description: accountingTransactionsTable.description,
      documentNumber: accountingTransactionsTable.documentNumber,
      operationId: accountingTransactionsTable.operationId,
      supplierName: suppliersTable.name,
      tourName: toursTable.name,
    })
    .from(accountingTransactionsTable)
    .leftJoin(suppliersTable, eq(accountingTransactionsTable.supplierId, suppliersTable.id))
    .leftJoin(toursTable, eq(accountingTransactionsTable.tourId, toursTable.id))
    .where(and(
      eq(accountingTransactionsTable.type, "expense"),
      not(inArray(accountingTransactionsTable.paymentStatus, ["paid", "cancelled"])),
    ))
    .orderBy(accountingTransactionsTable.dueDate)
    .limit(200);
    return res.json(rows.map(r => ({
      ...r,
      overdueDays: r.dueDate && r.dueDate < today
        ? Math.floor((Date.now() - new Date(r.dueDate).getTime()) / 86400000) : 0,
      isOverdue: r.dueDate ? r.dueDate < today : false,
    })));
  } catch (e) { console.error(e); return res.status(500).json({ error: "Borçlar yüklenemedi" }); }
});

// ── Document / receipt detail ──────────────────────────────────────────────────

router.get("/documents/:type/:id", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const { type, id: idStr } = req.params as { type: string; id: string };
    const id = parseInt(idStr);
    if (!["receipt", "document"].includes(type)) return res.status(400).json({ error: "Geçersiz tür" });

    if (type === "receipt") {
      const [row] = await db.select({
        id: operationReceiptsTable.id,
        amount: operationReceiptsTable.amount,
        currency: operationReceiptsTable.currency,
        supplierName: operationReceiptsTable.supplierName,
        receiptDate: operationReceiptsTable.receiptDate,
        guideNote: operationReceiptsTable.guideNote,
        photoObjectPath: operationReceiptsTable.photoObjectPath,
        ocrStatus: operationReceiptsTable.ocrStatus,
        reviewStatus: operationReceiptsTable.reviewStatus,
        reviewNotes: operationReceiptsTable.reviewNotes,
        reviewedByProfileId: operationReceiptsTable.reviewedByProfileId,
        reviewedAt: operationReceiptsTable.reviewedAt,
        correctedFields: operationReceiptsTable.correctedFields,
        operationId: operationReceiptsTable.operationId,
        createdByUserId: operationReceiptsTable.createdByUserId,
        createdAt: operationReceiptsTable.createdAt,
        updatedAt: operationReceiptsTable.updatedAt,
        tourName: toursTable.name,
        customerName: customersTable.name,
        guideName: operationsTable.guideName,
        driverName: operationsTable.driverName,
        startDate: operationsTable.startDate,
        endDate: operationsTable.endDate,
      })
      .from(operationReceiptsTable)
      .leftJoin(operationsTable, eq(operationReceiptsTable.operationId, operationsTable.id))
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .leftJoin(customersTable, eq(operationsTable.customerId, customersTable.id))
      .where(eq(operationReceiptsTable.id, id))
      .limit(1);

      if (!row) return res.status(404).json({ error: "Makbuz bulunamadı" });

      // Reviewer profile + linked transaction + operation expense total
      const [reviewerRow, linkedTxRow, expRow] = await Promise.all([
        row.reviewedByProfileId
          ? db.select({ name: profilesTable.name }).from(profilesTable).where(eq(profilesTable.id, row.reviewedByProfileId)).limit(1)
          : Promise.resolve([]),
        db.select({ id: accountingTransactionsTable.id, accountingStatus: accountingTransactionsTable.accountingStatus, paymentStatus: accountingTransactionsTable.paymentStatus })
          .from(accountingTransactionsTable).where(eq(accountingTransactionsTable.receiptId, id)).limit(1),
        row.operationId
          ? db.select({ total: sql<number>`COALESCE(SUM(${accountingTransactionsTable.amount}), 0)` })
              .from(accountingTransactionsTable)
              .where(and(eq(accountingTransactionsTable.operationId, row.operationId), eq(accountingTransactionsTable.type, "expense"), eq(accountingTransactionsTable.accountingStatus, "approved")))
          : Promise.resolve([{ total: 0 }]),
      ]);

      return res.json({
        type: "receipt",
        ...row,
        reviewerName: reviewerRow[0]?.name ?? null,
        linkedTransaction: linkedTxRow[0] ?? null,
        operationExpenses: Number(expRow[0]?.total ?? 0),
      });

    } else {
      const [row] = await db.select({
        id: accountingDocumentsTable.id,
        documentType: accountingDocumentsTable.documentType,
        objectPath: accountingDocumentsTable.objectPath,
        originalFileName: accountingDocumentsTable.originalFileName,
        mimeType: accountingDocumentsTable.mimeType,
        fileSize: accountingDocumentsTable.fileSize,
        ocrStatus: accountingDocumentsTable.ocrStatus,
        reviewStatus: accountingDocumentsTable.reviewStatus,
        notes: accountingDocumentsTable.notes,
        correctedFields: accountingDocumentsTable.correctedFields,
        transactionId: accountingDocumentsTable.transactionId,
        operationId: accountingDocumentsTable.operationId,
        createdByProfileId: accountingDocumentsTable.createdByProfileId,
        reviewedByProfileId: accountingDocumentsTable.reviewedByProfileId,
        reviewedAt: accountingDocumentsTable.reviewedAt,
        createdAt: accountingDocumentsTable.createdAt,
        updatedAt: accountingDocumentsTable.updatedAt,
        tourName: toursTable.name,
        customerName: customersTable.name,
        guideName: operationsTable.guideName,
        driverName: operationsTable.driverName,
        startDate: operationsTable.startDate,
        endDate: operationsTable.endDate,
      })
      .from(accountingDocumentsTable)
      .leftJoin(operationsTable, eq(accountingDocumentsTable.operationId, operationsTable.id))
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .leftJoin(customersTable, eq(operationsTable.customerId, customersTable.id))
      .where(eq(accountingDocumentsTable.id, id))
      .limit(1);

      if (!row) return res.status(404).json({ error: "Belge bulunamadı" });

      const [creatorRow, reviewerRow, linkedTxRow] = await Promise.all([
        db.select({ name: profilesTable.name }).from(profilesTable).where(eq(profilesTable.id, row.createdByProfileId)).limit(1),
        row.reviewedByProfileId
          ? db.select({ name: profilesTable.name }).from(profilesTable).where(eq(profilesTable.id, row.reviewedByProfileId)).limit(1)
          : Promise.resolve([]),
        row.transactionId
          ? db.select({ id: accountingTransactionsTable.id, accountingStatus: accountingTransactionsTable.accountingStatus, paymentStatus: accountingTransactionsTable.paymentStatus })
              .from(accountingTransactionsTable).where(eq(accountingTransactionsTable.id, row.transactionId)).limit(1)
          : Promise.resolve([]),
      ]);

      return res.json({
        type: "document",
        ...row,
        creatorName: creatorRow[0]?.name ?? null,
        reviewerName: reviewerRow[0]?.name ?? null,
        linkedTransaction: linkedTxRow[0] ?? null,
      });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Belge detayı yüklenemedi" });
  }
});

// ── Save corrected fields ──────────────────────────────────────────────────────

router.put("/documents/:type/:id", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const { type, id: idStr } = req.params as { type: string; id: string };
    const id = parseInt(idStr);
    if (!["receipt", "document"].includes(type)) return res.status(400).json({ error: "Geçersiz tür" });

    const { correctedFields, notes } = req.body as { correctedFields?: Record<string, unknown>; notes?: string };
    const cfJson = correctedFields !== undefined ? JSON.stringify(correctedFields) : undefined;

    if (type === "receipt") {
      const [row] = await db.select({ reviewStatus: operationReceiptsTable.reviewStatus })
        .from(operationReceiptsTable).where(eq(operationReceiptsTable.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "Bulunamadı" });
      if (row.reviewStatus === "approved") return res.status(409).json({ error: "Onaylanmış kayıt düzenlenemez" });
      const [updated] = await db.update(operationReceiptsTable)
        .set({ ...(cfJson !== undefined ? { correctedFields: cfJson } : {}), updatedAt: new Date() })
        .where(eq(operationReceiptsTable.id, id)).returning();
      return res.json(updated);
    } else {
      const [row] = await db.select({ reviewStatus: accountingDocumentsTable.reviewStatus })
        .from(accountingDocumentsTable).where(eq(accountingDocumentsTable.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "Bulunamadı" });
      if (row.reviewStatus === "approved") return res.status(409).json({ error: "Onaylanmış kayıt düzenlenemez" });
      const [updated] = await db.update(accountingDocumentsTable)
        .set({
          ...(cfJson !== undefined ? { correctedFields: cfJson } : {}),
          ...(notes !== undefined ? { notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(accountingDocumentsTable.id, id)).returning();
      return res.json(updated);
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Düzenlemeler kaydedilemedi" });
  }
});

// ── File proxy ─────────────────────────────────────────────────────────────────

router.get("/documents/:type/:id/file", async (req, res) => {
  try {
    const profile = res.locals.profile;
    if (!canWrite(profile.role)) return res.status(403).json({ error: "Forbidden" });

    const { type, id: idStr } = req.params as { type: string; id: string };
    const id = parseInt(idStr);
    if (!["receipt", "document"].includes(type)) return res.status(400).json({ error: "Geçersiz tür" });

    let objectPath: string | null = null;
    let fileName = "dosya";
    let mimeType = "application/octet-stream";

    if (type === "receipt") {
      const [row] = await db.select({ photoObjectPath: operationReceiptsTable.photoObjectPath })
        .from(operationReceiptsTable).where(eq(operationReceiptsTable.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "Makbuz bulunamadı" });
      if (!row.photoObjectPath) return res.status(404).json({ error: "Bu makbuzda fotoğraf yok" });
      objectPath = row.photoObjectPath;
      const ext = objectPath.endsWith(".png") ? "png" : "jpg";
      fileName = `makbuz-${id}.${ext}`;
      mimeType = ext === "png" ? "image/png" : "image/jpeg";
    } else {
      const [row] = await db.select({
        objectPath: accountingDocumentsTable.objectPath,
        originalFileName: accountingDocumentsTable.originalFileName,
        mimeType: accountingDocumentsTable.mimeType,
      }).from(accountingDocumentsTable).where(eq(accountingDocumentsTable.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "Belge bulunamadı" });
      objectPath = row.objectPath;
      fileName = row.originalFileName;
      mimeType = row.mimeType;
    }

    try {
      const file = await objectStorageService.getObjectEntityFile(objectPath!);
      const [metadata] = await file.getMetadata();
      const ct = (metadata.contentType as string) || mimeType;
      res.setHeader("Content-Type", ct);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
      if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
      file.createReadStream().pipe(res);
    } catch (storageErr) {
      if (storageErr instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Dosya depolamada bulunamadı" });
      }
      throw storageErr;
    }
    return;
  } catch (e) {
    console.error(e);
    if (!res.headersSent) return res.status(500).json({ error: "Dosya sunulamadı" });
    return;
  }
});

export default router;
