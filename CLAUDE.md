# TourPilot Claude Code Project Instructions

TourPilot is an AI-assisted tourism operations platform for Iglesias Tour Turkey.

The application is designed as:

- responsive web application
- desktop-friendly
- tablet-friendly
- mobile-responsive
- installable PWA

## Core Architecture

Frontend:
- React
- TypeScript
- Vite
- Vercel production

Backend:
- Node.js
- Express
- TypeScript
- Render production

Database:
- PostgreSQL
- Neon

Authentication:
- Clerk

Source of truth:
- GitHub

Development:
- VS Code
- Claude Code
- Codex
- Cowork for orchestration when multi-tool or multi-workstream coordination is genuinely useful
- Replit may be used only as an AI-assisted prototyping/development tool

## Product Principle

AI extracts.
Code validates and decides.
Humans approve critical actions.

Accuracy is more important than speed.

## Engineering Principle

TourPilot must be engineered as a long-lived operational platform, not as a disposable prototype.

Kaizen + Clean Code + Reliability are mandatory defaults for non-trivial work.

For every meaningful implementation, refactor, bug fix, migration, integration, or architecture task:

- inspect before editing
- identify the real requirement or root cause
- prefer the smallest coherent and reversible change
- preserve working behavior unless change is intentional
- keep business rules deterministic and explicit
- protect data integrity, authorization, idempotency, and auditability
- test critical failure paths, not only happy paths
- avoid creating parallel architecture or a second source of truth
- verify the Definition of Done before reporting completion

Use the `engineering-quality` skill for all non-trivial code and architecture work.

## AI Efficiency Principle

AI-assisted engineering must maximize useful output without sacrificing correctness or safety.

For non-trivial planning, implementation, debugging, review, and multi-agent work:

- use the `ai-efficiency` skill
- use the cheapest sufficiently capable model
- avoid duplicate repository discovery across Claude Code, Codex, Cowork, and subagents
- freeze scope and acceptance criteria before significant implementation
- reuse concise handoffs instead of replaying full context
- create only the minimum number of agents that adds real value
- prefer focused tests and targeted file reads before broad repo-wide work
- do not let reviewers restart architecture without evidence that the frozen plan is wrong
- stop and report rather than silently expanding into DB, auth, security, destructive, or broad cross-file changes

For complex work, the preferred separation is:

reason/root-cause once
→ implement the frozen plan
→ independently verify

Do not make multiple models independently rediscover the same task unless independent investigation is explicitly required for safety or correctness.

## Critical Operational Rules

Never:

- invent missing reservation data
- silently guess uncertain information
- process the same reservation twice
- send duplicate customer messages
- write to the wrong operational date
- overwrite Google Sheets formulas
- change existing Google Sheets layout without approval
- run destructive production migrations automatically
- expose secrets or tokens
- use frontend-only authorization
- test destructive automation against live Iglesias Tour operational data

## Iglesias Tour Pilot

Primary reservation sources:

- Outlook
- Viator
- GetYourGuide

The first major pilot target is:

Outlook
→ Reservation Inbox
→ AI Extraction
→ Human Review
→ Approved Reservation
→ Operation
→ 2027 TEST Google Sheet Preview
→ Approved Google Sheet Sync
→ Kasa preparation

## Required Project References

Read when relevant:

@.claude/docs/architecture.md
@.claude/docs/roadmap.md
@.claude/docs/operations-rules.md
@.claude/docs/integrations.md
@.claude/docs/coding-standards.md
@.claude/docs/engineering-constitution.md
@.claude/docs/definition-of-done.md
@.claude/docs/ai-orchestration.md

## Skills

Use relevant skills rather than loading everything blindly.

Mandatory baseline for non-trivial engineering work:

- engineering-quality
- ai-efficiency

Important TourPilot domain skills:

- plan-tourpilot
- model-router
- tourpilot-workflow
- tour-ops-guardian
- reservation-intelligence
- sheets-guardian
- ops-priority-engine
- integration-safety

## Agents

Use specialized agents when a task benefits from independent work:

- tourpilot-architect
- tourpilot-frontend
- tourpilot-backend
- tourpilot-database
- tourpilot-integrations
- tourpilot-security
- tourpilot-pwa
- tourpilot-tester
- tourpilot-reviewer

Create only the minimum number of subagents that provides useful parallelism.

Do not create agents merely to increase agent count.

Avoid concurrent writes to the same files.

Do not assign overlapping discovery work to multiple agents unless independent verification is required.

## Model Routing

Use the cheapest sufficiently capable model.

Haiku / fast lightweight model:
- trivial UI/copy/search/cleanup

Sonnet / normal implementation model:
- normal implementation
- frontend/backend/API
- CRUD
- standard testing

Opus / strong reasoning model:
- architecture
- difficult debugging
- authentication/security
- migration
- concurrency/idempotency
- cross-system design

Codex is preferred for well-scoped implementation, focused refactors, tests, and mechanical changes from a frozen plan.

Cowork is preferred for genuine orchestration across tools, files, GitHub, or independent workstreams—not as an unnecessary wrapper around a task one coding agent can finish.

Preferred pattern for complex tasks:

strong reasoning for planning/root cause
→ implementation model or Codex
→ focused independent review

## Development Workflow

For significant features:

1. Inspect current git status.
2. Inspect existing implementation with the smallest useful context.
3. Load `engineering-quality`.
4. Load `ai-efficiency`.
5. Use model-router.
6. Use plan-tourpilot.
7. Identify relevant domain skills only.
8. Define goal, acceptance criteria, scope, out-of-scope areas, risks, and stop conditions.
9. Create only necessary subagents.
10. Freeze the implementation plan.
11. Implement the smallest coherent solution without reopening architecture unless evidence invalidates the plan.
12. Run focused tests/typecheck/build first.
13. Run broader verification where Definition of Done, release risk, or shared infrastructure requires it.
14. Run tester/reviewer only where they add independent value.
15. Fix blocker/high findings.
16. Re-run relevant verification.
17. Apply the Definition of Done.
18. Report one consolidated result.

Do not push to GitHub unless explicitly requested.

## Minimum Completion Gate

Normal feature work is not complete until relevant checks pass:

- frontend TypeScript
- API TypeScript
- frontend production build
- API production build
- focused tests

Where applicable:

- migration tests
- RBAC
- idempotency
- retry/failure behavior
- PWA/mobile review
- security review
- data-integrity review
- observability/audit review
- backward-compatibility review

The authoritative completion checklist is:

@.claude/docs/definition-of-done.md

## Git Safety

Do not:

- overwrite unrelated uncommitted work
- commit secrets
- include temporary debug code
- force push unless explicitly requested

Before commit:
inspect git diff.

## Final Reporting

After implementation provide one concise report containing:

- task
- models used
- agents used
- changes made
- files changed
- DB/API changes
- security/RBAC impact
- PWA/mobile result
- tests/builds
- remaining risks
- READY or BLOCKED

Do not include long exploratory narration when a concise evidence-based summary is sufficient.