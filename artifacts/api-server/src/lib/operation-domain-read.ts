import { db } from "@workspace/db";
import { operationsTable, reservationsTable, bookingPartiesTable, toursTable, portCallsTable, shipsTable, portsTable } from "@workspace/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import type { RequestHandler } from "express";

/** Domain-specific list projection over one canonical Operation identity. */
export const operationDomainListRead: RequestHandler = async (req, res) => {
  const operationType = String(req.params.operationType).toUpperCase();
  if (operationType !== "CRUISE" && operationType !== "SEJOUR") {
    res.status(400).json({ error: "Geçersiz operasyon alanı" }); return;
  }
  try {
    const rows = await db.select({
      id: operationsTable.id, operationType: operationsTable.operationType,
      status: operationsTable.status, startDate: operationsTable.startDate, endDate: operationsTable.endDate,
      pickupTime: operationsTable.pickupTime, notes: operationsTable.notes,
      tourName: toursTable.name, shipName: shipsTable.name, cruiseLine: shipsTable.cruiseLine,
      portName: portsTable.name, arrivalTime: portCallsTable.arrivalTime, departureTime: portCallsTable.departureTime,
      pickupPoints: sql<string | null>`string_agg(distinct ${bookingPartiesTable.pickupPoint}, ' / ')`,
      itinerary: sql<string | null>`string_agg(distinct ${bookingPartiesTable.itineraryRaw}, ' / ')`,
      operators: sql<string | null>`string_agg(distinct ${bookingPartiesTable.externalOperator}, ' / ')`,
      reservationCount: sql<number>`count(distinct ${reservationsTable.id})::int`,
    }).from(operationsTable)
      .leftJoin(toursTable, eq(operationsTable.tourId, toursTable.id))
      .leftJoin(portCallsTable, eq(operationsTable.portCallId, portCallsTable.id))
      .leftJoin(shipsTable, eq(portCallsTable.shipId, shipsTable.id))
      .leftJoin(portsTable, eq(portCallsTable.portId, portsTable.id))
      .leftJoin(reservationsTable, eq(reservationsTable.tourOperationId, operationsTable.id))
      .leftJoin(bookingPartiesTable, eq(bookingPartiesTable.reservationId, reservationsTable.id))
      .where(eq(operationsTable.operationType, operationType))
      .groupBy(operationsTable.id, toursTable.name, shipsTable.name, shipsTable.cruiseLine,
        portsTable.name, portCallsTable.arrivalTime, portCallsTable.departureTime)
      .orderBy(desc(operationsTable.startDate), desc(operationsTable.id));
    res.json({ operationType, rows });
  } catch { res.status(500).json({ error: "Operasyon alanı yüklenemedi" }); }
};
