import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
    sheetReservationImportsTable,
    operationsTable,
    operationReservationDetailsTable,
    customersTable,
    tourProductsTable,
    tourProductAliasesTable,
    shipsTable,
    portsTable,
    portCallsTable,
    resourcesTable,
    vehiclesTable,
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
//
// Faz 5.2: /approve now maps the raw row into structured operations /
// operation_reservation_details fields instead of dumping the whole row into
// notes (see PLAN_Sheet_Import_Mapping_Refactor.md paragraf 5a). rowData itself is
// still never touched - it remains the single source of truth. Matching
// against tour_products/ships/ports/port_calls/resources/vehicles is exact
// (normalized, case-insensitive) name/code matching only, per Faz 1 scope -
// no fuzzy matching, and an unmatched ship/port never creates a new
// port_calls row automatically (reviewer resolves it manually for now).

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
// characters are folded to ASCII so "Musteri Adi" etc. all match.
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

// Faz 5.2: exact-header lookup (normalized header === target, not "includes").
// Used for the GEMI sheet's own well-known 34 columns, where several headers
// share a common prefix (e.g. "Gemi" / "Gemi Saatleri") - includes()-based
// fragment matching would be ambiguous there, so this matches the whole
// normalized header instead.
function findByExactHeader(rowData: SheetRow["rowData"], normalizedTarget: string): string | null {
    for (const [key, value] of Object.entries(rowData)) {
          if (normalizeHeader(key) === normalizedTarget) {
                  const text = value === null ? "" : String(value).trim();
                  if (text) return text;
          }
    }
    return null;
}

function parseNumber(raw: string | number | boolean | null): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    let text = String(raw).trim().replace(/[^\d.,-]/g, "");
    if (!text) return null;
    if (text.includes(".") && text.includes(",")) {
          text = text.replace(/\./g, "").replace(",", ".");
    } else if (text.includes(",")) {
          text = text.replace(",", ".");
    }
    const value = Number.parseFloat(text);
    return Number.isFinite(value) ? value : null;
}

function parseAges(raw: string | null): number[] | null {
    if (!raw) return null;
    const ages = raw
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 120);
    return ages.length > 0 ? ages : null;
}

function parseIncluded(raw: string | null): "included" | "excluded" | "unspecified" {
    if (!raw) return "unspecified";
    const normalized = normalizeHeader(raw);
    if (normalized.includes("dahil")) return "included";
    if (normalized.includes("haric")) return "excluded";
    return "unspecified";
}

