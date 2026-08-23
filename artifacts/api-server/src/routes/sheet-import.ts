import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  sheetReservationImportsTable,
  operationsTable,
  customersTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../lib/auth";
import { createAuditLog } from "../lib/audit";

// Faz 4: GEMI Master Operasyon (Google Sheets, "Reservations" tab) -> TourPilot.
// One-way, review-queue-gated: an Apps Script onEdit trigger POSTs every
// edited row to the webhook below. Nothing in this file writes to
// operations/customers except the manual /approve action below, which a
// signed-in admin/operations user must click after reviewing the raw row.
// No scraper/provider code exists here - the sheet is the user's own
// first-party data source, mirroring the existing Gmail/Outlook intake.

const router = Router();
const MAX_SIGNATURE_AGE_SECONDS = 300;

const sheetRowSchema = z.object({
  sheetFileId: z.string().trim().min(1).max(120),
  sheetName: z.string().trim().min(1).max(80),
  rowNumber: z.number().int().min(1).max(1_000_000),
  rowData: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  editedByEmail: z.string().trim().min(1).max(160),
  editedAt: z.string().trim().min(1),
}).strict();

type SheetRow = z.infer<typeof sheetRowSchema>;

function integrationEnabled() {
  return process.env.SHEET_IMPORT_INTEGRATION_ENABLED === "true";
}

function configuredSheetFileId() {
  return process.env.SHEET_IMPORT_ALLOWED_FILE_ID?.trim() ?? "";
}

// Deterministic regardless of the incoming object's key order - rowData
// keys are sorted before joining so Apps Script and the server always sign
// (and verify) the exact same string.
function canonicalSheetRow(timestamp: string, row: SheetRow) {
  const sortedRowData = Object.keys(row.rowData)
    .sort()
    .map((key) => `${key}=${String(row.rowData[key] ?? "")}`)
    .join("|");

  return [
    timestamp,
    row.sheetFileId,
    row.sheetName,
    String(row.rowNumber),
    row.editedByEmail,
    row.editedAt,
    sortedRowData,
  ].join("\n");
}

