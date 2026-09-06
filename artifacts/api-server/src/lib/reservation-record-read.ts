import { db } from "@workspace/db";
import {
  reservationsTable, bookingPartiesTable, operationsTable, customersTable,
  guestsTable, auditLogsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, sql, ilike, type SQL } from "drizzle-orm";
import type { RequestHandler } from "express";
import { partyPax } from "./operation-detail-model";

/**
 * Read models for the Reservation Management Workspace (Phase 2A) — the
 * true Reservation-domain list/detail, distinct from the
 * reservationEmailImportsTable-backed inbox served at GET /api/reservations
 * (routes/reservations.ts). That router owns the "Gelen Rezervasyonlar"
 * import/approval queue; this one owns the persisted Reservation/
 * BookingParty/Guest records those approvals (and sheet-import/historical
 * promotion) create.
 *
 * Every reservations row has a NOT NULL tourOperationId (see
 * lib/db/src/schema/reservations.ts) — there is currently no schema state in
 * which a Reservation exists without an Operation. The "unlinked" filter and
 * warning below are implemented anyway (harmless, forward-compatible if a
 * future phase ever allows a draft Reservation before Operation assignment)
 * but will never match a real row today; this is called out explicitly in
 * the Phase 2A report rather than left as a silent dead code path.
 */

// Fields kept intentionally minimal here — see PII caution below. Anything
// beyond id/name (email, phone, nationality, passport, notes, ...) is only
// ever reached by following the link to the existing Customer detail page,
// never inlined into a Reservation list or detail response.
const CUSTOMER_MINIMAL = { id: customersTable.id, name: customersTable.name };

type ListFilters = {
  dateFrom?: string; dateTo?: string;
  reservationStatus?: string; operationStatus?: string; sourceType?: string;
  operator?: string; bookingReference?: string; q?: string;
  operationLinked?: "linked" | "unlinked";
  incompletePax?: boolean; missingPickup?: boolean; missingLanguage?: boolean;
  missingBookingReference?: boolean;
}

function parseBool(v: unknown): boolean | undefined {
  return v === "true" ? true : undefined;
}

function buildFilters(query: Record<string, unknown>): ListFilters {
  return {
    dateFrom: typeof query.dateFrom === "string" && query.dateFrom ? query.dateFrom : undefined,
    dateTo: typeof query.dateTo === "string" && query.dateTo ? query.dateTo : undefined,
    reservationStatus: typeof query.reservationStatus === "string" && query.reservationStatus ? query.reservationStatus : undefined,
    operationStatus: typeof query.operationStatus === "string" && query.operationStatus ? query.operationStatus : undefined,
    sourceType: typeof query.sourceType === "string" && query.sourceType ? query.sourceType : undefined,
    operator: typeof query.operator === "string" && query.operator ? query.operator : undefined,
    bookingReference: typeof query.bookingReference === "string" && query.bookingReference ? query.bookingReference : undefined,
    q: typeof query.q === "string" && query.q ? query.q : undefined,
    operationLinked: query.operationLinked === "linked" || query.operationLinked === "unlinked" ? query.operationLinked : undefined,
    incompletePax: parseBool(query.incompletePax),
    missingPickup: parseBool(query.missingPickup),
    missingLanguage: parseBool(query.missingLanguage),
    missingBookingReference: parseBool(query.missingBookingReference),
  };
}

/** Deterministic only — no AI/heuristic warnings, per Phase 2A scope. */
function collectRowWarnings(row: {
  reservationSourceType: string | null;
  sourceBookingReference: string | null;
  tourOperationId: number | null;
  adultCount: number | null | undefined;
  childCount: number | null | undefined;
  passengerLanguage: string | null | undefined;
  pickupPoint: string | null | undefined;
}): string[] {
  const warnings: string[] = [];
  if (row.adultCount == null || row.childCount == null) warnings.push("incomplete_pax");
  if (!row.passengerLanguage) warnings.push("missing_language");
  if (!row.pickupPoint) warnings.push("missing_pickup");
  if (row.tourOperationId == null) warnings.push("unlinked_operation"); // structurally unreachable today; see module note
  if (!row.sourceBookingReference && row.reservationSourceType && row.reservationSourceType !== "manual") {
    warnings.push("missing_booking_reference");
  }
  return warnings;
}