function parseTimeRange(raw: string | null): { start: string | null; end: string | null } {
    if (!raw) return { start: null, end: null };
    const parts = raw.split(/[-–]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return { start: parts[0] || null, end: parts[1] || null };
    if (parts.length === 1) return { start: parts[0] || null, end: null };
    return { start: null, end: null };
}

function parseDateOnly(raw: string | null): string | null {
    if (!raw) return null;
    const text = raw.trim();
    if (!text) return null;
    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

// Faz 5.2: structured proposed mapping - the shape stored in
// sheet_reservation_imports.mappedData and used to build the operations /
// operation_reservation_details insert. Always fully derivable from rowData
// (mapSheetRowToStructuredFields below); a reviewer may override any field
// via PATCH /:id/review before /approve runs.
const mappedFieldsSchema = z.object({
    customerName: z.string().nullable(),
    customerPhone: z.string().nullable(),
    customerEmail: z.string().nullable(),
    nationality: z.string().nullable(),
    startDate: z.string().nullable(),
    sourceBookingReference: z.string().nullable(),
    tourCodeRaw: z.string().nullable(),
    tourType: z.string().nullable(),
    externalSource: z.string().nullable(),
    externalOperator: z.string().nullable(),
    adultCount: z.number().nullable(),
    childCount: z.number().nullable(),
    passengerAges: z.array(z.number()).nullable(),
    passengerLanguage: z.string().nullable(),
    shipRaw: z.string().nullable(),
    portRaw: z.string().nullable(),
    shipScheduleRaw: z.string().nullable(),
    specialRequirements: z.string().nullable(),
    opNotes: z.string().nullable(),
    pickupPoint: z.string().nullable(),
    pickupTime: z.string().nullable(),
    itineraryRaw: z.string().nullable(),
    mealIncluded: z.enum(["included", "excluded", "unspecified"]),
    entranceIncluded: z.enum(["included", "excluded", "unspecified"]),
    guideNameRaw: z.string().nullable(),
    driverNameRaw: z.string().nullable(),
    vehiclePlateRaw: z.string().nullable(),
    netAmount: z.number().nullable(),
    currency: z.string().nullable(),
    advanceAmount: z.number().nullable(),
    collectionStatusRaw: z.string().nullable(),
});
type MappedFields = z.infer<typeof mappedFieldsSchema>;

// Body accepted by PATCH /:id/review - any subset of the fields above.
const mappedFieldsPatchSchema = mappedFieldsSchema.partial().strict();

function mapSheetRowToStructuredFields(rowData: SheetRow["rowData"]): MappedFields {
    return {
          customerName: findByFragments(rowData, NAME_FRAGMENTS),
          customerPhone: findByFragments(rowData, PHONE_FRAGMENTS),
          customerEmail: findByFragments(rowData, EMAIL_FRAGMENTS),
          nationality: findByExactHeader(rowData, "ulkemilliyet"),
          startDate: parseDateOnly(findByExactHeader(rowData, "tarih")),
          sourceBookingReference: findByExactHeader(rowData, "bookingid"),
          tourCodeRaw: findByExactHeader(rowData, "turkodu"),
          tourType: findByExactHeader(rowData, "turtipi"),
          externalSource: findByExactHeader(rowData, "kaynak"),
          externalOperator: findByExactHeader(rowData, "operator"),
          adultCount: parseNumber(findByExactHeader(rowData, "adult")),
          childCount: parseNumber(findByExactHeader(rowData, "chd")),
          passengerAges: parseAges(findByExactHeader(rowData, "yaslar")),
          passengerLanguage: findByExactHeader(rowData, "dil"),
          shipRaw: findByExactHeader(rowData, "gemi"),
          portRaw: findByExactHeader(rowData, "liman"),
          shipScheduleRaw: findByExactHeader(rowData, "gemisaatleri"),
          specialRequirements: findByExactHeader(rowData, "ozelnotlar"),
          opNotes: findByExactHeader(rowData, "opnotlari"),
          pickupPoint: findByExactHeader(rowData, "puppoint"),
          pickupTime: findByExactHeader(rowData, "puptime"),
          itineraryRaw: findByExactHeader(rowData, "turicerigi"),
          mealIncluded: parseIncluded(findByExactHeader(rowData, "yemek")),
          entranceIncluded: parseIncluded(findByExactHeader(rowData, "girisler")),
          guideNameRaw: findByExactHeader(rowData, "rehber"),
          driverNameRaw: findByExactHeader(rowData, "sofor"),
          vehiclePlateRaw: findByExactHeader(rowData, "arac"),
          netAmount: parseNumber(findByExactHeader(rowData, "nettutar")),
          currency: findByExactHeader(rowData, "para"),
          advanceAmount: parseNumber(findByExactHeader(rowData, "avanstl")),
          collectionStatusRaw: findByExactHeader(rowData, "tahsilat"),
    };
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
 * GET /sheet-import/:id
 * Single row plus its proposed structured mapping (stored mappedData if the
 * reviewer already edited it via PATCH /review, otherwise freshly derived
 * from rowData). Read-only - never writes anything.
 */
router.get("/:id", async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) {
          res.status(400).json({ error: "Invalid id" });
          return;
    }

             try {
                   const [importRow] = await db
                     .select()
                     .from(sheetReservationImportsTable)
                     .where(eq(sheetReservationImportsTable.id, id));
                   if (!importRow) {
                           res.status(404).json({ error: "Not found" });
                           return;
                   }

      const rowData = importRow.rowData as SheetRow["rowData"];
                   const mappedData = (importRow.mappedData as MappedFields | null) ?? mapSheetRowToStructuredFields(rowData);

      res.json({ ...importRow, mappedData });
             } catch {
                   res.status(500).json({ error: "Failed to load sheet import" });
             }
});

/**
 * PATCH /sheet-import/:id/review
 * Lets a reviewer correct the proposed structured mapping before /approve
 * runs (e.g. a misread ship name or tour code). Only allowed while the row
 * is still pending. Merges into any previously-saved mappedData - never
 * touches rowData, which stays the untouched source of truth.
 */
router.patch("/:id/review", async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) {
          res.status(400).json({ error: "Invalid id" });
          return;
    }

               const parsed = mappedFieldsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
          res.status(400).json({ error: "Invalid review data" });
          return;
    }

               try {
                     const [importRow] = await db
                       .select()
                       .from(sheetReservationImportsTable)
                       .where(eq(sheetReservationImportsTable.id, id));
                     if (!importRow) {
                             res.status(404).json({ error: "Not found" });
                             return;
                     }
                     if (importRow.approvedAt || importRow.rejectedAt) {
                             res.status(409).json({ error: "Already reviewed" });
                             return;
                     }

      const rowData = importRow.rowData as SheetRow["rowData"];
                     const current = (importRow.mappedData as MappedFields | null) ?? mapSheetRowToStructuredFields(rowData);
                     const merged: MappedFields = { ...current, ...parsed.data };

      const [updated] = await db
                       .update(sheetReservationImportsTable)
                       .set({ mappedData: merged })
                       .where(eq(sheetReservationImportsTable.id, id))
                       .returning();

      res.json({ ...updated, mappedData: merged });
               } catch {
                     res.status(500).json({ error: "Failed to update review" });
               }
});

