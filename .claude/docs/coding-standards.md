# TourPilot Coding Standards

## General

Prefer:
- small safe changes
- existing project patterns
- reuse over duplication
- deterministic business rules
- typed APIs
- explicit validation

Avoid:
- unnecessary refactors
- parallel architecture
- broad any casts
- hidden fallback behavior
- swallowed errors

## TypeScript

Keep strict typing.

Do not bypass library type problems using broad `any` unless no safe alternative exists and it is documented.

## Backend

Server-side authorization is mandatory.

Validate mutations.

Use transactions where multi-step data integrity requires them.

## Frontend

Every mutation needs:
- loading
- success
- error
- double-submit protection

User-facing errors should be Turkish and understandable.

## PWA

No horizontal overflow.

Dialogs must fit mobile screens.

Maintain usable touch targets.

Do not break service worker or offline-sync behavior.

## Tests

Test business-critical failure scenarios, not only happy paths.