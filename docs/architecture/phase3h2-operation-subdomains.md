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
