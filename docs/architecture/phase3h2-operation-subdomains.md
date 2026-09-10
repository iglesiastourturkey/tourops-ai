# Phase 3H.2 operation subdomains

This design keeps one canonical `operations.id`. GEMI and SEJOUR are distinct
read/workflow subdomains over that identity; they are not duplicated records.

## Shared operation core

Identity and source lineage, reservation/customer relationships, service date
range, status, PAX (through Reservation/BookingParty), guide, driver, vehicle,
pickup, notes, audit history and timestamps are shared.

## GEMI

Existing canonical support: `port_calls`, `ships`, `ports`, cruise line,
arrival/departure dates and times, tour/product, pickup, assignments, PAX,
reservations and notes. Historical `sourceKind=gemi` maps only to `CRUISE`.

## SEJOUR

Existing historical support is limited to date/date range, tour section or raw
itinerary, pickup point/time, agency/operator, language, PAX, guest name,
collection state and notes. The current source does not provide reliable,
structured flight, airport, hotel/check-in/check-out, city/route or daily-service
columns. Tour records have destination, transfer-required and hotel-category
fields, but these are product-level fields and must not be projected onto a
historical Sejour operation without authoritative linkage.

## Schema gaps and recommendation

Do not add speculative flight/hotel columns to `operations`. When an
authoritative Sejour source is approved, add an `operation_services` child model
with: stable service identity, `operation_id`, ordered day/time span, constrained
service kind (flight, transfer, accommodation, tour, other), status, supplier,
pickup/drop-off/location references, and a provenance payload. Specialized
flight/accommodation attributes should live in constrained subtype payloads or
tables. This supports one Sejour parent with many ordered services without
forcing Cruise into that shape or assuming one reservation equals one service.

Until then, Sejour displays only currently supported shared/raw itinerary data.
Missing flight/hotel/service fields are not deficiencies.

## Navigation and compatibility

- `/operations/gemi` and `/operations/gemi/:id`: Gemi list/detail.
- `/operations/sejour` and `/operations/sejour/:id`: Sejour list/detail.
- `/operations` and `/operations/:id`: existing planning/deep links remain.
- Calendar and Operations Center aggregate both and choose a typed detail link.
- Rows with `operation_type IS NULL` remain available through legacy/planning
  routes and are never silently classified.

---

## Domain model analysis (owner report A–M)

Evidence base: `lib/db/src/schema/*` (operations, reservations/booking_parties,
port_calls, ships, ports, tours, operation_reservation_details,
historical_operation_imports) and the 2026 legacy GEMI/SEJOUR workbook
inspection behind `historical:contact-source-audit`.

### A. Shared operation core (one implementation, both subdomains)

`operations.id` identity; `sourceType` / `sourceQuoteId` / `sourceEmailImportId`
/ `sourceSheetImportId` / `sourceHistoricalKey` / `sourceBookingReference`
lineage; `reservations` (many, via `tour_operation_id`) → `booking_parties`
(1:1) → optional `guests`; `customerId`; `startDate` / `endDate`; `status` +
`operation_status_history`; PAX = `booking_parties.adultCount + childCount`
(never fabricated); `guideName/guidePhone` + `guideResourceId`,
`driverName/driverPhone` + `driverResourceId`, `vehiclePlate` + `vehicleId`;
`pickupTime` + `booking_parties.pickupPoint`; `notes` + `operation_field_notes`;
`operation_activity` / audit; `operation_documents`, `operation_receipts`,
`operation_tasks`, `field_incidents`, `operation_locations`. All of this is
rendered by the single shared `OperationDomainWorkspace` component and the
shared `/:id/detail` read model — no per-subdomain fork.

### B. GEMI-only fields / entities (exist today)

`operations.portCallId` → `port_calls` (`arrivalDate/arrivalTime`,
`departureDate/departureTime`, `status`, `notes`) → `ships` (`name`,
`cruiseLine`) and `ports` (`name`, `code`, `city`, `country`, `timezone`).
Product-level cruise fields on `tours` (`isCruiseExcursion`, `shipName`,
`portName`, `shipArrivalTime`, `shipDepartureTime`,
`cruiseSafetyBufferMinutes`). Raw fallback: `booking_parties.shipScheduleRaw`.
Cruise fields are suppressed in the detail workspace when
`operationType === 'SEJOUR'`.

### C. SEJOUR-only fields / entities (exist today)

