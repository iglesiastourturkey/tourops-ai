import { Router } from "express";
import { Readable } from "stream";
import type ExcelJS from "exceljs";
import { db } from "@workspace/db";
import {
  accountingTransactionsTable,
  operationReceiptsTable,
  operationsTable,
  toursTable,
  customersTable,
  suppliersTable,
  profilesTable,
  agencySettingsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, not, desc } from "drizzle-orm";
import { requireAuth, getProfile } from "../lib/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router = Router();
router.use(requireAuth, getProfile);

const objectStorageService = new ObjectStorageService();

function canExport(role: string) {
  return role === "super_admin" || role === "admin" || role === "accounting";
}

// ── Shared: build transaction query from filters ──────────────────────────────

interface ExportFilters {
  type?: string;
  accountingStatus?: string;
  paymentStatus?: string;
  currency?: string;
  category?: string;
  operationId?: number;
  tourId?: number;
  customerId?: number;
  supplierId?: number;
  dateFrom?: string;
  dateTo?: string;
  selectedIds?: number[];
}

async function queryTransactions(filters: ExportFilters) {
  const conds: ReturnType<typeof eq>[] = [];
  if (filters.type) conds.push(eq(accountingTransactionsTable.type, filters.type));
  if (filters.accountingStatus) conds.push(eq(accountingTransactionsTable.accountingStatus, filters.accountingStatus));
  if (filters.paymentStatus) conds.push(eq(accountingTransactionsTable.paymentStatus, filters.paymentStatus));
  if (filters.currency) conds.push(eq(accountingTransactionsTable.currency, filters.currency));
  if (filters.category) conds.push(eq(accountingTransactionsTable.category, filters.category));
  if (filters.operationId) conds.push(eq(accountingTransactionsTable.operationId, filters.operationId));
  if (filters.tourId) conds.push(eq(accountingTransactionsTable.tourId, filters.tourId));
  if (filters.customerId) conds.push(eq(accountingTransactionsTable.customerId, filters.customerId));
  if (filters.supplierId) conds.push(eq(accountingTransactionsTable.supplierId, filters.supplierId));
  if (filters.dateFrom) conds.push(gte(accountingTransactionsTable.transactionDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(accountingTransactionsTable.transactionDate, filters.dateTo));
  if (filters.selectedIds && filters.selectedIds.length > 0) {
    conds.push(inArray(accountingTransactionsTable.id, filters.selectedIds));
  }

  return db.select({
    id: accountingTransactionsTable.id,
    type: accountingTransactionsTable.type,
    category: accountingTransactionsTable.category,
    amount: accountingTransactionsTable.amount,
    currency: accountingTransactionsTable.currency,
    amountTry: accountingTransactionsTable.amountTry,
    exchangeRate: accountingTransactionsTable.exchangeRate,
    taxRate: accountingTransactionsTable.taxRate,
    taxAmount: accountingTransactionsTable.taxAmount,
    netAmount: accountingTransactionsTable.netAmount,
    paymentMethod: accountingTransactionsTable.paymentMethod,
    paymentStatus: accountingTransactionsTable.paymentStatus,
    accountingStatus: accountingTransactionsTable.accountingStatus,
    transactionDate: accountingTransactionsTable.transactionDate,
    dueDate: accountingTransactionsTable.dueDate,
    description: accountingTransactionsTable.description,
    documentNumber: accountingTransactionsTable.documentNumber,
    operationId: accountingTransactionsTable.operationId,
    receiptId: accountingTransactionsTable.receiptId,
    customerName: customersTable.name,
    supplierName: suppliersTable.name,
    tourName: toursTable.name,
  })
  .from(accountingTransactionsTable)
  .leftJoin(customersTable, eq(accountingTransactionsTable.customerId, customersTable.id))
  .leftJoin(suppliersTable, eq(accountingTransactionsTable.supplierId, suppliersTable.id))
  .leftJoin(toursTable, eq(accountingTransactionsTable.tourId, toursTable.id))
  .where(conds.length > 0 ? and(...conds) : undefined)
  .orderBy(desc(accountingTransactionsTable.transactionDate))
  .limit(2000);
}

async function queryReceipts(filters: ExportFilters) {
  const conds: ReturnType<typeof eq>[] = [];
  if (filters.operationId) conds.push(eq(operationReceiptsTable.operationId, filters.operationId));
  return db.select({
    id: operationReceiptsTable.id,
    operationId: operationReceiptsTable.operationId,
    amount: operationReceiptsTable.amount,
    currency: operationReceiptsTable.currency,
    supplierName: operationReceiptsTable.supplierName,
    receiptDate: operationReceiptsTable.receiptDate,
    guideNote: operationReceiptsTable.guideNote,
    photoObjectPath: operationReceiptsTable.photoObjectPath,
    reviewStatus: operationReceiptsTable.reviewStatus,
    tourName: toursTable.name,
    guideName: operationsTable.guideName,
  })
  .from(operationReceiptsTable)
  .leftJoin(operationsTable, eq(operationReceiptsTable.operationId, operationsTable.id))
  .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
  .where(conds.length > 0 ? and(...conds) : undefined)
  .orderBy(desc(operationReceiptsTable.createdAt))
  .limit(1000);
}

async function getAgencyName(): Promise<string> {
  try {
    const [settings] = await db.select({ name: agencySettingsTable.name }).from(agencySettingsTable).limit(1);
    return settings?.name ?? "TourPilot";
  } catch { return "TourPilot"; }
}

const TR_MONTH_NAMES = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
function trDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.getDate()} ${TR_MONTH_NAMES[dt.getMonth()]} ${dt.getFullYear()}`;
}
function fmtCurrency(amount: number, currency: string) {
  return `${amount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

const TX_TYPE_LABELS: Record<string, string> = { income: "Gelir", expense: "Gider" };
const PAYMENT_STATUS_LABELS: Record<string, string> = { pending: "Bekliyor", paid: "Ödendi", partially_paid: "Kısmi Ödendi", cancelled: "İptal" };
const ACCT_STATUS_LABELS: Record<string, string> = { pending_review: "İnceleme Bekliyor", approved: "Onaylandı", rejected: "Reddedildi", missing_information: "Eksik Bilgi" };
const REVIEW_STATUS_LABELS: Record<string, string> = { pending_review: "Bekliyor", approved: "Onaylandı", rejected: "Reddedildi", missing_information: "Eksik" };

// ── PDF Export ─────────────────────────────────────────────────────────────────

router.post("/pdf", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canExport(role)) return res.status(403).json({ error: "Forbidden" });

    const filters: ExportFilters = req.body?.filters ?? {};
    const [transactions, receipts, agencyName] = await Promise.all([
      queryTransactions(filters),
      queryReceipts(filters),
      getAgencyName(),
    ]);

    // Dynamic import to avoid loading pdfkit at server startup
    const { default: PDFDocument } = await import("pdfkit");
    const doc = new PDFDocument({ margin: 50, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="muhasebe-raporu-${Date.now()}.pdf"`);
    doc.pipe(res);

    const now = new Date();
    const reportDate = `${now.getDate()} ${TR_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
    const NAVY = "#1e3a5f";
    const TEAL = "#0d7377";
    const GRAY = "#666";

    // ── Header ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(NAVY);
    doc.fillColor("white").fontSize(18).font("Helvetica-Bold").text("TourPilot", 50, 20);
    doc.fontSize(10).font("Helvetica").text(agencyName, 50, 44);
    doc.text(`Rapor Tarihi: ${reportDate}`, doc.page.width - 250, 44, { align: "right" });
    doc.text("Muhasebe ve Finans Raporu", doc.page.width - 250, 58, { align: "right" });
    doc.fillColor("black").moveDown(2);

    // ── Summary ──────────────────────────────────────────────────────────────
    const income = transactions.filter(t => t.type === "income");
    const expenses = transactions.filter(t => t.type === "expense");
    const totalIncomeTry = income.reduce((s, t) => s + (t.amountTry ?? (t.currency === "TRY" ? t.amount : 0)), 0);
    const totalExpenseTry = expenses.reduce((s, t) => s + (t.amountTry ?? (t.currency === "TRY" ? t.amount : 0)), 0);

    doc.fillColor(NAVY).fontSize(13).font("Helvetica-Bold").text("Özet", 50, doc.y);
    doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(TEAL).stroke();
    doc.moveDown(0.5);

    const summaryItems = [
      ["Toplam Gelir (TRY)", fmtCurrency(totalIncomeTry, "TRY")],
      ["Toplam Gider (TRY)", fmtCurrency(totalExpenseTry, "TRY")],
      ["Tahmini Brüt Kar (TRY)", fmtCurrency(totalIncomeTry - totalExpenseTry, "TRY")],
      ["İşlem Sayısı", String(transactions.length)],
      ["Makbuz Sayısı", String(receipts.length)],
    ];
    doc.fontSize(10).font("Helvetica");
    for (const [label, value] of summaryItems) {
      doc.fillColor(GRAY).text(label, 60, doc.y, { continued: true, width: 200 });
      doc.fillColor("black").text(value, { align: "right" });
    }
    doc.moveDown(1);

    // ── Income table ─────────────────────────────────────────────────────────
    if (income.length > 0) {
      doc.fillColor(NAVY).fontSize(12).font("Helvetica-Bold").text("Gelir Kayıtları");
      doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(TEAL).stroke();
      doc.moveDown(0.5);

      doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY);
      doc.text("Tarih", 50, doc.y, { width: 75 });
      doc.text("Açıklama", 130, doc.y - doc.currentLineHeight(true), { width: 170 });
      doc.text("Müşteri", 305, doc.y - doc.currentLineHeight(true), { width: 100 });
      doc.text("Tutar", 410, doc.y - doc.currentLineHeight(true), { width: 80 });
      doc.text("Durum", 495, doc.y - doc.currentLineHeight(true), { width: 70 });
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#ccc").stroke();
      doc.moveDown(0.3);

      doc.font("Helvetica").fillColor("black").fontSize(8);
      for (const tx of income.slice(0, 50)) {
        if (doc.y > doc.page.height - 100) doc.addPage();
        doc.text(trDate(tx.transactionDate), 50, doc.y, { width: 75 });
        doc.text(tx.description ?? "—", 130, doc.y - doc.currentLineHeight(true), { width: 170 });
        doc.text(tx.customerName ?? "—", 305, doc.y - doc.currentLineHeight(true), { width: 100 });
        doc.text(fmtCurrency(tx.amount, tx.currency), 410, doc.y - doc.currentLineHeight(true), { width: 80 });
        doc.text(PAYMENT_STATUS_LABELS[tx.paymentStatus] ?? tx.paymentStatus, 495, doc.y - doc.currentLineHeight(true), { width: 70 });
        doc.moveDown(0.2);
        doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#eee").stroke();
        doc.moveDown(0.2);
      }
      doc.moveDown(1);
    }

    // ── Expense table ─────────────────────────────────────────────────────────
    if (expenses.length > 0) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc.fillColor(NAVY).fontSize(12).font("Helvetica-Bold").text("Gider Kayıtları");
      doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(TEAL).stroke();
      doc.moveDown(0.5);

      doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY);
      doc.text("Tarih", 50, doc.y, { width: 75 });
      doc.text("Kategori", 130, doc.y - doc.currentLineHeight(true), { width: 100 });
      doc.text("Açıklama", 235, doc.y - doc.currentLineHeight(true), { width: 150 });
      doc.text("Tedarikçi", 390, doc.y - doc.currentLineHeight(true), { width: 90 });
      doc.text("Tutar", 485, doc.y - doc.currentLineHeight(true), { width: 80 });
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#ccc").stroke();
      doc.moveDown(0.3);

      doc.font("Helvetica").fillColor("black").fontSize(8);
      for (const tx of expenses.slice(0, 50)) {
        if (doc.y > doc.page.height - 100) doc.addPage();
        doc.text(trDate(tx.transactionDate), 50, doc.y, { width: 75 });
        doc.text(tx.category, 130, doc.y - doc.currentLineHeight(true), { width: 100 });
        doc.text(tx.description ?? "—", 235, doc.y - doc.currentLineHeight(true), { width: 150 });
        doc.text(tx.supplierName ?? "—", 390, doc.y - doc.currentLineHeight(true), { width: 90 });
        doc.text(fmtCurrency(tx.amount, tx.currency), 485, doc.y - doc.currentLineHeight(true), { width: 80 });
        doc.moveDown(0.2);
        doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#eee").stroke();
        doc.moveDown(0.2);
      }
      doc.moveDown(1);
    }

    // ── Receipt checklist ─────────────────────────────────────────────────────
    if (receipts.length > 0) {
      if (doc.y > doc.page.height - 150) doc.addPage();
      doc.fillColor(NAVY).fontSize(12).font("Helvetica-Bold").text("Makbuz Listesi");
      doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(TEAL).stroke();
      doc.moveDown(0.5);

      doc.fontSize(8).font("Helvetica").fillColor("black");
      for (const r of receipts.slice(0, 30)) {
        if (doc.y > doc.page.height - 80) doc.addPage();
        const hasPhoto = r.photoObjectPath ? "✓ Fotoğraf" : "✗ Fotoğraf Yok";
        const status = REVIEW_STATUS_LABELS[r.reviewStatus] ?? r.reviewStatus;
        doc.text(
          `[${r.id}] ${trDate(r.receiptDate)} — ${fmtCurrency(r.amount, r.currency)} — ${r.supplierName ?? "Tedarikçi"} — ${hasPhoto} — ${status}`,
          60, doc.y
        );
        doc.moveDown(0.3);
      }
    }

    // ── Page numbers ───────────────────────────────────────────────────────────
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fillColor(GRAY).fontSize(8).text(
        `Sayfa ${i + 1} / ${pageCount}`,
        50, doc.page.height - 30, { align: "center" }
      );
    }

    doc.end();
    return;
  } catch (e) {
    console.error(e);
    if (!res.headersSent) return res.status(500).json({ error: "PDF oluşturulamadı" });
    return;
  }
});

