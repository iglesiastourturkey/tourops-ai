# TourPilot

**Travel agency operations platform for reservations, planning, field operations, personnel, cruise workflows, accounting and future AI-assisted execution.**

> **Current target:** September 2026 pilot release
>  
> **Status:** Active development — core reservation and operation foundations are working; scope is being stabilized for real field and operations testing.

---

## 1. Product Goal

TourPilot is being built as the operational system of record for a travel agency. The goal is to replace fragmented spreadsheets, messaging, manual reservation tracking and disconnected operational workflows with one role-aware platform.

The intended end-to-end lifecycle is:

```text
Inquiry / Reservation
        ↓
Reservation Intake
        ↓
Operational Planning
        ↓
Guide / Driver / Vehicle Assignment
        ↓
Field Execution
        ↓
Operation Completion
        ↓
Accounting / Reporting / Audit
```

The September 2026 objective is **not** to finish every possible feature. The objective is to reach a reliable pilot where the real operations team can use TourPilot for live reservations and daily operations without falling back to disconnected manual processes for the core flow.

---

## 2. Engineering Principles

TourPilot follows a Kaizen + Clean Code approach. Reliability and maintainability take priority over short-term feature volume.

Non-negotiable rules:

- Server-side RBAC for protected actions.
- Destructive database migrations are prohibited unless explicitly reviewed and approved.
- Imports and write operations must be idempotent where replay is possible.
- Duplicate prevention is a first-class requirement.
- Staging and production must remain clearly separated.
- High-risk actions require human-in-the-loop approval.
- Important mutations must be observable and auditable.
- Historical data must not be silently changed or discarded.
- Business rules belong in controlled application services, not in UI-only logic.
- AI must never bypass TourPilot permissions, validation, audit or domain rules.

---

## 3. Current Platform Areas

The platform is organized around the following operational areas:

- Dashboard / Control Panel
- Tasks
- New Requests
- Customers
- Communications
- Observation Review
- Sheet Import
- Suppliers
- Tours
- Quotations
- Operation Planning
- Calendar
- Incoming Reservations
- Operations Center
- Notifications
- Settings
- Accounting
- Accounting Settings
- User Management
- Role Management
- System Control
- Audit Logs

The exact menu and module boundaries can continue to evolve, but the September pilot scope is governed by the core operation lifecycle rather than by the number of visible modules.

---

## 4. Completed / Verified Foundations

### Reservation processing core

The main reservation intake flow has been implemented through the early milestones and manually verified through the draft-to-confirmation path.

Core direction:

```text
Incoming reservation
    → parse / normalize
    → create draft
    → human review when required
    → confirm
    → Incoming Reservations / operational flow
```

The architecture is designed around safe replay, duplicate prevention and controlled confirmation rather than direct uncontrolled writes.

### Historical / sheet import work

Historical data remediation and import work has progressed through multiple dedicated branches and migration phases.

Important principles already established:

- normalize before importing;
- preserve ambiguous cases for review instead of guessing;
- prevent repeated imports from creating duplicate records;
- retain exceptional historical cases as review-required when confidence is insufficient;
- use staging before production execution.

Historical data cleanup work has included operator normalization, guide ambiguity reduction, cancellation / rebooking handling, secondary-cell mapping and review-required classification.

### Cruise master-data foundation

Cruise-related master-data work has been separated into dedicated phases and branches so cruise resources, observations and operational usage can evolve without contaminating reservation logic.

Cruise master-data work includes known ship resources such as:

- CELESTYAL JOURNEY
- AZAMARA ONWARD
- CELEBRITY ASCENT
- MSC FANTASIA
- NORWEGIAN VIVA
- OOSTERDAM
- QUEEN VICTORIA
- SEABOURN QUEST
- SILVER NOVA

### Personnel / guide / driver direction

Personnel identity, management UI and staging import work have dedicated implementation branches. Guide and driver data are being treated as reusable operational master data rather than free-text fields.

The long-term objective is to make guide, driver and personnel identity consistent across:

- reservation imports;
- operation assignments;
- mobile / field views;
- performance records;
- future recommendation models.

### Operation-detail domain

Operation detail is being refactored toward a canonical reservation / operation domain rather than duplicating business logic independently across admin, guide and field views.

The intended rule is:

> one operational truth, multiple role-specific views.

Admin, guide and field users may see different information and controls, but they should not maintain competing copies of the same operation state.

---

## 5. Current Development Direction

The active workstream is focused on closing the complete real-world operation loop.

Priority order for the September pilot:

1. Reservation correctness and duplicate safety.
2. Canonical operation-detail domain.
3. Guide / driver / personnel assignment correctness.
4. Field and guide role views.
5. Calendar and operations-center reliability.
6. Historical / spreadsheet import safety.
7. RBAC, audit and mutation safety.
8. Pilot-readiness testing with real operational scenarios.

Nice-to-have features must not displace these priorities before the pilot.

---

## 6. September 2026 Scope Rule

From this point until the pilot, new ideas are classified into four buckets:

| Classification | Meaning |
|---|---|
| **NOW / SEPTEMBER** | Required for the real pilot or required to prevent operational failure |
| **FOUNDATION** | Small architectural work needed now to avoid expensive rework later |
| **POST-LAUNCH** | Valuable, but not necessary for the September pilot |
| **BACKLOG** | Future improvement / experiment / convenience feature |

A new idea enters the September scope only if at least one of the following is true:

1. Without it, a real operation cannot be completed safely.
2. Its absence creates material data-loss, security or operational-risk exposure.
3. Deferring it would force a major architectural rewrite later.

Otherwise it goes to POST-LAUNCH or BACKLOG.

This rule exists to prevent continuous phase redesign and scope creep.

---

