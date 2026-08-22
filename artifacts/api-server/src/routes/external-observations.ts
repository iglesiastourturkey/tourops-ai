import { Router } from "express";
import { db } from "@workspace/db";
import { externalPortCallObservationsTable, shipsTable, portsTable, portCallsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../lib/auth";
import { createAuditLog } from "../lib/audit";

const router = Router();

// Manual-entry / human review workflow for external_port_call_observations.
// No provider/scraper code calls into this router - rows are entered by
// hand (phone call, email, port authority notice, etc) and reviewed here
// before anything touches port_calls. port_calls stays the system of
// record; nothing in this file writes to it without an explicit approve
// click from an authenticated admin/operations user.
router.use(requireAuth, requireRole("admin", "operations"));

// Matches ships.normalizedName's own convention (lib/db/src/schema/ships.ts):
// lowercase + trim + collapse internal whitespace. Never fuzzy-matched -
// an unmatched name is surfaced to the human, not guessed at.
function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

const REVIEWABLE_STATUSES = new Set(["MATCHED", "NEW_PORT_CALL", "TIME_CHANGED"]);

/**
* GET /external-observations?status=pending|approved|rejected|all
* Defaults to "pending" (neither approved nor rejected yet).
*/
router.get("/", async (req, res) => {
  try {
    const status = (req.query.status as string) ?? "pending";
    const rows = await db
    .select()
    .from(externalPortCallObservationsTable)
    .orderBy(desc(externalPortCallObservationsTable.fetchedAt));

  const filtered = rows.filter((r) => {
    if (status === "all") return true;
    if (status === "approved") return r.approvedAt !== null;
    if (status === "rejected") return r.rejectedAt !== null;
    return r.approvedAt === null && r.rejectedAt === null;
  });

  res.json(filtered);
  } catch {
    res.status(500).json({ error: "Failed to list observations" });
  }
});

const manualEntrySchema = z.object({
  provider: z.string().trim().min(1).max(80),
  externalReference: z.string().trim().min(1).max(160),
  shipNameRaw: z.string().trim().min(1),
  portNameRaw: z.string().trim().min(1),
  arrivalDate: z.string().trim().min(1).nullable().optional(),
  arrivalTime: z.string().trim().min(1).nullable().optional(),
  departureDate: z.string().trim().min(1).nullable().optional(),
  departureTime: z.string().trim().min(1).nullable().optional(),
  rawPayload: z.record(z.unknown()).nullable().optional(),
});

/**
* POST /external-observations
* Manual entry only - no scraper/provider calls this endpoint. Normalizes
* the ship/port names, attempts an exact match (never fuzzy - see the
* architecture research report), classifies the observation against the
* existing port_calls row (if any), and stores it as a review candidate.
* Idempotent on (provider, externalReference): re-submitting the same
* observation updates the existing row instead of creating a duplicate,
* and reopens it for review if it had already been approved/rejected.
*/
router.post("/", async (req, res) => {
  const parsed = manualEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid observation", details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;

            try {
              const [ship] = await db
              .select()
              .from(shipsTable)
              .where(eq(shipsTable.normalizedName, normalizeName(input.shipNameRaw)))
              .limit(1);

  const ports = await db.select().from(portsTable);
              const normalizedPortInput = normalizeName(input.portNameRaw);
              const port = ports.find((p) => normalizeName(p.name) === normalizedPortInput);

  let matchStatus: string;
              let matchedPortCallId: number | null = null;
              let detectedChanges: Record<string, unknown> | null = null;

  if (!ship) {
    matchStatus = "SHIP_UNMATCHED";
  } else if (!port) {
    matchStatus = "PORT_UNMATCHED";
  } else if (!input.arrivalDate) {
    matchStatus = "SOURCE_MISSING_TIME";
  } else {
    const [existing] = await db
    .select()
    .from(portCallsTable)
    .where(
      and(
        eq(portCallsTable.shipId, ship.id),
        eq(portCallsTable.portId, port.id),
        eq(portCallsTable.arrivalDate, input.arrivalDate),
        ),
      )
    .limit(1);

              if (!existing) {
                matchStatus = "NEW_PORT_CALL";
              } else {
                matchedPortCallId = existing.id;
                const changed: Record<string, { from: unknown; to: unknown }> = {};
                if ((input.arrivalTime ?? null) !== (existing.arrivalTime ?? null)) {
                  changed.arrivalTime = { from: existing.arrivalTime, to: input.arrivalTime ?? null };
                }
                if ((input.departureDate ?? null) !== (existing.departureDate ?? null)) {
                  changed.departureDate = { from: existing.departureDate, to: input.departureDate ?? null };
                }
                if ((input.departureTime ?? null) !== (existing.departureTime ?? null)) {
                  changed.departureTime = { from: existing.departureTime, to: input.departureTime ?? null };
                }
                matchStatus = Object.keys(changed).length > 0 ? "TIME_CHANGED" : "MATCHED";
                detectedChanges = Object.keys(changed).length > 0 ? changed : null;
              }
  }

  const values = {
    provider: input.provider,
    externalReference: input.externalReference,
    shipNameRaw: input.shipNameRaw,
    shipId: ship?.id ?? null,
    portNameRaw: input.portNameRaw,
    portId: port?.id ?? null,
    arrivalDate: input.arrivalDate ?? null,
    arrivalTime: input.arrivalTime ?? null,
    departureDate: input.departureDate ?? null,
    departureTime: input.departureTime ?? null,
    matchStatus,
    matchedPortCallId,
    detectedChanges,
    rawPayload: input.rawPayload ?? null,
  };

  const [row] = await db
              .insert(externalPortCallObservationsTable)
              .values(values)
              .onConflictDoUpdate({
                target: [externalPortCallObservationsTable.provider, externalPortCallObservationsTable.externalReference],
                set: {
                  ...values,
                  approvedAt: null,
                  approvedBy: null,
                  rejectedAt: null,
                  rejectedBy: null,
                },
              })
              .returning();

  res.status(201).json(row);
            } catch {
              res.status(500).json({ error: "Failed to save observation" });
            }
});

/**
* POST /external-observations/:id/approve
* Only MATCHED / NEW_PORT_CALL / TIME_CHANGED can be approved directly.
* SHIP_UNMATCHED, PORT_UNMATCHED, CONFLICT, SOURCE_MISSING_TIME and
* MANUAL_REVIEW_REQUIRED must be corrected (re-submitted) before they can
* be approved. port_calls is only ever written here, after this click.
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
                const [obs] = await tx
                .select()
                .from(externalPortCallObservationsTable)
                .where(eq(externalPortCallObservationsTable.id, id))
                .for("update");
                if (!obs) return { kind: "not_found" as const };
                if (obs.approvedAt || obs.rejectedAt) return { kind: "already_reviewed" as const };
                if (!REVIEWABLE_STATUSES.has(obs.matchStatus)) {
                  return { kind: "not_reviewable" as const, matchStatus: obs.matchStatus };
                }

                                                  let portCallId = obs.matchedPortCallId;

                                                  if (obs.matchStatus === "NEW_PORT_CALL") {
                                                    const [created] = await tx
                                                    .insert(portCallsTable)
                                                    .values({
                                                      shipId: obs.shipId as number,
                                                      portId: obs.portId as number,
                                                      arrivalDate: obs.arrivalDate as string,
                                                      arrivalTime: obs.arrivalTime,
                                                      departureDate: obs.departureDate,
                                                      departureTime: obs.departureTime,
                                                      notes: `Dis kaynak onayi: ${obs.provider} (${obs.externalReference})`,
                                                    })
                                                    .returning();
                                                    portCallId = created.id;
                                                  } else if (obs.matchStatus === "TIME_CHANGED" && obs.matchedPortCallId) {
                                                    await tx
                                                    .update(portCallsTable)
                                                    .set({
                                                      arrivalTime: obs.arrivalTime,
                                                      departureDate: obs.departureDate,
                                                      departureTime: obs.departureTime,
                                                      updatedAt: new Date(),
                                                    })
                                                    .where(eq(portCallsTable.id, obs.matchedPortCallId));
                                                  }

                                                  const [updated] = await tx
                .update(externalPortCallObservationsTable)
                .set({
                  matchedPortCallId: portCallId,
                  approvedAt: new Date(),
                  approvedBy: approverId,
                })
                .where(eq(externalPortCallObservationsTable.id, id))
                .returning();

                                                  return { kind: "approved" as const, observation: updated };
              });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Not found" });
    return;
  }
              if (result.kind === "already_reviewed") {
                res.status(409).json({ error: "Already reviewed" });
                return;
              }
              if (result.kind === "not_reviewable") {
                res.status(400).json({
                  error: `matchStatus '${result.matchStatus}' cannot be approved directly - correct and re-submit first`,
                });
                return;
              }

  await createAuditLog({
    eventType: "external_observation_approved",
    actorProfileId: approverId,
    module: "cruise_schedule",
    entityType: "external_port_call_observation",
    entityId: id,
    metadata: { matchedPortCallId: result.observation.matchedPortCallId },
    result: "success",
    description: "Dis kaynak gozlemi onaylandi, port_calls guncellendi",
  });

  res.json(result.observation);
            } catch {
              res.status(500).json({ error: "Failed to approve observation" });
            }
});

/**
* POST /external-observations/:id/reject
* Marks the observation reviewed and rejected. Never writes to port_calls.
*/
router.post("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const reviewerId = res.locals.profile.id;

            try {
              const [obs] = await db
              .select()
              .from(externalPortCallObservationsTable)
              .where(eq(externalPortCallObservationsTable.id, id))
              .limit(1);
              if (!obs) {
                res.status(404).json({ error: "Not found" });
                return;
              }
              if (obs.approvedAt || obs.rejectedAt) {
                res.status(409).json({ error: "Already reviewed" });
                return;
              }

  const [updated] = await db
              .update(externalPortCallObservationsTable)
              .set({ rejectedAt: new Date(), rejectedBy: reviewerId })
              .where(eq(externalPortCallObservationsTable.id, id))
              .returning();

  await createAuditLog({
    eventType: "external_observation_rejected",
    actorProfileId: reviewerId,
    module: "cruise_schedule",
    entityType: "external_port_call_observation",
    entityId: id,
    metadata: {},
    result: "success",
    description: "Dis kaynak gozlemi reddedildi",
  });

  res.json(updated);
            } catch {
              res.status(500).json({ error: "Failed to reject observation" });
            }
});

export default router;