None that are Sejour-*exclusive*. What a historical Sejour row actually carries:
service date / date range, `booking_parties.itineraryRaw` (or `tourType` /
`tourCodeRaw`), `pickupPoint` / `operations.pickupTime`,
`externalOperator` / `externalSource` (agency/operator), `passengerLanguage`,
PAX, guest name, `collectionStatusRaw`, `notes`. There is **no** structured
flight, airport, hotel, check-in/out, city/route or per-day service entity for
Sejour today.

### D. Shared assignments / resources

`resources` (GUIDE / DRIVER) via `guideResourceId` / `driverResourceId`;
`vehicles` via `vehicleId`; free-text `guideName/Phone`, `driverName/Phone`,
`vehiclePlate` remain the primary values with the FKs as confident-match
enrichment (Phase 2C). Identical for both subdomains — reused, not duplicated.

### E. Existing source support for flights — **none**

No flight/airport columns in any schema; the legacy workbooks have no reliable
structured flight column. Not fabricated for historical rows.

### F. Existing source support for hotels / accommodation — **none authoritative**

`tours.hotelCategory` and `tours.transferRequired` exist but are *product*
attributes, not operation facts, and are not linked to a historical Sejour
operation. `operation_documents.documentType` allows a `hotel_confirmation` /
`flight_ticket` attachment, but that is a file, not structured data.

### G. Existing source support for transfers — **partial / implicit only**

`tours.transferRequired` (boolean, product level) and free-text pickup fields.
No transfer entity (no route, vehicle, time-window, direction).

### H. Existing source support for multi-day itinerary — **raw text only**

`booking_parties.itineraryRaw` free text and `tour_days` on the *product*. No
per-operation ordered day/service rows.

### I. Existing source support for cities / routes — **product level only**

`tours.mainDestination` / `tours.destinations` (JSON string) and `ports.city`.
Nothing on the operation itself.

### J. Schema gaps

1. No `operation_services` child model → cannot represent a Sejour parent with
   ordered flight/transfer/hotel/tour legs.
2. No structured flight or accommodation entity.
3. No transfer entity (direction, window, route, resource).
4. `operations.operation_type` is nullable with no historical backfill yet
   (migration 0027 is intentionally additive-only; see below).
5. Cruise line only lives on `ships.cruiseLine`; there is no `cruise_lines`
   master table (acceptable for now).

### K. Recommended Sejour parent / child service model (build only when an authoritative Sejour source is approved)

`operation_services`: `id`, `operationId` (FK, cascade), `dayIndex` /
`startAt` / `endAt` (ordered), `serviceKind` CHECK IN
(`flight`,`transfer`,`accommodation`,`tour`,`other`), `status`, `supplierId`
(FK nullable), `pickupLocation` / `dropoffLocation` / `locationRef`,
`guideResourceId` / `driverResourceId` / `vehicleId` (nullable, reuse the
shared assignment FKs), `provenance` jsonb. Kind-specific attributes
(flight number, PNR, check-in/out dates, room block) go in constrained
subtype tables or a validated jsonb payload — **not** as wide nullable
columns on `operations`. Cruise is unaffected: a GEMI operation keeps using
`port_calls` and does not gain child services. One reservation ≠ one service:
a Sejour reservation fans out to many `operation_services` rows.

Do not build this in 3H.2. Ship the nullable `operation_type` + separate
read models now; add the child model in its own phase with real data.

### L. Navigation / routes

Nav group **Operasyon** now lists: Gemi Operasyonları (`/operations/gemi`),
Sejour Operasyonları (`/operations/sejour`), Operasyon Planlama
(`/operations`), Takvim (`/calendar`), Operasyon Merkezi (`/field`). New
routes: `/operations/gemi`, `/operations/gemi/:id`, `/operations/sejour`,
`/operations/sejour/:id` (typed detail routes render the shared
`OperationDetailPage`). New read endpoint:
`GET /api/operations/domain/:operationType` (`operations:view`), a
subdomain-specific list projection.

### M. Backward-compatibility strategy

`/operations` and `/operations/:id` are untouched and still resolve every
operation, typed or not. `DailyOperationsBoard` link resolution falls back to
`/operations/:id` whenever `operationType` is null. Migration 0027 is
`ADD COLUMN IF NOT EXISTS` + a `NULL OR IN ('CRUISE','SEJOUR')` CHECK — additive,
re-runnable, existing rows stay NULL. Promotion
(`historical-migration-promote.ts`) sets `operationType` only on **new**
inserts and fails closed (`PromotionRollback`) on an unclassifiable
`sourceKind`. The generated API types add `operationType` as optional +
nullable, so existing API consumers are unaffected.

