import { pgTable, serial, integer, text, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { operationsTable } from "./operations";

/**
 * Faz 5: structured, per-booking reservation snapshot - one row per operation.
  * Introduced so imported reservation data (Sheet Import today; Gmail/Outlook
   * intake is a candidate for a later, separately-approved phase) lands in
    * queryable fields instead of being flattened into operations.notes.
     *
      * Only genuinely per-booking data lives here (passenger counts/ages, service
       * inclusions, external channel, imported financial metadata). Anything that
        * is really relational master data (tour product, port call, guide/driver/
         * vehicle) is a nullable FK column on `operations` itself, not here - see
          * PLAN_Sheet_Import_Mapping_Refactor.md for the full field-by-field mapping
           * matrix and rationale. 1:1 with operations, cascade-deletes with it (same
            * convention as operation_field_notes / operation_locations).
             */
export const operationReservationDetailsTable = pgTable("operation_reservation_details", {
    id: serial("id").primaryKey(),
    operationId: integer("operation_id").notNull().unique()
      .references(() => operationsTable.id, { onDelete: "cascade" }),
  
    // Passengers
    adultCount: integer("adult_count"),
    childCount: integer("child_count"),
    passengerAges: jsonb("passenger_ages").$type<number[]>(),
    passengerLanguage: text("passenger_language"),
  
    // Tour (raw values preserved when no tour_products/alias match is found)
    tourType: text("tour_type"),
    tourCodeRaw: text("tour_code_raw"),
    itineraryRaw: text("itinerary_raw"),
  
    // Cruise / port (raw schedule text preserved when no port_calls match)
    shipScheduleRaw: text("ship_schedule_raw"),
  
    // Service details
    pickupPoint: text("pickup_point"),
    mealIncluded: text("meal_included"), // 'included' | 'excluded' | 'unspecified'
    entranceIncluded: text("entrance_included"), // 'included' | 'excluded' | 'unspecified'
    specialRequirements: text("special_requirements"),
  
    // Reservation source
    externalSource: text("external_source"), // e.g. Viator, Kpt, Klook
    externalOperator: text("external_operator"), // e.g. PARTNER, VIATOR
  
    // Financial — imported metadata only. Never auto-posted to
    // accounting_transactions; shown as pending/import metadata in the UI.
    netAmount: real("net_amount"),
    advanceAmount: real("advance_amount"),
    currency: text("currency"),
    collectionStatusRaw: text("collection_status_raw"),
  
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOperationReservationDetailsSchema = createInsertSchema(operationReservationDetailsTable)
    .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperationReservationDetails = z.infer<typeof insertOperationReservationDetailsSchema>;
export type OperationReservationDetails = typeof operationReservationDetailsTable.$inferSelect;