// ── Excel Export ───────────────────────────────────────────────────────────────

router.post("/excel", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canExport(role)) return res.status(403).json({ error: "Forbidden" });

    const filters: ExportFilters = req.body?.filters ?? {};
    const [transactions, receipts] = await Promise.all([
      queryTransactions(filters),
      queryReceipts(filters),
    ]);

    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TourPilot";
    workbook.created = new Date();

    const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

    function addHeaderRow(ws: ExcelJS.Worksheet, headers: { header: string; width: number; key: string }[]) {
      ws.columns = headers.map(h => ({ header: h.header, key: h.key, width: h.width }));
      const headerRow = ws.getRow(1);
      headerRow.eachCell((cell: ExcelJS.Cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = { bottom: { style: "thin", color: { argb: "FF0D7377" } } };
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    }

    // ── Özet sheet ───────────────────────────────────────────────────────────
    const wsSummary = workbook.addWorksheet("Özet");
    wsSummary.columns = [
      { header: "Metrik", key: "metric", width: 35 },
      { header: "Değer", key: "value", width: 25 },
    ];
    addHeaderRow(wsSummary, [{ header: "Metrik", key: "metric", width: 35 }, { header: "Değer", key: "value", width: 25 }]);

    const income = transactions.filter(t => t.type === "income");
    const expenses = transactions.filter(t => t.type === "expense");
    const totalIncome = income.reduce((s, t) => s + (t.amountTry ?? (t.currency === "TRY" ? t.amount : 0)), 0);
    const totalExpenses = expenses.reduce((s, t) => s + (t.amountTry ?? (t.currency === "TRY" ? t.amount : 0)), 0);
    wsSummary.addRow({ metric: "Toplam Gelir (TRY)", value: totalIncome });
    wsSummary.addRow({ metric: "Toplam Gider (TRY)", value: totalExpenses });
    wsSummary.addRow({ metric: "Tahmini Brüt Kar (TRY)", value: totalIncome - totalExpenses });
    wsSummary.addRow({ metric: "Gelir İşlem Sayısı", value: income.length });
    wsSummary.addRow({ metric: "Gider İşlem Sayısı", value: expenses.length });
    wsSummary.addRow({ metric: "Toplam Makbuz", value: receipts.length });
    wsSummary.addRow({ metric: "Rapor Tarihi", value: new Date().toLocaleDateString("tr-TR") });

    // ── Gelir sheet ───────────────────────────────────────────────────────────
    const wsIncome = workbook.addWorksheet("Gelir");
    addHeaderRow(wsIncome, [
      { header: "Tarih", key: "transactionDate", width: 14 },
      { header: "Açıklama", key: "description", width: 30 },
      { header: "Müşteri", key: "customerName", width: 20 },
      { header: "Tur", key: "tourName", width: 20 },
      { header: "Tutar", key: "amount", width: 14 },
      { header: "Para Birimi", key: "currency", width: 12 },
      { header: "TRY Karşılığı", key: "amountTry", width: 16 },
      { header: "Ödeme Durumu", key: "paymentStatus", width: 16 },
      { header: "Muhasebe Durumu", key: "accountingStatus", width: 18 },
      { header: "Belge No", key: "documentNumber", width: 15 },
    ]);
    for (const tx of income) {
      wsIncome.addRow({
        transactionDate: tx.transactionDate,
        description: tx.description ?? "",
        customerName: tx.customerName ?? "",
        tourName: tx.tourName ?? "",
        amount: tx.amount,
        currency: tx.currency,
        amountTry: tx.amountTry ?? (tx.currency === "TRY" ? tx.amount : null),
        paymentStatus: PAYMENT_STATUS_LABELS[tx.paymentStatus] ?? tx.paymentStatus,
        accountingStatus: ACCT_STATUS_LABELS[tx.accountingStatus] ?? tx.accountingStatus,
        documentNumber: tx.documentNumber ?? "",
      });
    }
    if (income.length > 0) {
      const totalRow = wsIncome.addRow({ description: "TOPLAM", amount: { formula: `SUM(E2:E${income.length + 1})` }, amountTry: { formula: `SUM(G2:G${income.length + 1})` } });
      totalRow.font = { bold: true };
    }

    // ── Gider sheet ───────────────────────────────────────────────────────────
    const wsExpenses = workbook.addWorksheet("Gider");
    addHeaderRow(wsExpenses, [
      { header: "Tarih", key: "transactionDate", width: 14 },
      { header: "Kategori", key: "category", width: 18 },
      { header: "Açıklama", key: "description", width: 28 },
      { header: "Tedarikçi", key: "supplierName", width: 20 },
      { header: "Tutar", key: "amount", width: 14 },
      { header: "Para Birimi", key: "currency", width: 12 },
      { header: "TRY Karşılığı", key: "amountTry", width: 16 },
      { header: "Ödeme Durumu", key: "paymentStatus", width: 16 },
      { header: "Muhasebe Durumu", key: "accountingStatus", width: 18 },
      { header: "Belge No", key: "documentNumber", width: 15 },
    ]);
    for (const tx of expenses) {
      wsExpenses.addRow({
        transactionDate: tx.transactionDate,
        category: tx.category,
        description: tx.description ?? "",
        supplierName: tx.supplierName ?? "",
        amount: tx.amount,
        currency: tx.currency,
        amountTry: tx.amountTry ?? (tx.currency === "TRY" ? tx.amount : null),
        paymentStatus: PAYMENT_STATUS_LABELS[tx.paymentStatus] ?? tx.paymentStatus,
        accountingStatus: ACCT_STATUS_LABELS[tx.accountingStatus] ?? tx.accountingStatus,
        documentNumber: tx.documentNumber ?? "",
      });
    }
    if (expenses.length > 0) {
      const totalRow = wsExpenses.addRow({ category: "TOPLAM", amount: { formula: `SUM(E2:E${expenses.length + 1})` }, amountTry: { formula: `SUM(G2:G${expenses.length + 1})` } });
      totalRow.font = { bold: true };
    }

    // ── Makbuzlar sheet ───────────────────────────────────────────────────────
    const wsReceipts = workbook.addWorksheet("Makbuzlar");
    addHeaderRow(wsReceipts, [
      { header: "ID", key: "id", width: 8 },
      { header: "Tarih", key: "receiptDate", width: 14 },
      { header: "Tutar", key: "amount", width: 14 },
      { header: "Para Birimi", key: "currency", width: 12 },
      { header: "Tedarikçi", key: "supplierName", width: 22 },
      { header: "Tur", key: "tourName", width: 22 },
      { header: "Rehber", key: "guideName", width: 18 },
      { header: "Not", key: "guideNote", width: 28 },
      { header: "Fotoğraf", key: "hasPhoto", width: 12 },
      { header: "İnceleme Durumu", key: "reviewStatus", width: 18 },
    ]);
    for (const r of receipts) {
      wsReceipts.addRow({
        id: r.id,
        receiptDate: r.receiptDate ?? "",
        amount: r.amount,
        currency: r.currency,
        supplierName: r.supplierName ?? "",
        tourName: r.tourName ?? "",
        guideName: r.guideName ?? "",
        guideNote: r.guideNote ?? "",
        hasPhoto: r.photoObjectPath ? "Var" : "Yok",
        reviewStatus: REVIEW_STATUS_LABELS[r.reviewStatus] ?? r.reviewStatus,
      });
    }

    // ── Amount column number formats ──────────────────────────────────────────
    [wsIncome, wsExpenses].forEach(ws => {
      ws.getColumn("amount").numFmt = '#,##0.00';
      ws.getColumn("amountTry").numFmt = '#,##0.00';
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="muhasebe-${Date.now()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
    return;
  } catch (e) {
    console.error(e);
    if (!res.headersSent) return res.status(500).json({ error: "Excel oluşturulamadı" });
    return;
  }
});

// ── ZIP Export ─────────────────────────────────────────────────────────────────

router.post("/zip", async (req, res) => {
  try {
    const role = res.locals.profile?.role as string;
    if (!canExport(role)) return res.status(403).json({ error: "Forbidden" });

    const filters: ExportFilters = req.body?.filters ?? {};
    const [transactions, receipts] = await Promise.all([
      queryTransactions(filters),
      queryReceipts(filters),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const archiverMod = await import("archiver") as any;
    const archiver = archiverMod.default ?? archiverMod;
    const archive = archiver("zip", { zlib: { level: 6 } });
    const warnings: string[] = [];

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="muhasebe-export-${Date.now()}.zip"`);
    archive.pipe(res);

    // ── Include receipt images from object storage ──────────────────────────
    for (const receipt of receipts) {
      if (!receipt.photoObjectPath) continue;
      try {
        const file = await objectStorageService.getObjectEntityFile(receipt.photoObjectPath);
        const stream = file.createReadStream();
        const ext = receipt.photoObjectPath.endsWith(".png") ? "png" : "jpg";
        archive.append(stream, { name: `receipts/receipt-${receipt.id}.${ext}` });
      } catch (e) {
        if (e instanceof ObjectNotFoundError) {
          warnings.push(`Makbuz #${receipt.id} fotoğrafı bulunamadı (${receipt.photoObjectPath})`);
        } else {
          warnings.push(`Makbuz #${receipt.id} indirilemedi: ${String(e)}`);
        }
      }
    }

    // ── Manifest JSON ────────────────────────────────────────────────────────
    const manifest = {
      generatedAt: new Date().toISOString(),
      filters,
      transactionCount: transactions.length,
      receiptCount: receipts.length,
      warnings,
      items: receipts.map(r => ({
        fileName: r.photoObjectPath ? `receipts/receipt-${r.id}.jpg` : null,
        documentType: "receipt",
        operationId: r.operationId,
        supplierOrCustomer: r.supplierName ?? null,
        date: r.receiptDate,
        amount: r.amount,
        currency: r.currency,
        reviewStatus: r.reviewStatus,
        sourceRecordId: r.id,
      })),
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

    // ── Inline transaction XLSX for convenience ──────────────────────────────
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "TourPilot";
    wb.created = new Date();

    const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

    function styleHeader(ws: ExcelJS.Worksheet) {
      const row = ws.getRow(1);
      row.eachCell((cell: ExcelJS.Cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
    }

    const wsAll = wb.addWorksheet("İşlemler");
    wsAll.columns = [
      { header: "ID", key: "id", width: 8 },
      { header: "Tarih", key: "transactionDate", width: 14 },
      { header: "Tip", key: "type", width: 10 },
      { header: "Kategori", key: "category", width: 18 },
      { header: "Tutar", key: "amount", width: 14 },
      { header: "Para Birimi", key: "currency", width: 12 },
      { header: "TRY Karşılığı", key: "amountTry", width: 16 },
      { header: "Ödeme Durumu", key: "paymentStatus", width: 16 },
      { header: "Muhasebe Durumu", key: "accountingStatus", width: 20 },
      { header: "Açıklama", key: "description", width: 30 },
      { header: "Müşteri", key: "customerName", width: 20 },
      { header: "Tedarikçi", key: "supplierName", width: 20 },
    ];
    styleHeader(wsAll);
    for (const t of transactions) {
      wsAll.addRow({
        id: t.id,
        transactionDate: t.transactionDate ?? "",
        type: TX_TYPE_LABELS[t.type] ?? t.type,
        category: t.category,
        amount: t.amount,
        currency: t.currency,
        amountTry: t.amountTry ?? (t.currency === "TRY" ? t.amount : null),
        paymentStatus: PAYMENT_STATUS_LABELS[t.paymentStatus] ?? t.paymentStatus,
        accountingStatus: ACCT_STATUS_LABELS[t.accountingStatus] ?? t.accountingStatus,
        description: t.description ?? "",
        customerName: t.customerName ?? "",
        supplierName: t.supplierName ?? "",
      });
    }
    wsAll.getColumn("amount").numFmt = '#,##0.00';
    wsAll.getColumn("amountTry").numFmt = '#,##0.00';

    const xlsxBuffer = await wb.xlsx.writeBuffer();
    archive.append(Buffer.from(xlsxBuffer), { name: "accounting-data.xlsx" });

    if (warnings.length > 0) {
      archive.append(warnings.join("\n"), { name: "missing-files.txt" });
    }

    await archive.finalize();
    return;
  } catch (e) {
    console.error(e);
    if (!res.headersSent) return res.status(500).json({ error: "ZIP oluşturulamadı" });
    return;
  }
});

export default router;
