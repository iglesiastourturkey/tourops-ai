# TourPilot Definition of Done

A task is not complete because code was written. It is complete when the relevant engineering and operational risks have been addressed.

## Required for normal feature work

- The implementation matches the requested behavior.
- Existing implementation and project patterns were inspected first.
- The change is the smallest coherent solution; unrelated refactors are excluded.
- TypeScript checks pass for affected applications.
- Production builds pass for affected applications.
- Focused tests cover critical behavior and regressions where practical.
- Loading, success, error, and duplicate-submit states are handled for mutations.
- No temporary debug code, secrets, dead code, or unexplained broad type bypass remains.
- User-facing behavior remains usable on supported responsive/mobile layouts.
- The final diff is reviewed for accidental or unrelated changes.

## Required when applicable

### Business rules
- Domain invariants are explicit and deterministic.
- Uncertain data is not silently guessed.
- Duplicate processing and retry behavior are safe.

### API and backend
- Inputs are validated.
- Protected actions use server-side authorization.
- Error behavior is explicit and observable.
- Multi-step integrity-sensitive mutations use transactions where appropriate.

### Database
- Migration is additive or otherwise has an explicit safety rationale.
- Existing-data compatibility has been considered.
- Idempotency/re-run behavior is verified where relevant.
- Destructive production changes require explicit approval and a recovery plan.

### Integrations
- Timeouts, retries, duplicate delivery, and partial failure are considered.
- External IDs and idempotency boundaries are preserved.
- Secrets and provider payloads are handled safely.

### Security
- RBAC/ownership checks are verified.
- Sensitive values are not exposed in client code, logs, commits, or error messages.
- Security-sensitive configuration fails safely.

### Operations and observability
- Important failures can be diagnosed from logs/audit state without guessing.
- High-impact mutations are auditable when appropriate.
- Health or readiness behavior is updated when infrastructure dependencies change.

### PWA/mobile
- No horizontal overflow is introduced.
- Dialogs/forms remain usable on small screens.
- Touch targets and critical flows remain usable.
- Service worker/offline behavior is not accidentally broken.

## Completion classification

Report **READY** only when all relevant checks pass and no known blocker remains.

Report **BLOCKED** when a required check cannot be completed, a material risk remains unresolved, or production safety cannot be established.

If a non-blocking risk remains, report it explicitly rather than hiding it.