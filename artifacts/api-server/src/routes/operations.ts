import { Router } from "express";
import { db } from "@workspace/db";
import { operationsTable, operationTasksTable, operationReceiptsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();

// Allowed image MIME types for receipt photos — must match the upload allowlist.
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);
const MAX_RECEIPT_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

const router = Router();
router.use(requireAuth);

// ─── Operations ──────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const { status } = req.query as Record<string, string>;
    let rows = await db.select().from(operationsTable).orderBy(desc(operationsTable.createdAt));
    if (status) rows = rows.filter(r => r.status === status);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list operations" }); }
});

router.post("/", async (req, res) => {
  try {
    const [row] = await db.insert(operationsTable).values(req.body).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create operation" }); }
});

router.get("/:id", async (req, res) => {
  try {
    const [row] = await db.select().from(operationsTable).where(eq(operationsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to get operation" }); }
});

router.patch("/:id", async (req, res) => {
  try {
    const [row] = await db.update(operationsTable).set(req.body).where(eq(operationsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update operation" }); }
});

// ─── Operation Tasks ─────────────────────────────────────────────────────────

router.get("/:id/tasks", async (req, res) => {
  try {
    const rows = await db.select().from(operationTasksTable)
      .where(eq(operationTasksTable.operationId, parseInt(req.params.id)))
      .orderBy(operationTasksTable.sortOrder);
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list tasks" }); }
});

router.post("/:id/tasks", async (req, res) => {
  try {
    const [row] = await db.insert(operationTasksTable)
      .values({ ...req.body, operationId: parseInt(req.params.id) })
      .returning();
    await updateCompletionRate(parseInt(req.params.id));
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create task" }); }
});

router.patch("/:id/tasks/:taskId", async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.status === "completed" && !body.completedAt) body.completedAt = new Date();
    const [row] = await db.update(operationTasksTable).set(body)
      .where(eq(operationTasksTable.id, parseInt(req.params.taskId)))
      .returning();
    await updateCompletionRate(parseInt(req.params.id));
    res.json(row);
  } catch { res.status(500).json({ error: "Failed to update task" }); }
});

router.delete("/:id/tasks/:taskId", async (req, res) => {
  try {
    await db.delete(operationTasksTable).where(eq(operationTasksTable.id, parseInt(req.params.taskId)));
    await updateCompletionRate(parseInt(req.params.id));
    res.status(204).send();
  } catch { res.status(500).json({ error: "Failed to delete task" }); }
});

// ─── Operation Receipts ───────────────────────────────────────────────────────

router.get("/:id/receipts", async (req, res) => {
  try {
    const rows = await db.select().from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.operationId, parseInt(req.params.id)))
      .orderBy(desc(operationReceiptsTable.createdAt));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed to list receipts" }); }
});

// Canonical private-upload path pattern: /objects/uploads/<uuid>
const CANONICAL_OBJECT_PATH_RE = /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/:id/receipts", async (req, res) => {
  try {
    const body = { ...req.body };

    // Validate photoObjectPath format before any GCS call.
    if (body.photoObjectPath != null) {
      if (typeof body.photoObjectPath !== "string" || !CANONICAL_OBJECT_PATH_RE.test(body.photoObjectPath)) {
        res.status(400).json({ error: "Invalid photoObjectPath format" });
        return;
      }

      // Post-upload server-side validation: fetch the actual GCS object
      // metadata and verify content-type and size against the policy.
      // This enforces constraints on the REAL uploaded bytes — not just the
      // client-supplied JSON — so a caller cannot bypass the upload allowlist
      // by requesting a URL as a 1-byte PNG then uploading arbitrary content.
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
        // Delete the offending object so it cannot be re-registered later.
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

    const [row] = await db.insert(operationReceiptsTable)
      .values({ ...body, operationId: parseInt(req.params.id) })
      .returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Failed to create receipt" }); }
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