/**
 * GET /api/reservation-records — one batched, filtered SQL query regardless
 * of row count (Reservation ⋈ BookingParty ⋈ Operation ⋈ Customer). No
 * pagination: matches the existing convention in this codebase (operations,
 * customers, tours, suppliers all return the full filtered set — see
 * routes/operations.ts, routes/customers.ts), so this does not introduce a
 * one-off pagination scheme the rest of the app doesn't share. Filtering
 * itself is done in SQL (not in-memory, unlike those two precedents) since
 * this is the first list expected to grow past a few hundred rows.
 */
export const reservationRecordListRead: RequestHandler = async (req, res) => {
  try {
    const f = buildFilters(req.query as Record<string, unknown>);
    if (f.operationLinked === "unlinked") {
      // See module note: tourOperationId is NOT NULL today, so this filter
      // is honored honestly by returning zero rows rather than silently
      // ignored or made to match something it structurally cannot mean.
      res.json([]);
      return;
    }

    const conditions: (SQL | undefined)[] = [
      f.dateFrom ? sql`${operationsTable.startDate} >= ${f.dateFrom}` : undefined,
      f.dateTo ? sql`${operationsTable.startDate} <= ${f.dateTo}` : undefined,
      f.reservationStatus ? eq(reservationsTable.status, f.reservationStatus) : undefined,
      f.operationStatus ? eq(operationsTable.status, f.operationStatus) : undefined,
      f.sourceType ? eq(reservationsTable.sourceType, f.sourceType) : undefined,
      f.operator ? ilike(bookingPartiesTable.externalOperator, `%${f.operator}%`) : undefined,
      f.bookingReference ? sql`lower(trim(${reservationsTable.sourceBookingReference})) LIKE ${`%${f.bookingReference.toLowerCase().trim()}%`}` : undefined,
      f.q ? or(ilike(reservationsTable.leadGuestName, `%${f.q}%`), ilike(customersTable.name, `%${f.q}%`)) : undefined,
      f.incompletePax ? or(sql`${bookingPartiesTable.adultCount} IS NULL`, sql`${bookingPartiesTable.childCount} IS NULL`) : undefined,
      f.missingPickup ? sql`${bookingPartiesTable.pickupPoint} IS NULL` : undefined,
      f.missingLanguage ? sql`${bookingPartiesTable.passengerLanguage} IS NULL` : undefined,
      f.missingBookingReference ? sql`${reservationsTable.sourceBookingReference} IS NULL` : undefined,
    ];
    const where = and(...conditions.filter((c): c is SQL => c !== undefined));

    const rows = await db.select({
      reservation: {
        id: reservationsTable.id, leadGuestName: reservationsTable.leadGuestName,
        status: reservationsTable.status, sourceType: reservationsTable.sourceType,
        sourceBookingReference: reservationsTable.sourceBookingReference,
        createdAt: reservationsTable.createdAt,
      },
      bookingParty: {
        id: bookingPartiesTable.id, adultCount: bookingPartiesTable.adultCount,
        childCount: bookingPartiesTable.childCount, passengerLanguage: bookingPartiesTable.passengerLanguage,
        pickupPoint: bookingPartiesTable.pickupPoint, externalOperator: bookingPartiesTable.externalOperator,
      },
      customer: CUSTOMER_MINIMAL,
      operation: {
        id: operationsTable.id, status: operationsTable.status, startDate: operationsTable.startDate,
      },
    }).from(reservationsTable)
      .leftJoin(bookingPartiesTable, eq(bookingPartiesTable.reservationId, reservationsTable.id))
      .leftJoin(operationsTable, eq(operationsTable.id, reservationsTable.tourOperationId))
      .leftJoin(customersTable, eq(customersTable.id, reservationsTable.customerId))
      .where(where)
      .orderBy(desc(operationsTable.startDate), desc(reservationsTable.id));

    const shaped = rows.map(row => ({
      reservation: row.reservation,
      bookingParty: row.bookingParty?.id ? { ...row.bookingParty, totalPax: partyPax(row.bookingParty) } : null,
      customer: row.customer?.id ? row.customer : null,
      operation: row.operation?.id ? row.operation : null,
      warnings: collectRowWarnings({
        reservationSourceType: row.reservation.sourceType,
        sourceBookingReference: row.reservation.sourceBookingReference,
        tourOperationId: row.operation?.id ?? null,
        adultCount: row.bookingParty?.adultCount, childCount: row.bookingParty?.childCount,
        passengerLanguage: row.bookingParty?.passengerLanguage, pickupPoint: row.bookingParty?.pickupPoint,
      }),
    }));
    res.json(shaped);
  } catch (err) {
    req.log?.error({ err }, "reservation-records list failed");
    res.status(500).json({ error: "Rezervasyonlar yüklenemedi" });
  }
};

