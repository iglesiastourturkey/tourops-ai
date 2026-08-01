---
name: Customer schema is single name field
description: Customer type has .name not .firstName/.lastName
---

**Rule:** The `Customer` TypeScript type (from OpenAPI codegen) has a single `name: string` field, NOT `firstName` + `lastName`. Always use `customer.name` when displaying customer names.

**Why:** Discovered via TypeScript error when building operation PDF and detail page. The Customer schema in openapi.yaml uses a single `name` field.
