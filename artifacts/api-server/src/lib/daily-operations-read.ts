import { db } from "@workspace/db";
import {
  operationsTable, reservationsTable, bookingPartiesTable, operationReservationDetailsTable,
  toursTable, tourProductsTable, portCallsTable, shipsTable, portsTable,
  resourcesTable, vehiclesTable, profilesTable,
} from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { RequestHandler } from "express";
import { todayInIstanbul } from "./reservation-validation";
import { buildDailyBoard, type DailyOperationInput, type DailyReservationInput } from "./daily-operations-model";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/operations/daily?date=YYYY-MM-DD — one batched read for the whole
 * Daily Operations Center board. Mounted BEFORE the generic `/:id` route in
 * operations.ts: Express matches routes in registration order, and `/:id` is
 * a single path segment just like `/daily`, so registering this after it
 * would make `parseInt("daily")` (NaN) swallow every request here first.
 *
 * `operations.startDate` is a plain SQL `date` column - no time-of-day, no
 * timezone component - so "does this Operation belong to `date`" is an exact
 * string-equality match with no UTC/Istanbul conversion involved. There is
 * nothing to get wrong here the way there would be with a timestamptz. A
 * multi-day Operation (endDate > startDate) is shown once, on its startDate
 * only - the same convention the existing Calendar page's month/day view
 * already uses (see calendar-grouping.ts), preserved rather than redecided.
 *
 * Exactly three queries regardless of how many Operations/Reservations exist
 * for the day: one joined query for the day's Operations + their tour/ship/
 * port/guide/driver/vehicle context, one batched query for every Reservation
 * + BookingParty across all of those Operations, and one batched legacy
 * lookup restricted to only the Operations that came back with zero
 * Reservations. Guests are never fetched here - the daily board does not
 * display them; Operation Detail (Phase 1C) remains the place for that.
 */
