import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { operationsTable, operationTasksTable, operationReceiptsTable } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import type { UserRole } from "@workspace/db/schema";

const objectStorageService = new ObjectStorageService();

// Allowed image MIME types for receipt photos — must match the upload allowlist.
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);
const MAX_RECEIPT_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

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
    const [row] = await db.insert(operationsTable).values(req.body).returning();
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
    const [row] = await db.update(operationsTable).set(req.body).where(eq(operationsTable.id, operationId)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
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
    const [row] = await db.insert(operationTasksTable)
      .values({ ...req.body, operationId: parseInt(req.params.id as string) })
      .returning();
    await updateCompletionRate(parseInt(req.params.id as string));
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
    const body = { ...req.body };
    if (body.status === "completed" && !body.completedAt) body.completedAt = new Date();
    // Scope update to both operationId AND taskId to prevent cross-operation task mutation
    const [row] = await db.update(operationTasksTable).set(body)
      .where(and(eq(operationTasksTable.id, taskId), eq(operationTasksTable.operationId, operationId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Task not found" }); return; }
    await updateCompletionRate(operationId);
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

// Canonical private-upload path pattern: /objects/uploads/<uuid>
const CANONICAL_OBJECT_PATH_RE = /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // Record creator for guide-scoped deletion enforcement
    const [row] = await db.insert(operationReceiptsTable)
      .values({ ...body, operationId, createdByUserId: userId })
      .returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create receipt" }); }
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
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete receipt" }); }
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