## 7. AI Strategy — Phase 0: AI-Ready Foundation

TourPilot will eventually support a controlled **AI Operations Agent**, not only a passive observer.

The long-term positioning is:

```text
ML models        → prediction / scoring
LLM              → reasoning / explanation
AI Agent         → controlled actions
TourPilot        → permissions, rules, validation, audit and source of truth
```

The AI must never receive unrestricted database access or raw SQL execution capability.

### AI action levels

```text
L0 — Observe
L1 — Recommend
L2 — Act with approval
L3 — Autonomous low-risk action
```

Examples:

- detect missing guide → Observe / Recommend
- recommend guide → Recommend
- assign guide → Approval required initially
- create low-risk internal task → potentially Autonomous
- change financial record → Human-controlled
- delete reservation → Human-controlled / restricted

### AI Action Registry

Future AI actions must go through explicit application actions such as:

```text
reservation.createDraft
reservation.flagDuplicate
operation.createTask
operation.flagRisk
guide.recommend
guide.assign
driver.recommend
driver.assign
notification.send
```

Each action should define:

- required permission;
- risk level;
- approval requirement;
- idempotency behavior;
- audit requirement;
- allowed input schema.

### Event / training data foundation

The platform should increasingly record reliable operational events such as:

```text
reservation.created
reservation.updated
guide.assigned
guide.reassigned
driver.assigned
operation.started
operation.completed
operation.delayed
reservation.cancelled
customer.complaint
```

Where useful, event data should include:

- actor;
- timestamp;
- source;
- previous value;
- new value;
- reason;
- operation / reservation reference.

These records will later support model training and decision analysis.

### Training signals to preserve

Future ML models may need signals such as:

- guide assignment success;
- operation delay minutes;
- customer complaint;
- guide / driver no-show;
- pickup delay;
- tour duration;
- passenger count;
- cruise ship;
- tour type;
- language;
- assignment changes;
- human override reason.

The immediate goal is **to preserve good data**, not to train a custom model during the September pilot work.

### Explicitly out of AI Phase 0

The following are POST-LAUNCH unless they become technically necessary:

- custom model training;
- GPU infrastructure;
- dedicated Python ML serving stack;
- fine-tuning;
- autonomous high-risk agents;
- large vector/RAG infrastructure;
- complex AI dashboards.

The September rule is:

> **AI foundation now; custom ML and autonomous agent behavior after the core operational platform is stable.**

---

## 8. Future AI Models

Once enough clean real-world data exists, TourPilot can add focused tabular models instead of trying to solve every problem with one large model.

Potential models:

- Guide Match Score
- Driver / Vehicle Recommendation
- No-show Risk
- Cancellation Probability
- Operational Risk Score
- Pickup-time Prediction
- Tour-duration Prediction
- Reservation Anomaly Detection

Initial candidates can be models such as LightGBM / XGBoost where the underlying data is structured operational data.

Example future flow:

```text
Operation
   ↓
Guide Match Model
   ↓
Candidate scores
   ↓
AI Operations Agent
   ↓
TourPilot Action API
   ↓
RBAC + validation + approval + audit
```

---

## 9. Deployment / Environments

TourPilot uses separate deployment environments and staging must remain the proving ground for migrations, imports and risky operational changes.

Current staging deployment:

```text
https://tourops-ai-staging.onrender.com
```

Database migrations and bulk historical operations must be proven in staging before production execution.

---

## 10. Technology Direction

Current architecture is centered on:

- React + TypeScript frontend
- Vite
- Node.js / Express API
- PostgreSQL
- Drizzle ORM
- Clerk authentication
- Role-based authorization
- OpenAPI-driven API contracts
- structured logging
- controlled AI integrations
- pnpm monorepo workflow

The technical stack can evolve, but the domain and safety rules above are more important than any individual framework.

---

## 11. Repository / Branch Strategy

Major changes are developed through focused branches rather than mixing unrelated work into a single long-running branch.

Examples of existing workstreams include:

- cruise master data;
- historical migration / remediation;
- canonical operation assignments;
- personnel identity and management;
- operation-detail reservation domain;
- AI-efficiency orchestration;
- engineering quality / Kaizen gates.

Before merging a phase:

1. validate the business rule;
2. verify migrations are non-destructive;
3. test replay / idempotency where relevant;
4. verify role isolation;
5. run staging acceptance;
6. document unresolved review-required cases;
7. only then promote toward production.

---

## 12. Pilot Definition of Done

The September pilot is ready when the team can complete real operational scenarios end to end with acceptable reliability.

Minimum definition of done:

- reservation can be created/imported safely;
- duplicates are controlled;
- reservation becomes an operation correctly;
- guide / driver / personnel can be assigned from canonical data;
- operation details are consistent across relevant roles;
- field / guide users see the correct scoped operation data;
- calendar and operations center show reliable operational state;
- critical changes are protected by permissions and auditability;
- historical import does not corrupt current operations;
- staging proves migrations and bulk changes before production;
- failures are visible and recoverable rather than silent.

Features outside this list do not automatically block the September pilot.

---

## 13. Next Planning Checkpoint

The next planning checkpoint will combine this README with the current implementation reports and test results to produce a locked **TourPilot Master Plan v1**.

The Master Plan will define:

- remaining September phases;
- exact acceptance criteria for each phase;
- dependency order;
- what is frozen until after pilot;
- migration / staging checkpoints;
- pilot test scenarios;
- AI Phase 0 tasks that are safe to include without delaying core delivery.

After that checkpoint, new ideas should be classified rather than causing the main phase plan to be recreated.

---

## 14. Core Principle

> **Ship a reliable operational core first. Preserve the data and architecture needed for intelligence. Add autonomy only after TourPilot can safely control it.**
