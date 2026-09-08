# TourPilot Engineering Constitution

This document defines the default engineering culture for TourPilot.

The goal is not merely to make features work today. The goal is to keep TourPilot safe, understandable, operable, and evolvable for years.

## 1. Kaizen by Default

Prefer small, evidence-based, reversible improvements over broad rewrites.

For every meaningful change:
1. understand the current behavior;
2. identify the root cause or real requirement;
3. make the smallest coherent improvement;
4. verify behavior;
5. leave the surrounding code slightly better when safe to do so.

Do not refactor unrelated areas just because they can be improved.

## 2. Clean Code with Operational Context

Code should optimize for clarity and safe maintenance.

Prefer:
- explicit names;
- single-purpose modules and functions;
- low coupling and high cohesion;
- clear boundaries between UI, domain logic, persistence, and integrations;
- typed contracts;
- deterministic business rules;
- reusable behavior without premature abstraction.

Avoid:
- hidden side effects;
- duplicated business rules;
- magic values;
- broad `any` casts;
- swallowed errors;
- speculative abstractions;
- parallel implementations of the same capability.

## 3. Root Cause Before Patch

Do not patch symptoms when the underlying cause can be identified.

Before fixing a defect, determine:
- where the incorrect state first appears;
- whether the issue is data, domain logic, integration, authorization, concurrency, rendering, or infrastructure;
- whether more than one writer or source of truth exists;
- which invariant was violated.

A fix should restore the invariant, not merely hide the visible symptom.

## 4. Reliability Is a Feature

Critical flows must be designed for retries, partial failure, and duplicate delivery.

Where applicable use:
- idempotency keys or equivalent duplicate protection;
- unique database constraints;
- transactions;
- timeout and retry policies;
- explicit failure states;
- safe recovery paths;
- double-submit protection;
- audit trails.

Never rely on a frontend-only guard for correctness or authorization.

## 5. Data Integrity First

TourPilot operational data must remain trustworthy.

Never silently:
- invent missing reservation data;
- overwrite confirmed data with lower-confidence data;
- process the same external event twice;
- move data to the wrong operational date;
- bypass validation to make an import pass.

When information is uncertain, preserve uncertainty and route it for review.

## 6. Safe Database Evolution

Database changes must be forward-safe and production-aware.

Prefer:
- additive migrations;
- backfills separated from schema changes when risk is material;
- constraints that encode real invariants;
- staged rollout for high-risk changes;
- explicit rollback or recovery strategy.

Do not automatically run destructive production migrations.

For migrations involving identity, money, reservations, operations, or integrations, verify idempotency and existing-data compatibility.

## 7. Security by Default

Apply least privilege.

Requirements:
- server-side RBAC for protected actions;
- explicit input validation;
- secret isolation;
- no credentials in source control or logs;
- ownership/tenant checks where relevant;
- auditability for sensitive mutations;
- secure defaults when configuration is missing.

Fail closed for authorization and security-sensitive decisions.

## 8. Observability and Auditability

Important failures must be diagnosable without guessing.

Critical workflows should expose appropriate:
- structured logs;
- health checks;
- correlation or trace identifiers when useful;
- audit records for important mutations;
- actionable error messages;
- enough context to distinguish user error, integration error, and system error.

Do not log secrets or unnecessarily sensitive payloads.

## 9. Tests Protect Business Invariants

Tests should prioritize business-critical behavior, not just line coverage.

Where relevant verify:
- happy path;
- invalid input;
- unauthorized access;
- duplicate/retry behavior;
- concurrent or repeated submission;
- integration failure;
- partial failure;
- migration compatibility;
- regression for the reported defect.

A bug fix should normally include a focused regression test when practical.

## 10. Backward Compatibility and Controlled Change

Do not break existing consumers, operational workflows, or data contracts without an explicit migration plan.

For API, schema, workflow, or integration changes:
- identify consumers;
- preserve compatibility when reasonable;
- version or stage breaking changes;
- document behavior changes.

## 11. Performance: Measure Before Optimizing

Do not introduce complexity for theoretical performance gains.

When performance matters:
1. identify the user-visible or operational problem;
2. measure or inspect the bottleneck;
3. optimize the actual constraint;
4. verify correctness after optimization.

## 12. Human-in-the-Loop for Irreversible or High-Impact Actions

AI may extract, summarize, rank, or suggest.

Deterministic code validates and enforces rules.

Humans approve critical actions when mistakes can create operational, financial, customer, or data-integrity impact.

## 13. One Source of Truth

A domain concept should have one authoritative source whenever possible.

Do not create competing state machines, duplicated calculations, or shadow persistence paths unless an explicit migration requires them.

## 14. Definition of Better

A change is better only if it improves one or more of:
- correctness;
- clarity;
- maintainability;
- security;
- reliability;
- observability;
- testability;
- user experience;

without creating disproportionate complexity or hidden operational risk.

## 15. Long-Term Question

Before finalizing a significant implementation, ask:

> Does this only make the feature work today, or does it keep TourPilot understandable, safe, and evolvable three to five years from now?

If the long-term answer is weak, improve the design before declaring the work complete.