---

## Historical correction — sections 9 & 12 (rehearsal only; production NOT authorized)

Already-promoted historical operations currently have `operation_type IS NULL`,
so the Gemi/Sejour lists are empty for historical data until a one-time backfill
runs. That backfill is a **production mutation and is NOT authorized in Phase
3H.2**. This phase delivers the rehearsal and the exact plan only.

### Rehearsal tool (read-only)

`pnpm --filter @workspace/api-server historical:operation-domain-backfill-plan`

- Runs only against the dedicated historical **staging** Neon target
  (`HISTORICAL_STAGING_DATABASE_URL` + `HISTORICAL_STAGING_DATABASE_HOST`
  allowlist, `.neon.tech` enforced, `NODE_ENV=production` refused).
- Rejects every `--apply` / `--execute` / `--confirm` / `--write` / `--run` flag.
- Emits `databaseWrites: false` JSON: `projected.CRUISE`, `projected.SEJOUR`,
  `wouldUpdate`, `alreadyClassifiedMatching`, `conflicts[]` (a promoted
  operation already typed the *other* way — expected empty),
  `unclassifiableSourceKinds[]` (expected empty — `source_kind` has a
  `IN ('gemi','sejour')` CHECK), `orphanHistoricalOperations` (rows with a
  `source_historical_key` but no `status='imported'` backlink).
- Pure classifier `classifyBackfillRows` is covered by
  `test:historical-operation-domain-backfill-plan`.

### Expected rehearsal result

```
projected.CRUISE  = 2938
projected.SEJOUR  = 581
wouldUpdate       = 3519   (all currently NULL)
conflicts         = []
unclassifiableSourceKinds = []
orphanHistoricalOperations = 0
```

Any deviation (a non-zero conflict/unclassifiable list, or a total ≠ 3519)
blocks the production step and is reported back to the owner.

### Exact production correction plan (requires separate owner GO)

Join key: `historical_operation_imports.imported_operation_id = operations.id`,
restricted to `status = 'imported'`. Mapping: `gemi → CRUISE`, `sejour → SEJOUR`
(the same `operationTypeFromHistoricalSourceKind` used at promotion time).

1. Owner reviews the staging rehearsal JSON and confirms 2938 / 581 / 0.
2. Take a Neon production branch/snapshot immediately before (recovery point).
3. In a single transaction against production:

```sql
BEGIN;

-- guard: nothing should already be classified differently
SELECT o.id, o.operation_type, h.source_kind
FROM operations o
JOIN historical_operation_imports h ON h.imported_operation_id = o.id
WHERE h.status = 'imported'
  AND o.operation_type IS NOT NULL
  AND o.operation_type <> CASE h.source_kind
        WHEN 'gemi' THEN 'CRUISE' WHEN 'sejour' THEN 'SEJOUR' END;
-- expect 0 rows; abort if any

UPDATE operations o
SET operation_type = CASE h.source_kind
      WHEN 'gemi'   THEN 'CRUISE'
      WHEN 'sejour' THEN 'SEJOUR'
    END,
    version = o.version + 1,
    updated_at = now()
FROM historical_operation_imports h
WHERE h.imported_operation_id = o.id
  AND h.status = 'imported'
  AND h.source_kind IN ('gemi', 'sejour')
  AND o.operation_type IS NULL;
-- expect UPDATE 3519

-- verify split
SELECT operation_type, count(*) FROM operations
WHERE operation_type IS NOT NULL GROUP BY operation_type;
-- expect CRUISE 2938, SEJOUR 581

COMMIT;   -- (ROLLBACK if any expectation fails)
```

4. Post-check: `SELECT count(*) FROM operations o
   JOIN historical_operation_imports h ON h.imported_operation_id = o.id
   WHERE h.status='imported' AND o.operation_type IS NULL;` must be 0.
5. Smoke test `/operations/gemi` and `/operations/sejour` in production.

Idempotent: the `operation_type IS NULL` predicate means a re-run is a no-op.
No new promotion path is needed — `historical-migration-promote.ts` already
sets `operation_type` on every future insert.
