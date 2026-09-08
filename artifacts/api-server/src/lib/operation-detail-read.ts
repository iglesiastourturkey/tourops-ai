import { db } from "@workspace/db";
import { operationsTable, reservationsTable, bookingPartiesTable, guestsTable, operationReservationDetailsTable, toursTable, tourProductsTable, portCallsTable, shipsTable, portsTable, resourcesTable, vehiclesTable, profilesTable, customersTable, auditLogsTable } from "@workspace/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { composeReservations, partyPax } from "./operation-detail-model";

/** Mounted only after the surface's existing permission middleware. SELECT only. */
export const operationDetailRead: RequestHandler = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Geçersiz ID" }); return; }
    const [operation] = await db.select().from(operationsTable).where(eq(operationsTable.id, id));
    if (!operation) { res.status(404).json({ error: "Operasyon bulunamadı" }); return; }
    if (res.locals.profile.role === "guide" && operation.assignedGuideUserId !== getAuth(req).userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const driver = alias(resourcesTable, "detail_driver");
    const [context] = await db.select({
      tourName: toursTable.name, programName: tourProductsTable.name, programCode: tourProductsTable.code,
      shipName: shipsTable.name, cruiseLine: shipsTable.cruiseLine, portName: portsTable.name,
      arrivalDate: portCallsTable.arrivalDate, arrivalTime: portCallsTable.arrivalTime,
      departureDate: portCallsTable.departureDate, departureTime: portCallsTable.departureTime,
      tourShipName: toursTable.shipName, tourPortName: toursTable.portName,
      tourArrivalTime: toursTable.shipArrivalTime, tourDepartureTime: toursTable.shipDepartureTime,
      guideResourceName: resourcesTable.name, guideResourcePhone: resourcesTable.phone,
      guideCompany: resourcesTable.company, assignedGuideName: profilesTable.name,
      // Phase 2C: surfaced so the frontend can tell CANONICAL / LEGACY_ONLY /
      // UNASSIGNED apart (see classifyAssignmentState in
      // lib/operation-assignment.ts) without a second request — additive,
      // nothing above this line changes shape or meaning.
      guideResourceActive: resourcesTable.active,
      driverResourceName: driver.name, driverResourcePhone: driver.phone, driverCompany: driver.company,
      driverResourceActive: driver.active,
      vehiclePlate: vehiclesTable.plate, vehicleType: vehiclesTable.type, vehicleCapacity: vehiclesTable.capacity, vehicleCompany: vehiclesTable.company,
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
      .where(eq(operationsTable.id, id));
    const rows = await db.select({ reservation: reservationsTable, bookingParty: bookingPartiesTable,
      customer: { id: customersTable.id, name: customersTable.name },
    }).from(reservationsTable)
      .leftJoin(bookingPartiesTable, eq(bookingPartiesTable.reservationId, reservationsTable.id))
      .leftJoin(customersTable, eq(reservationsTable.customerId, customersTable.id))
      .where(eq(reservationsTable.tourOperationId, id)).orderBy(reservationsTable.id);
    const partyIds = rows.flatMap(row => row.bookingParty ? [row.bookingParty.id] : []);
    const guests = partyIds.length ? await db.select().from(guestsTable)
      .where(inArray(guestsTable.bookingPartyId, partyIds)).orderBy(guestsTable.id) : [];
    const hierarchy = composeReservations(rows.map(row => ({ ...row, reservation: { ...row.reservation, customer: row.customer } })), guests);
    const [legacy] = rows.length === 0 ? await db.select().from(operationReservationDetailsTable)
      .where(eq(operationReservationDetailsTable.operationId, id)) : [];
    const activity = await db.select({ id: auditLogsTable.id, eventType: auditLogsTable.eventType,
      actorName: sql<string | null>`${auditLogsTable.metadata}->>'actorName'`,
      createdAt: auditLogsTable.createdAt,
    }).from(auditLogsTable).where(and(
      eq(sql`${auditLogsTable.metadata}->>'entityType'`, "operation"),
      eq(sql`${auditLogsTable.metadata}->>'entityId'`, String(id)),
    )).orderBy(desc(auditLogsTable.createdAt), desc(auditLogsTable.id)).limit(100);
    res.json({ operation, context, ...hierarchy,
      legacy: legacy ? { ...legacy, readOnly: true, totalPax: partyPax(legacy) } : null,
      history: { activity, limit: 100, reservationHistoryAvailable: false },
    });
  } catch { res.status(500).json({ error: "Operasyon detayı yüklenemedi" }); }
};
