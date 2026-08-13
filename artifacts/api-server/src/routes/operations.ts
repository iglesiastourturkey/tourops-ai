import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { operationsTable, operationTasksTable, operationReceiptsTable, operationDocumentsTable, auditLogsTable, accountingTransactionsTable } from "@workspace/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import type { UserRole } from "@workspace/db/schema";
import { createAuditLog } from "../lib/audit";
import { dateOrderBlock } from "../lib/reservation-validation";

const objectStorageService = new ObjectStorageService();

// Allowed image MIME types for receipt photos — must match the upload allowlist.
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);
const MAX_RECEIPT_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB
const CANONICAL_OBJECT_PATH_RE = /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth);

/**
 * Helper: verifies that the given operation belongs to the guide user (by assignedGuideUserId).
 * Returns null if ownership is confirmed or role is not guide.
 * Returns 403 response if guide does not own the operation.
 */
async function checkGuideOwnership(
  res: Parameters<typeof requireAuth>[1],
  operationId: number,
  userId: string,
  role: string
): Promise<boolean> {
  if (role !== "guide") return true; // non-guide: no ownership check needed
  const [op] = await db.select({ assignedGuideUserId: operationsTable.assignedGuideUserId })
    .from(operationsTable).where(eq(operationsTable.id, operationId));
  if (!op || op.assignedGuideUserId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// ─── Operations ──────────────────────────────────────────────────────────────

router.get("/", requirePermission("operations", "view"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const profile = res.locals.profile;
    const role = profile?.role as UserRole;

    const { status } = req.query as Record<string, string>;
    let rows = await db.select().from(operationsTable).orderBy(desc(operationsTable.createdAt));

    // Guides only see their assigned operations
    if (role === "guide") {
      rows = rows.filter(r => r.assignedGuideUserId === userId);
    }
    if (status) rows = rows.filter(r => r.status === status);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list operations" }); }
});

router.post("/", requirePermission("operations", "create"), async (req, res) => {
  try {
    const { quotationId: _quotationId, sourceQuoteId: _sourceQuoteId, sourceType: _sourceType, ...manualInput } = req.body;
    // An end date before the start date is not a judgement call, it is an
    // impossible operation: every downstream consumer (daily ops, sheet sync)
    // reads the range as a span.
    const dateBlock = dateOrderBlock(manualInput.startDate, manualInput.endDate);
    if (dateBlock) { res.status(400).json({ error: dateBlock, code: "invalid_date_range" }); return; }
    const [row] = await db.insert(operationsTable).values({
      ...manualInput,
      sourceType: "manual",
      sourceQuoteId: null,
      quotationId: null,
    }).returning();
    await createAuditLog({
      eventType: "operation_created",
      actorProfileId: res.locals.profile.id,
      module: "operations",
      entityType: "operation",
      entityId: row.id,
      description: "Operasyon oluşturuldu",
    });
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create operation" }); }
});

router.get("/:id", requirePermission("operations", "view"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole;
    const operationId = parseInt(req.params.id as string);
    const [row] = await db.select().from(operationsTable).where(eq(operationsTable.id, operationId));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (role === "guide" && row.assignedGuideUserId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to get operation" }); }
});

// Guides cannot PATCH the whole operation — they can only update tasks/receipts on their own operations
router.patch("/:id", requirePermission("operations", "update"), async (req, res) => {
  try {
    const operationId = parseInt(req.params.id as string);
    const [before] = await db.select({
      status: operationsTable.status, assignedGuideUserId: operationsTable.assignedGuideUserId,
      startDate: operationsTable.startDate, endDate: operationsTable.endDate,
    }).from(operationsTable).where(eq(operationsTable.id, operationId));
    // A PATCH may move only one end of the range, so the check runs against the
    // merged result rather than the request body alone — otherwise moving
    // startDate past an untouched endDate would slip through.
    if (before) {
      const body = req.body as Record<string, unknown>;
      const dateBlock = dateOrderBlock(
        "startDate" in body ? body.startDate : before.startDate,
        "endDate" in body ? body.endDate : before.endDate,
      );
      if (dateBlock) { res.status(400).json({ error: dateBlock, code: "invalid_date_range" }); return; }
    }
    const [row] = await db.update(operationsTable).set(req.body).where(eq(operationsTable.id, operationId)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await createAuditLog({
      eventType: before?.status !== row.status ? "operation_status_changed" : "operation_updated",
      actorProfileId: res.locals.profile.id,
      // Spelled out rather than passing `before` straight through: that object
      // now also carries the dates read for the range check, which do not belong
      // in the status-change audit payload.
      oldValue: before ? { status: before.status, assignedGuideUserId: before.assignedGuideUserId } : undefined,
      newValue: { status: row.status, assignedGuideUserId: row.assignedGuideUserId },
      metadata: { changedFields: Object.keys(req.body) },
      module: "operations",
      entityType: "operation",
      entityId: row.id,
      description: before?.status !== row.status ? "Operasyon durumu değiştirildi" : "Operasyon güncellendi",
    });
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update operation" }); }
});

// DELETE /operations/:id — cascades tasks; deletes receipts + their GCS objects
router.delete("/:id", requirePermission("operations", "delete"), async (req, res) => {
  try {
    const operationId = parseInt(req.params.id as string);

    // Delete GCS objects for all receipts that have photos
    const receipts = await db.select().from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.operationId, operationId));

    await Promise.all(receipts
      .filter(r => r.photoObjectPath)
      .map(async r => {
        try {
          const file = await objectStorageService.getObjectEntityFile(r.photoObjectPath!);
          await file.delete();
        } catch { /* best-effort — don't block delete if GCS object is already gone */ }
      })
    );

    // DB cascades delete tasks and receipts (operationId FK cascade)
    await db.delete(operationsTable).where(eq(operationsTable.id, operationId));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete operation" }); }
});

// ─── Operation Tasks ─────────────────────────────────────────────────────────

router.get("/:id/tasks", requirePermission("operations", "view"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole;
    const operationId = parseInt(req.params.id as string);
    if (!(await checkGuideOwnership(res, operationId, userId!, role))) return;
    const rows = await db.select().from(operationTasksTable)
      .where(eq(operationTasksTable.operationId, operationId))
      .orderBy(operationTasksTable.sortOrder);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list tasks" }); }
});

router.post("/:id/tasks", requirePermission("operations", "create"), async (req, res) => {
  try {
    const operationId = parseInt(req.params.id as string);
    const [row] = await db.insert(operationTasksTable)
      .values({ ...req.body, operationId })
      .returning();
    await updateCompletionRate(operationId);
    await createAuditLog({
      eventType: "task_created",
      actorProfileId: res.locals.profile.id,
      newValue: { title: row.title, status: row.status },
      module: "operations",
      entityType: "operation_task",
      entityId: row.id,
      description: "Operasyon görevi oluşturuldu",
    });
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create task" }); }
});

router.patch("/:id/tasks/:taskId", requirePermission("operations", "update"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole;
    const operationId = parseInt(req.params.id as string);
    const taskId = parseInt(req.params.taskId as string);
    if (!(await checkGuideOwnership(res, operationId, userId!, role))) return;
    const [before] = await db.select({ status: operationTasksTable.status, title: operationTasksTable.title })
      .from(operationTasksTable)
      .where(and(eq(operationTasksTable.id, taskId), eq(operationTasksTable.operationId, operationId)));
    const body = { ...req.body };
    if (body.status === "completed" && !body.completedAt) body.completedAt = new Date();
    // Scope update to both operationId AND taskId to prevent cross-operation task mutation
    const [row] = await db.update(operationTasksTable).set(body)
      .where(and(eq(operationTasksTable.id, taskId), eq(operationTasksTable.operationId, operationId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Task not found" }); return; }
    await updateCompletionRate(operationId);
    await createAuditLog({
      eventType: row.status === "completed" && before?.status !== "completed" ? "task_completed"
        : row.status !== "completed" && before?.status === "completed" ? "task_reopened" : "task_updated",
      actorProfileId: res.locals.profile.id,
      oldValue: before,
      newValue: { status: row.status, title: row.title },
      module: "operations",
      entityType: "operation_task",
      entityId: row.id,
      description: row.status === "completed" && before?.status !== "completed" ? "Operasyon görevi tamamlandı"
        : row.status !== "completed" && before?.status === "completed" ? "Operasyon görevi yeniden açıldı" : "Operasyon görevi güncellendi",
    });
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update task" }); }
});

router.delete("/:id/tasks/:taskId", requirePermission("operations", "delete"), async (req, res) => {
  try {
    const operationId = parseInt(req.params.id as string);
    const taskId = parseInt(req.params.taskId as string);
    // Scope deletion to both operationId AND taskId to prevent cross-operation task deletion
    const [deleted] = await db.delete(operationTasksTable)
      .where(and(eq(operationTasksTable.id, taskId), eq(operationTasksTable.operationId, operationId)))
      .returning({ id: operationTasksTable.id });
    if (!deleted) { res.status(404).json({ error: "Task not found" }); return; }
    await updateCompletionRate(operationId);
    await createAuditLog({
      eventType: "task_deleted",
      actorProfileId: res.locals.profile.id,
      module: "operations",
      entityType: "operation_task",
      entityId: deleted.id,
      description: "Operasyon görevi silindi",
    });
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete task" }); }
});

// ─── Operation Receipts ───────────────────────────────────────────────────────

router.get("/:id/receipts", requirePermission("receipts", "view"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole;
    const operationId = parseInt(req.params.id as string);
    if (!(await checkGuideOwnership(res, operationId, userId!, role))) return;
    const rows = await db.select().from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.operationId, operationId))
      .orderBy(desc(operationReceiptsTable.createdAt));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list receipts" }); }
});

router.post("/:id/receipts", requirePermission("receipts", "create"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole;
    const operationId = parseInt(req.params.id as string);
    if (!(await checkGuideOwnership(res, operationId, userId!, role))) return;

    const body = { ...req.body };

    if (body.photoObjectPath != null) {
      if (typeof body.photoObjectPath !== "string" || !CANONICAL_OBJECT_PATH_RE.test(body.photoObjectPath)) {
        res.status(400).json({ error: "Invalid photoObjectPath format" });
        return;
      }

      let objectFile;
      try {
        objectFile = await objectStorageService.getObjectEntityFile(body.photoObjectPath);
      } catch (err) {
        if (err instanceof ObjectNotFoundError) {
          res.status(400).json({ error: "Receipt photo not found in storage; upload the file first" });
          return;
        }
        throw err;
      }

      const [metadata] = await objectFile.getMetadata();
      const contentType = metadata.contentType as string | undefined;
      const size = Number(metadata.size ?? 0);

      if (!contentType || !ALLOWED_RECEIPT_MIME_TYPES.has(contentType.split(";")[0].trim())) {
        await objectFile.delete().catch(() => {/* best-effort */});
        res.status(400).json({ error: "Uploaded file is not an allowed image type (JPEG, PNG, GIF, WEBP, HEIC)" });
        return;
      }

      if (size > MAX_RECEIPT_PHOTO_BYTES) {
        await objectFile.delete().catch(() => {/* best-effort */});
        res.status(400).json({ error: "Uploaded file exceeds the 10 MB limit" });
        return;
      }
    }

    // Soft duplicate check — same operation, amount, date and supplier already recorded.
    // Not a hard block: just surfaced to the client as a warning.
    let possibleDuplicateOf: number | undefined;
    if (body.receiptDate && body.supplierName) {
      const candidates = await db.select({ id: operationReceiptsTable.id })
        .from(operationReceiptsTable)
        .where(and(
          eq(operationReceiptsTable.operationId, operationId),
          eq(operationReceiptsTable.amount, Number(body.amount)),
          eq(operationReceiptsTable.receiptDate, body.receiptDate),
          sql`lower(${operationReceiptsTable.supplierName}) = lower(${body.supplierName})`,
        ))
        .limit(1);
      possibleDuplicateOf = candidates[0]?.id;
    }

    // Record creator for guide-scoped deletion enforcement
    const [row] = await db.insert(operationReceiptsTable)
      .values({ ...body, operationId, createdByUserId: userId })
      .returning();
    const formattedAmount = new Intl.NumberFormat("tr-TR", { style: "currency", currency: row.currency }).format(row.amount);
    await createAuditLog({
      eventType: "operation_expense_created",
      actorProfileId: res.locals.profile.id,
      newValue: { amount: row.amount, currency: row.currency, supplierName: row.supplierName },
      module: "operations",
      entityType: "operation",
      entityId: operationId,
      description: `${formattedAmount} tutarında masraf makbuzu eklendi.`,
    });
    res.status(201).json({ ...row, possibleDuplicateOf });
  } catch { res.status(500).json({ error: "Failed to create receipt" }); }
});

// PATCH /operations/:id/receipts/:receiptId — correct OCR/verified fields on an existing receipt.
// Blocked once the receipt is linked to an approved/paid accounting transaction (reconciled data
// must not be silently rewritten). Guides never reach this — "receipts.update" is admin/operations only.
const RECEIPT_EDITABLE_FIELDS = [
  "amount", "currency", "supplierName", "receiptDate", "receiptTime",
  "taxAmount", "taxRate", "documentNumber", "paymentMethod", "category", "guideNote",
] as const;

router.patch("/:id/receipts/:receiptId", requirePermission("receipts", "update"), async (req, res) => {
  try {
    const operationId = parseInt(req.params.id as string);
    const receiptId = parseInt(req.params.receiptId as string);

    const [receipt] = await db.select().from(operationReceiptsTable)
      .where(and(eq(operationReceiptsTable.id, receiptId), eq(operationReceiptsTable.operationId, operationId)));
    if (!receipt) { res.status(404).json({ error: "Receipt not found" }); return; }

    const [linkedTx] = await db.select({
      accountingStatus: accountingTransactionsTable.accountingStatus,
      paymentStatus: accountingTransactionsTable.paymentStatus,
    }).from(accountingTransactionsTable).where(eq(accountingTransactionsTable.receiptId, receiptId)).limit(1);
    if (linkedTx && (linkedTx.accountingStatus === "approved" || linkedTx.paymentStatus === "paid")) {
      res.status(409).json({ error: "Bu makbuz muhasebe tarafında onaylanmış/ödenmiş; artık düzenlenemez." });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const updates: Partial<typeof operationReceiptsTable.$inferInsert> = {};
    const changedFields: string[] = [];
    for (const field of RECEIPT_EDITABLE_FIELDS) {
      if (body[field] === undefined) continue;
      const oldVal = receipt[field as keyof typeof receipt];
      const newVal = body[field];
      if (oldVal !== newVal) {
        (updates as Record<string, unknown>)[field] = newVal;
        changedFields.push(field);
      }
    }
    if (changedFields.length === 0) { res.json(receipt); return; }

    // Preserve which fields were manually corrected post-OCR, alongside their prior values.
    let correctedFields: Record<string, unknown> = {};
    try { correctedFields = receipt.correctedFields ? JSON.parse(receipt.correctedFields) : {}; } catch { /* ignore malformed existing data */ }
    for (const field of changedFields) {
      correctedFields[field] = { from: receipt[field as keyof typeof receipt], correctedAt: new Date().toISOString() };
    }
    updates.correctedFields = JSON.stringify(correctedFields);

    const [row] = await db.update(operationReceiptsTable).set(updates)
      .where(eq(operationReceiptsTable.id, receiptId))
      .returning();

    const actorName = res.locals.profile.name ?? res.locals.profile.email;
    const description = changedFields.length === 1 && changedFields[0] === "category"
      ? `Masraf kategorisi ${row.category} olarak değiştirildi.`
      : `Makbuz OCR verileri ${actorName} tarafından düzeltildi.`;
    await createAuditLog({
      eventType: "receipt_corrected",
      actorProfileId: res.locals.profile.id,
      oldValue: Object.fromEntries(changedFields.map(f => [f, receipt[f as keyof typeof receipt]])),
      newValue: Object.fromEntries(changedFields.map(f => [f, row[f as keyof typeof row]])),
      metadata: { changedFields },
      module: "operations",
      entityType: "operation",
      entityId: operationId,
      description,
    });

    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update receipt" }); }
});

// DELETE /operations/:id/receipts/:receiptId — deletes DB record + GCS object
router.delete("/:id/receipts/:receiptId", requirePermission("receipts", "delete"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole;
    const operationId = parseInt(req.params.id as string);
    if (!(await checkGuideOwnership(res, operationId, userId!, role))) return;

    const receiptId = parseInt(req.params.receiptId as string);
    // Scope by both receiptId AND operationId to prevent cross-operation receipt deletion
    const [receipt] = await db.select().from(operationReceiptsTable)
      .where(and(eq(operationReceiptsTable.id, receiptId), eq(operationReceiptsTable.operationId, operationId)));
    if (!receipt) { res.status(404).json({ error: "Receipt not found" }); return; }
    // Guides may only delete receipts they created
    if (role === "guide" && receipt.createdByUserId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Best-effort GCS cleanup before DB delete
    if (receipt.photoObjectPath) {
      try {
        const file = await objectStorageService.getObjectEntityFile(receipt.photoObjectPath);
        await file.delete();
      } catch { /* best-effort — object may already be gone */ }
    }

    await db.delete(operationReceiptsTable).where(eq(operationReceiptsTable.id, receiptId));
    await createAuditLog({
      eventType: "operation_expense_deleted",
      actorProfileId: res.locals.profile.id,
      module: "operations",
      entityType: "operation",
      entityId: operationId,
      description: "Operasyon masrafı silindi",
    });
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete receipt" }); }
});

// ─── Operation Documents ─────────────────────────────────────────────────────

router.get("/:id/documents", requirePermission("operations", "view"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile.role as UserRole;
    const operationId = parseInt(req.params.id as string, 10);
    if (!(await checkGuideOwnership(res, operationId, userId!, role))) return;
    const rows = await db.select().from(operationDocumentsTable)
      .where(eq(operationDocumentsTable.operationId, operationId))
      .orderBy(desc(operationDocumentsTable.createdAt));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list operation documents" }); }
});

router.post("/:id/documents", requirePermission("operations", "update"), async (req, res) => {
  try {
    const operationId = parseInt(req.params.id as string, 10);
    const body = req.body as { documentType?: string; title?: string; objectPath?: string; fileMimeType?: string; fileSize?: number };
    if (!body.title?.trim() || !body.objectPath || !CANONICAL_OBJECT_PATH_RE.test(body.objectPath)) {
      res.status(400).json({ error: "Document title and a valid uploaded object are required" });
      return;
    }
    if (body.fileSize != null && (!Number.isFinite(body.fileSize) || body.fileSize < 1 || body.fileSize > 25 * 1024 * 1024)) {
      res.status(400).json({ error: "Document file size must be between 1 byte and 25 MB" });
      return;
    }
    try {
      await objectStorageService.getObjectEntityFile(body.objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(400).json({ error: "Document not found in storage; upload the file first" });
        return;
      }
      throw error;
    }
    const [row] = await db.insert(operationDocumentsTable).values({
      operationId,
      documentType: body.documentType || "other",
      title: body.title.trim(),
      objectPath: body.objectPath,
      fileMimeType: body.fileMimeType ?? null,
      fileSize: body.fileSize ?? null,
      uploadedByProfileId: res.locals.profile.id,
    }).returning();
    await createAuditLog({
      eventType: "operation_document_added",
      actorProfileId: res.locals.profile.id,
      newValue: { title: row.title, documentType: row.documentType },
      module: "operations",
      entityType: "operation",
      entityId: operationId,
      description: "Operasyon belgesi eklendi",
    });
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create operation document" }); }
});

router.delete("/:id/documents/:documentId", requirePermission("operations", "delete"), async (req, res) => {
  try {
    const operationId = parseInt(req.params.id as string, 10);
    const documentId = parseInt(req.params.documentId as string, 10);
    const [document] = await db.select().from(operationDocumentsTable)
      .where(and(eq(operationDocumentsTable.id, documentId), eq(operationDocumentsTable.operationId, operationId)));
    if (!document) { res.status(404).json({ error: "Document not found" }); return; }
    try {
      const object = await objectStorageService.getObjectEntityFile(document.objectPath);
      await object.delete();
    } catch { /* best-effort cleanup */ }
    await db.delete(operationDocumentsTable).where(eq(operationDocumentsTable.id, documentId));
    await createAuditLog({
      eventType: "operation_document_deleted",
      actorProfileId: res.locals.profile.id,
      oldValue: { title: document.title, documentType: document.documentType },
      module: "operations",
      entityType: "operation",
      entityId: operationId,
      description: "Operasyon belgesi silindi",
    });
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete operation document" }); }
});

// ─── Permanent operation activity feed ───────────────────────────────────────

router.get("/:id/activity", requirePermission("operations", "view"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile.role as UserRole;
    const operationId = parseInt(req.params.id as string, 10);
    if (!(await checkGuideOwnership(res, operationId, userId!, role))) return;
    const rows = await db.select({
      id: auditLogsTable.id,
      eventType: auditLogsTable.eventType,
      metadata: auditLogsTable.metadata,
      createdAt: auditLogsTable.createdAt,
    }).from(auditLogsTable)
      .where(and(
        eq(sql`${auditLogsTable.metadata}->>'entityType'`, "operation"),
        eq(sql`${auditLogsTable.metadata}->>'entityId'`, String(operationId)),
      ))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(100);
    res.json(rows.map(row => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        eventType: row.eventType,
        description: typeof metadata.description === "string" ? metadata.description : null,
        actorName: typeof metadata.actorName === "string" ? metadata.actorName : null,
        actorRole: typeof metadata.actorRole === "string" ? metadata.actorRole : null,
        metadata: row.metadata,
        createdAt: row.createdAt,
      };
    }));
  } catch { res.status(500).json({ error: "Failed to list operation activity" }); }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function updateCompletionRate(operationId: number) {
  const tasks = await db.select().from(operationTasksTable).where(eq(operationTasksTable.operationId, operationId));
  const total = tasks.length;
  const done = tasks.filter(t => t.status === "completed").length;
  await db.update(operationsTable)
    .set({ completionRate: total > 0 ? (done / total) * 100 : 0 })
    .where(eq(operationsTable.id, operationId));
}

export default router;