function validSignature(signature: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const providedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

// Best-effort field discovery over the raw sheet row. Never guessed at
// ingest time (rowData is always stored as-is) - only used at /approve time
// to pre-fill a draft, and only when a fragment confidently matches. Turkish
// characters are folded to ASCII so "Müşteri Adı" etc. all match.
function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

function findByFragments(rowData: SheetRow["rowData"], fragments: string[]): string | null {
  for (const [key, value] of Object.entries(rowData)) {
    const normalizedKey = normalizeHeader(key);
    if (fragments.some((f) => normalizedKey.includes(f))) {
      const text = value === null ? "" : String(value).trim();
      if (text) return text;
    }
  }
  return null;
}

// POST /api/sheet-import/webhook
// Public, machine-only endpoint. Grants no capability beyond writing a
// staging row here - never touches operations/customers.
router.post("/webhook", async (req, res) => {
  if (!integrationEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const secret = process.env.SHEET_IMPORT_WEBHOOK_SECRET?.trim() ?? "";
  const allowedFileId = configuredSheetFileId();
  if (!secret || secret.length < 32 || !allowedFileId) {
    req.log.error(
      { eventType: "sheet_import_webhook_misconfigured" },
      "Sheet import webhook is enabled without complete server configuration",
    );
    res.status(503).json({ error: "Integration unavailable" });
    return;
  }

  const timestamp = req.get("x-tourpilot-timestamp")?.trim() ?? "";
  const signature = req.get("x-tourpilot-signature")?.trim() ?? "";
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    !Number.isInteger(timestampSeconds)
    || Math.abs(nowSeconds - timestampSeconds) > MAX_SIGNATURE_AGE_SECONDS
  ) {
    res.status(401).json({ error: "Invalid signature timestamp" });
    return;
  }

  const parsed = sheetRowSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sheet row" });
    return;
  }
  const row = parsed.data;

  if (row.sheetFileId !== allowedFileId) {
    res.status(403).json({ error: "Sheet not allowed" });
    return;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(canonicalSheetRow(timestamp, row), "utf8")
    .digest("hex");

  if (!validSignature(signature, expectedSignature)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  try {
    const editedAtDate = new Date(row.editedAt);
    if (Number.isNaN(editedAtDate.getTime())) {
      res.status(400).json({ error: "Invalid editedAt" });
      return;
    }

    const values = {
      sheetFileId: row.sheetFileId,
      sheetName: row.sheetName,
      rowNumber: row.rowNumber,
      rowData: row.rowData,
      editedByEmail: row.editedByEmail,
      editedAt: editedAtDate,
    };

    const [inserted] = await db
      .insert(sheetReservationImportsTable)
      .values(values)
      .onConflictDoUpdate({
        target: [
          sheetReservationImportsTable.sheetFileId,
          sheetReservationImportsTable.sheetName,
          sheetReservationImportsTable.rowNumber,
        ],
        set: {
          ...values,
          // A re-edit reopens the row for review even if it was already
          // approved/rejected - mirrors external_port_call_observations.
          status: "pending",
          approvedAt: null,
          approvedBy: null,
          rejectedAt: null,
          rejectedBy: null,
        },
      })
      .returning({ id: sheetReservationImportsTable.id });

    res.status(202).json({ accepted: true, id: inserted.id });
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      req.log.error(
        { eventType: "sheet_import_table_missing" },
        "Sheet import migration has not been applied",
      );
      res.status(503).json({ error: "Integration storage unavailable" });
      return;
    }
    req.log.error(
      { err: error, eventType: "sheet_import_webhook_failed" },
      "Could not store sheet import row",
    );
    res.status(500).json({ error: "Could not store sheet row" });
  }
});

// Everything below is a signed-in, human review surface.
router.use(requireAuth, requireRole("admin", "operations"));

/**
 * GET /sheet-import?status=pending|approved|rejected|all
 * Defaults to "pending".
 */
router.get("/", async (req, res) => {
  try {
    const status = (req.query.status as string) ?? "pending";
    const rows = await db
      .select()
      .from(sheetReservationImportsTable)
      .orderBy(desc(sheetReservationImportsTable.editedAt));

    const filtered = rows.filter((r) => {
      if (status === "all") return true;
      if (status === "approved") return r.approvedAt !== null;
      if (status === "rejected") return r.rejectedAt !== null;
      return r.approvedAt === null && r.rejectedAt === null;
    });

    res.json(filtered);
  } catch {
    res.status(500).json({ error: "Failed to list sheet imports" });
  }
});

const NAME_FRAGMENTS = ["musteri", "müşteri", "adsoyad", "isim", "customer"];
const PHONE_FRAGMENTS = ["telefon", "gsm", "tel", "phone"];
const EMAIL_FRAGMENTS = ["eposta", "email", "mail"];

/**
 * POST /sheet-import/:id/approve
 * Creates a draft operations row (and a matched/created customer, if a name
 * could be confidently found in the raw row) linked back to this import via
 * source_sheet_import_id. Staff completes/corrects the draft afterward in
 * the normal operations screen - this never guesses tour/date mappings.
 */
router.post("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const approverId = res.locals.profile.id;

  try {
    const result = await db.transaction(async (tx) => {
      const [importRow] = await tx
        .select()
        .from(sheetReservationImportsTable)
        .where(eq(sheetReservationImportsTable.id, id))
        .for("update");
      if (!importRow) return { kind: "not_found" as const };
      if (importRow.approvedAt || importRow.rejectedAt) {
        return { kind: "already_reviewed" as const };
      }

      const rowData = importRow.rowData as SheetRow["rowData"];
      const name = findByFragments(rowData, NAME_FRAGMENTS);
      const phone = findByFragments(rowData, PHONE_FRAGMENTS);
      const email = findByFragments(rowData, EMAIL_FRAGMENTS);

      let customerId: number | null = null;
      if (name) {
        const [customer] = await tx
          .insert(customersTable)
          .values({ name, phone, email })
          .returning({ id: customersTable.id });
        customerId = customer.id;
      }

      const notes = [
        `GEMI Master Operasyon "${importRow.sheetName}" sayfasi, satir ${importRow.rowNumber} - sheet_reservation_imports #${importRow.id} uzerinden onaylandi.`,
        `Duzenleyen: ${importRow.editedByEmail}`,
        "",
        "Ham satir verisi:",
        ...Object.entries(rowData).map(([k, v]) => `${k}: ${v ?? ""}`),
      ].join("\n");

      const [operation] = await tx
        .insert(operationsTable)
        .values({
          sourceType: "sheet_import",
          sourceSheetImportId: importRow.id,
          customerId,
          notes,
        })
        .returning();

      const [updated] = await tx
        .update(sheetReservationImportsTable)
        .set({
          status: "approved",
          approvedAt: new Date(),
          approvedBy: approverId,
          matchedOperationId: operation.id,
          matchedCustomerId: customerId,
        })
        .where(eq(sheetReservationImportsTable.id, id))
        .returning();

      return { kind: "approved" as const, importRow: updated, operation };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "already_reviewed") {
      res.status(409).json({ error: "Already reviewed" });
      return;
    }

    await createAuditLog({
      eventType: "sheet_import_approved",
      actorProfileId: approverId,
      module: "sheet_import",
      entityType: "sheet_reservation_import",
      entityId: id,
      metadata: { operationId: result.operation.id, customerId: result.importRow.matchedCustomerId },
      result: "success",
      description: "Sheet import satiri onaylandi, taslak operasyon olusturuldu",
    });

    res.json(result.importRow);
  } catch {
    res.status(500).json({ error: "Failed to approve sheet import" });
  }
});

/**
 * POST /sheet-import/:id/reject
 * Marks the row reviewed and rejected. Never writes to operations/customers.
 */
router.post("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const reviewerId = res.locals.profile.id;

  try {
    const result = await db.transaction(async (tx) => {
      const [importRow] = await tx
        .select()
        .from(sheetReservationImportsTable)
        .where(eq(sheetReservationImportsTable.id, id))
        .for("update");
      if (!importRow) return { kind: "not_found" as const };
      if (importRow.approvedAt || importRow.rejectedAt) {
        return { kind: "already_reviewed" as const };
      }

      const [updated] = await tx
        .update(sheetReservationImportsTable)
        .set({ status: "rejected", rejectedAt: new Date(), rejectedBy: reviewerId })
        .where(eq(sheetReservationImportsTable.id, id))
        .returning();

      return { kind: "rejected" as const, importRow: updated };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "already_reviewed") {
      res.status(409).json({ error: "Already reviewed" });
      return;
    }

    await createAuditLog({
      eventType: "sheet_import_rejected",
      actorProfileId: reviewerId,
      module: "sheet_import",
      entityType: "sheet_reservation_import",
      entityId: id,
      metadata: {},
      result: "success",
      description: "Sheet import satiri reddedildi",
    });

    res.json(result.importRow);
  } catch {
    res.status(500).json({ error: "Failed to reject sheet import" });
  }
});

export default router;
