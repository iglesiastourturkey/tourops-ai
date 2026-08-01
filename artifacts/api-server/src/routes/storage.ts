/**
 * Storage routes — presigned URL upload + object serving.
 * Authentication uses the project's existing Clerk requireAuth middleware.
 * File binaries never touch this server; only metadata and presigned URLs are handled here.
 */
import { Readable } from "stream";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { operationReceiptsTable, operationsTable } from "@workspace/db/schema";
import { requireAuth, requireActive, requireAnyRole } from "../lib/auth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import type { UserRole } from "@workspace/db/schema";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned GCS URL for direct client upload.
 * Requires an active session with a role that can add receipts (admin, operations, guide).
 * Body: { name: string, size: number, contentType: string }
 * Response: { uploadURL: string, objectPath: string, metadata: {...} }
 */
router.post("/storage/uploads/request-url", requireAuth, requireActive(), requireAnyRole("admin", "operations", "guide"), async (req: Request, res: Response) => {

  const { name, size, contentType } = req.body ?? {};
  if (!name || size == null || !contentType) {
    res.status(400).json({ error: "Missing required fields: name, size, contentType" });
    return;
  }

  // Restrict to vetted image MIME types only — prevents stored active-content
  // (HTML/JS) from being uploaded and served on the same origin.
  const ALLOWED_IMAGE_TYPES = new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
  ]);
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    res.status(400).json({ error: "Only image files (JPEG, PNG, GIF, WEBP, HEIC) are accepted" });
    return;
  }

  // Limit to 10 MB per receipt photo.
  const MAX_BYTES = 10 * 1024 * 1024;
  if (typeof size !== "number" || size <= 0 || size > MAX_BYTES) {
    res.status(400).json({ error: "File size must be between 1 byte and 10 MB" });
    return;
  }

  try {
    // getObjectEntityUploadInfo returns BOTH the presigned GCS PUT URL and the
    // canonical objectPath built directly from the UUID — not parsed from the
    // signed URL, which is not guaranteed to have a stable format.
    const { uploadURL, objectPath } = await objectStorageService.getObjectEntityUploadInfo();

    res.json({
      uploadURL,
      objectPath,
      metadata: { name, size, contentType },
    });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets unconditionally (no auth required).
 * Searches PUBLIC_OBJECT_SEARCH_PATHS.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities uploaded via presigned URLs.
 * Authorization layers:
 *   1. requireAuth + requireActive — user must have a valid, active Clerk session.
 *   2. DB receipt ownership check — the requested objectPath must be
 *      registered as a receipt photo in operation_receipts. This ensures the
 *      endpoint can only serve objects that were legitimately uploaded through
 *      the agency's receipt workflow.
 *   3. Guide ownership — guides may only access receipt media belonging to
 *      their assigned operations.
 */
router.get("/storage/objects/*path", requireAuth, requireActive(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const role = res.locals.profile?.role as UserRole | undefined;

    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Authorization layer 2: only serve objects registered as receipt photos
    const [receipt] = await db
      .select({
        id: operationReceiptsTable.id,
        operationId: operationReceiptsTable.operationId,
      })
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.photoObjectPath, objectPath))
      .limit(1);

    if (!receipt) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Authorization layer 3: guides may only access receipts from their assigned operations
    if (role === "guide") {
      const [op] = await db
        .select({ assignedGuideUserId: operationsTable.assignedGuideUserId })
        .from(operationsTable)
        .where(eq(operationsTable.id, receipt.operationId));
      if (!op || op.assignedGuideUserId !== userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    // Defense-in-depth: force download disposition and block MIME sniffing so
    // the browser never renders served content as same-origin active content,
    // even if a non-image file somehow passed the upload allowlist.
    res.setHeader("Content-Disposition", "attachment");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