/**
 * GET /api/reservation-records/:id — 4 fixed queries regardless of sibling
 * count: (1) the reservation joined to its BookingParty/Operation/Customer,
 * (2) that party's Guests, (3) sibling Reservations under the same
 * Operation (id/leadGuestName/status only, for the "this Operation also
 * covers N other reservations" context — never merged into this record),
 * (4) recent audit activity for this reservation.
 */
export const reservationRecordDetailRead: RequestHandler = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Geçersiz ID" }); return; }

    const [row] = await db.select({
      reservation: reservationsTable,
      bookingParty: bookingPartiesTable,
      customer: CUSTOMER_MINIMAL,
      operation: operationsTable,
    }).from(reservationsTable)
      .leftJoin(bookingPartiesTable, eq(bookingPartiesTable.reservationId, reservationsTable.id))
      .leftJoin(operationsTable, eq(operationsTable.id, reservationsTable.tourOperationId))
      .leftJoin(customersTable, eq(customersTable.id, reservationsTable.customerId))
      .where(eq(reservationsTable.id, id));
    if (!row) { res.status(404).json({ error: "Rezervasyon bulunamadı" }); return; }

    const guests = row.bookingParty ? await db.select().from(guestsTable)
      .where(eq(guestsTable.bookingPartyId, row.bookingParty.id)).orderBy(guestsTable.id) : [];

    const siblings = row.operation ? await db.select({
      id: reservationsTable.id, leadGuestName: reservationsTable.leadGuestName, status: reservationsTable.status,
    }).from(reservationsTable)
      .where(and(eq(reservationsTable.tourOperationId, row.operation.id), sql`${reservationsTable.id} != ${id}`))
      .orderBy(reservationsTable.id) : [];

    const activity = await db.select({
      id: auditLogsTable.id, eventType: auditLogsTable.eventType,
      actorName: sql<string | null>`${auditLogsTable.metadata}->>'actorName'`,
      createdAt: auditLogsTable.createdAt,
    }).from(auditLogsTable).where(and(
      eq(sql`${auditLogsTable.metadata}->>'entityType'`, "reservation"),
      eq(sql`${auditLogsTable.metadata}->>'entityId'`, String(id)),
    )).orderBy(desc(auditLogsTable.createdAt), desc(auditLogsTable.id)).limit(50);

    res.json({
      reservation: row.reservation,
      bookingParty: row.bookingParty ? {
        ...row.bookingParty, totalPax: partyPax(row.bookingParty), guests,
      } : null,
      customer: row.customer?.id ? row.customer : null,
      operation: row.operation ?? null,
      siblingReservations: siblings,
      warnings: collectRowWarnings({
        reservationSourceType: row.reservation.sourceType,
        sourceBookingReference: row.reservation.sourceBookingReference,
        tourOperationId: row.operation?.id ?? null,
        adultCount: row.bookingParty?.adultCount, childCount: row.bookingParty?.childCount,
        passengerLanguage: row.bookingParty?.passengerLanguage, pickupPoint: row.bookingParty?.pickupPoint,
      }),
      activity: { activity, limit: 50 },
    });
  } catch (err) {
    req.log?.error({ err }, "reservation-record detail failed");
    res.status(500).json({ error: "Rezervasyon detayı yüklenemedi" });
  }
};