/**
 * POST /sheet-import/:id/approve
 * Faz 5.2: builds a structured operations row (+ operation_reservation_details)
 * from the proposed mapping (mappedData if the reviewer edited it, otherwise
 * freshly derived from rowData) instead of dumping the whole row into notes.
 * Matching against tour_products/ships+ports/port_calls/resources/vehicles is
 * exact, normalized, case-insensitive name/code matching only - no fuzzy
 * matching, and an unmatched ship/port never creates a new port_calls row
 * automatically. Legacy guideName/driverName/vehiclePlate text columns are
 * always populated from the raw sheet value regardless of match, so nothing
 * regresses if a resource/vehicle isn't registered yet.
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
                            const fields = (importRow.mappedData as MappedFields | null) ?? mapSheetRowToStructuredFields(rowData);

                                                              // Customer - unchanged from Faz 4 (only creates a new customer, never
                                                              // matches an existing one; that dedup gap is pre-existing and out of
                                                              // scope here), extended to also carry nationality.
                                                              let customerId: number | null = null;
                            if (fields.customerName) {
                                      const [customer] = await tx
                                        .insert(customersTable)
                                        .values({
                                                      name: fields.customerName,
                                                      phone: fields.customerPhone,
                                                      email: fields.customerEmail,
                                                      nationality: fields.nationality,
                                        })
                                        .returning({ id: customersTable.id });
                                      customerId = customer.id;
                            }

                                                              // Tour product: exact code match, then sheet_import alias match.
                                                              let tourProductId: number | null = null;
                            let tourProductMatchStatus: "matched" | "alias_matched" | "unmatched" = "unmatched";
                            const tourCode = fields.tourCodeRaw?.trim();
                            if (tourCode) {
                                      const [product] = await tx
                                        .select({ id: tourProductsTable.id })
                                        .from(tourProductsTable)
                                        .where(sql`lower(trim(${tourProductsTable.code})) = lower(trim(${tourCode}))`)
                                        .limit(1);
                                      if (product) {
                                                  tourProductId = product.id;
                                                  tourProductMatchStatus = "matched";
                                      } else {
                                                  const [alias] = await tx
                                                    .select({ tourProductId: tourProductAliasesTable.tourProductId })
                                                    .from(tourProductAliasesTable)
                                                    .where(and(
                                                                    eq(tourProductAliasesTable.source, "sheet_import"),
                                                                    sql`lower(trim(${tourProductAliasesTable.alias})) = lower(trim(${tourCode}))`,
                                                                  ))
                                                    .limit(1);
                                                  if (alias) {
                                                                tourProductId = alias.tourProductId;
                                                                tourProductMatchStatus = "alias_matched";
                                                  }
                                      }
                            }

                                                              // Ship + port + date -> port_calls. portCallId is only ever set on an
                                                              // exact "matched" result; "time_changed"/"new_port_call"/"unmatched"
                                                              // all leave it null and keep the raw ship/port/schedule text on the
                                                              // reservation details row for the reviewer to resolve manually - no
                                                              // port_calls row is ever created automatically (Faz 1 scope).
                                                              let portCallId: number | null = null;
                            let portCallMatchStatus: "matched" | "new_port_call" | "time_changed" | "unmatched" = "unmatched";
                            const shipRaw = fields.shipRaw?.trim();
                            const portRaw = fields.portRaw?.trim();
                            if (shipRaw && portRaw && fields.startDate) {
                                      const [ship] = await tx
                                        .select({ id: shipsTable.id })
                                        .from(shipsTable)
                                        .where(sql`lower(trim(${shipsTable.normalizedName})) = lower(trim(${shipRaw}))`)
                                        .limit(1);
                                      const [port] = await tx
                                        .select({ id: portsTable.id })
                                        .from(portsTable)
                                        .where(sql`lower(trim(${portsTable.name})) = lower(trim(${portRaw})) OR lower(trim(${portsTable.code})) = lower(trim(${portRaw}))`)
                                        .limit(1);

                              if (ship && port) {
                                          const [call] = await tx
                                            .select()
                                            .from(portCallsTable)
                                            .where(and(
                                                            eq(portCallsTable.shipId, ship.id),
                                                            eq(portCallsTable.portId, port.id),
                                                            eq(portCallsTable.arrivalDate, fields.startDate),
                                                          ))
                                            .limit(1);

                                        if (call) {
                                                      const parsedTimes = parseTimeRange(fields.shipScheduleRaw);
                                                      const timesMatch =
                                                                      (!parsedTimes.start || parsedTimes.start === call.arrivalTime)
                                                        && (!parsedTimes.end || parsedTimes.end === call.departureTime);
                                                      if (timesMatch) {
                                                                      portCallId = call.id;
                                                                      portCallMatchStatus = "matched";
                                                      } else {
                                                                      portCallMatchStatus = "time_changed";
                                                      }
                                        } else {
                                                      portCallMatchStatus = "new_port_call";
                                        }
                              }
                            }

                                                              // Guide / driver / vehicle - exact name/plate match only (Faz 1
                                                              // scope, per the approved plan; fuzzy matching is a later phase).
                                                              // Legacy text fields are always populated regardless of match result.
                                                              let guideResourceId: number | null = null;
                            const guideRaw = fields.guideNameRaw?.trim();
                            if (guideRaw) {
                                      const [guide] = await tx
                                        .select({ id: resourcesTable.id })
                                        .from(resourcesTable)
                                        .where(and(
                                                      eq(resourcesTable.type, "GUIDE"),
                                                      eq(resourcesTable.active, true),
                                                      sql`lower(trim(${resourcesTable.name})) = lower(trim(${guideRaw}))`,
                                                    ))
                                        .limit(1);
                                      if (guide) guideResourceId = guide.id;
                            }

                                                              let driverResourceId: number | null = null;
                            const driverRaw = fields.driverNameRaw?.trim();
                            if (driverRaw) {
                                      const [driver] = await tx
                                        .select({ id: resourcesTable.id })
                                        .from(resourcesTable)
                                        .where(and(
                                                      eq(resourcesTable.type, "DRIVER"),
                                                      eq(resourcesTable.active, true),
                                                      sql`lower(trim(${resourcesTable.name})) = lower(trim(${driverRaw}))`,
                                                    ))
                                        .limit(1);
                                      if (driver) driverResourceId = driver.id;
                            }

                                                              let vehicleId: number | null = null;
                            const plateRaw = fields.vehiclePlateRaw?.trim();
                            if (plateRaw) {
                                      const [vehicle] = await tx
                                        .select({ id: vehiclesTable.id })
                                        .from(vehiclesTable)
                                        .where(and(
                                                      eq(vehiclesTable.active, true),
                                                      sql`lower(trim(${vehiclesTable.plate})) = lower(trim(${plateRaw}))`,
                                                    ))
                                        .limit(1);
                                      if (vehicle) vehicleId = vehicle.id;
                            }

                                                              // notes now only carries the two genuinely free-text columns ("Ozel
                                                              // Notlar" + "Op Notlari") - the rest of the row lives in structured
                                                              // fields (or, unabridged, in sheet_reservation_imports.rowData for
                                                              // Import Audit).
                                                              const notesParts: string[] = [];
                            if (fields.specialRequirements) notesParts.push(`Ozel Notlar: ${fields.specialRequirements}`);
                            if (fields.opNotes) notesParts.push(fields.opNotes);
                            const notes = notesParts.length > 0 ? notesParts.join("\n\n") : null;

                                                              const [operation] = await tx
                              .insert(operationsTable)
                              .values({
                                          sourceType: "sheet_import",
                                          sourceSheetImportId: importRow.id,
                                          sourceBookingReference: fields.sourceBookingReference,
                                          customerId,
                                          startDate: fields.startDate,
                                          endDate: fields.startDate,
                                          pickupTime: fields.pickupTime,
                                          portCallId,
                                          tourProductId,
                                          guideResourceId,
                                          driverResourceId,
                                          vehicleId,
                                          guideName: fields.guideNameRaw,
                                          driverName: fields.driverNameRaw,
                                          vehiclePlate: fields.vehiclePlateRaw,
                                          notes,
                              })
                              .returning();

                                                              await tx.insert(operationReservationDetailsTable).values({
                                                                        operationId: operation.id,
                                                                        adultCount: fields.adultCount,
                                                                        childCount: fields.childCount,
                                                                        passengerAges: fields.passengerAges,
                                                                        passengerLanguage: fields.passengerLanguage,
                                                                        tourType: fields.tourType,
                                                                        tourCodeRaw: fields.tourCodeRaw,
                                                                        itineraryRaw: fields.itineraryRaw,
                                                                        shipScheduleRaw: fields.shipScheduleRaw,
                                                                        pickupPoint: fields.pickupPoint,
                                                                        mealIncluded: fields.mealIncluded,
                                                                        entranceIncluded: fields.entranceIncluded,
                                                                        specialRequirements: fields.specialRequirements,
                                                                        externalSource: fields.externalSource,
                                                                        externalOperator: fields.externalOperator,
                                                                        netAmount: fields.netAmount,
                                                                        advanceAmount: fields.advanceAmount,
                                                                        currency: fields.currency,
                                                                        collectionStatusRaw: fields.collectionStatusRaw,
                                                              });

                                                              const [updated] = await tx
                              .update(sheetReservationImportsTable)
                              .set({
                                          status: "approved",
                                          approvedAt: new Date(),
                                          approvedBy: approverId,
                                          matchedOperationId: operation.id,
                                          matchedCustomerId: customerId,
                                          mappedData: fields,
                                          tourProductMatchStatus,
                                          portCallMatchStatus,
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
              metadata: {
                        operationId: result.operation.id,
                        customerId: result.importRow.matchedCustomerId,
                        tourProductMatchStatus: result.importRow.tourProductMatchStatus,
                        portCallMatchStatus: result.importRow.portCallMatchStatus,
              },
              result: "success",
              description: "Sheet import satiri onaylandi, yapilandirilmis operasyon olusturuldu",
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