export const dailyOperationsRead: RequestHandler = async (req, res) => {
  try {
    const rawDate = typeof req.query.date === "string" ? req.query.date : undefined;
    if (rawDate !== undefined && !ISO_DATE_RE.test(rawDate)) {
      res.status(400).json({ error: "date, YYYY-MM-DD biçiminde olmalı" });
      return;
    }
    const date = rawDate ?? todayInIstanbul();

    const driver = alias(resourcesTable, "daily_driver");
    const rows = await db.select({
      id: operationsTable.id,
      status: operationsTable.status,
      startDate: operationsTable.startDate,
      endDate: operationsTable.endDate,
      pickupTime: operationsTable.pickupTime,
      notes: operationsTable.notes,
      opGuideName: operationsTable.guideName,
      opGuidePhone: operationsTable.guidePhone,
      opDriverName: operationsTable.driverName,
      opDriverPhone: operationsTable.driverPhone,
      opVehiclePlate: operationsTable.vehiclePlate,
      tourName: toursTable.name,
      programName: tourProductsTable.name,
      programCode: tourProductsTable.code,
      shipName: shipsTable.name,
      cruiseLine: shipsTable.cruiseLine,
      portName: portsTable.name,
      arrivalTime: portCallsTable.arrivalTime,
      departureTime: portCallsTable.departureTime,
      tourArrivalTime: toursTable.shipArrivalTime,
      tourDepartureTime: toursTable.shipDepartureTime,
      guideResourceName: resourcesTable.name,
      guideResourcePhone: resourcesTable.phone,
      assignedGuideName: profilesTable.name,
      driverResourceName: driver.name,
      driverResourcePhone: driver.phone,
      vehiclePlate: vehiclesTable.plate,
      vehicleType: vehiclesTable.type,
      vehicleCapacity: vehiclesTable.capacity,
    }).from(operationsTable)
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .leftJoin(tourProductsTable, eq(operationsTable.tourProductId, tourProductsTable.id))
      .leftJoin(portCallsTable, eq(operationsTable.portCallId, portCallsTable.id))
      .leftJoin(shipsTable, eq(portCallsTable.shipId, shipsTable.id))
      .leftJoin(portsTable, eq(portCallsTable.portId, portsTable.id))
      .leftJoin(resourcesTable, eq(operationsTable.guideResourceId, resourcesTable.id))
      .leftJoin(driver, eq(operationsTable.driverResourceId, driver.id))
      .leftJoin(vehiclesTable, eq(operationsTable.vehicleId, vehiclesTable.id))
      .leftJoin(profilesTable, eq(operationsTable.assignedGuideUserId, profilesTable.clerkUserId))
      .where(eq(operationsTable.startDate, date));

    const operations: DailyOperationInput[] = rows.map(r => ({
      id: r.id,
      status: r.status,
      startDate: r.startDate,
      endDate: r.endDate,
      pickupTime: r.pickupTime,
      notes: r.notes,
      tourName: r.tourName,
      programName: r.programName,
      programCode: r.programCode,
      shipName: r.shipName ?? null,
      cruiseLine: r.cruiseLine ?? null,
      portName: r.portName ?? null,
      arrivalTime: r.arrivalTime ?? null,
      departureTime: r.departureTime ?? null,
      // Same precedence OperationDomainWorkspace.tsx (Phase 1C) already
      // renders: the operation's own text field first, then the linked
      // master-data resource - kept in sync deliberately, not duplicated
      // business logic diverging by accident.
      guideName: r.opGuideName ?? r.guideResourceName ?? r.assignedGuideName ?? null,
      guidePhone: r.opGuidePhone ?? r.guideResourcePhone ?? null,
      driverName: r.opDriverName ?? r.driverResourceName ?? null,
      driverPhone: r.opDriverPhone ?? r.driverResourcePhone ?? null,
      vehiclePlate: r.opVehiclePlate ?? r.vehiclePlate ?? null,
      vehicleType: r.vehicleType ?? null,
      vehicleCapacity: r.vehicleCapacity ?? null,
    }));

    const operationIds = operations.map(o => o.id);
    const reservationsByOperationId = new Map<number, DailyReservationInput[]>();
    if (operationIds.length > 0) {
      const reservationRows = await db.select({
        reservation: reservationsTable,
        bookingParty: bookingPartiesTable,
      }).from(reservationsTable)
        .leftJoin(bookingPartiesTable, eq(bookingPartiesTable.reservationId, reservationsTable.id))
        .where(inArray(reservationsTable.tourOperationId, operationIds))
        .orderBy(reservationsTable.id);

      for (const { reservation, bookingParty } of reservationRows) {
        const bucket = reservationsByOperationId.get(reservation.tourOperationId) ?? [];
        bucket.push({
          id: reservation.id,
          leadGuestName: reservation.leadGuestName,
          status: reservation.status,
          sourceType: reservation.sourceType,
          sourceBookingReference: reservation.sourceBookingReference,
          reservationType: reservation.reservationType,
          bookingParty: bookingParty ? {
            adultCount: bookingParty.adultCount,
            childCount: bookingParty.childCount,
            passengerLanguage: bookingParty.passengerLanguage,
            pickupPoint: bookingParty.pickupPoint,
            externalSource: bookingParty.externalSource,
            externalOperator: bookingParty.externalOperator,
            specialRequirements: bookingParty.specialRequirements,
          } : null,
        });
        reservationsByOperationId.set(reservation.tourOperationId, bucket);
      }
    }

    // Legacy (Phase 1C convention): only ever a READ, only for Operations
    // that came back with zero Reservation-domain rows, batched in one query
    // - never one lookup per Operation, never written to.
    const zeroReservationIds = operationIds.filter(id => !reservationsByOperationId.has(id));
    const legacyOperationIds = new Set<number>();
    if (zeroReservationIds.length > 0) {
      const legacyRows = await db.select({ operationId: operationReservationDetailsTable.operationId })
        .from(operationReservationDetailsTable)
        .where(inArray(operationReservationDetailsTable.operationId, zeroReservationIds));
      for (const row of legacyRows) legacyOperationIds.add(row.operationId);
    }

    res.json(buildDailyBoard({ date, operations, reservationsByOperationId, legacyOperationIds }));
  } catch {
    res.status(500).json({ error: "Günlük operasyon verisi yüklenemedi" });
  }
};
