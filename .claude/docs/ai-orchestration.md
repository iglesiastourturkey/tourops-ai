# TourPilot AI Orchestration Standard

TourPilot uses AI coding agents as a coordinated engineering system, not as independent agents repeatedly rediscovering the same context.

## Objectives

- maximize useful output per token and per model call
- minimize duplicate repository exploration
- keep context bounded to the active task
- route difficult reasoning to stronger models only when justified
- preserve engineering quality, safety, and verification
- make handoffs between Cowork, Claude Code, Codex, and specialist agents concise and reusable

## Default Operating Model

For complex work:

Cowork / orchestrator
→ scope, acceptance criteria, workstream split
→ Claude Code or strong reasoning model
→ root cause / architecture / frozen plan
→ Codex or implementation model
→ scoped implementation + focused tests
→ reviewer
→ independent verification only
→ orchestrator
→ consolidated result

The same role may be combined for small and medium tasks when separation would add overhead without improving quality.

## No Duplicate Discovery

When one agent has already established a root cause or frozen implementation plan with sufficient evidence, the next agent should consume that handoff instead of restarting broad analysis.

Re-open discovery only when:

- implementation evidence contradicts the plan
- tests expose a new root cause
- repository state has materially changed
- a safety/security/data-integrity concern requires independent validation

## Context Budgeting

Every task should start with the smallest useful context:

1. `CLAUDE.md`
2. `engineering-quality`
3. `ai-efficiency`
4. relevant domain skill(s)
5. active files and tests
6. broader architecture only if needed

Do not load all project docs, skills, agents, logs, or historical discussions by default.

## Task Contract

For significant tasks, establish a compact task contract before editing:

- goal
- acceptance criteria
- scope
- out-of-scope areas
- risk level
- implementation owner
- verification owner if separate
- stop conditions

## Recommended Routing

### Routine / mechanical
Use the fastest sufficiently capable coding model.

Examples:
- isolated UI changes
- tests from clear acceptance criteria
- type fixes
- contained CRUD
- mechanical cleanup

### Deep reasoning
Use stronger reasoning only when needed.

Examples:
- architecture
- difficult debugging
- auth/RBAC
- migrations
- concurrency/idempotency
- data-integrity problems
- multi-system workflows

### Orchestration
Use Cowork when the work genuinely crosses multiple tools or independent workstreams.

Do not add orchestration layers to a task that one coding session can safely complete.

## Review Policy

Review should verify, not restart implementation.

A reviewer should focus on:

- correctness against acceptance criteria
- regressions
- security/RBAC
- data integrity
- idempotency/retry behavior
- maintainability/evolvability
- tests and Definition of Done

Avoid multiple broad review loops unless new evidence justifies them.

## Handoff Template

Use this compact format when handing work to another model or agent:

```text
TASK:
ROOT CAUSE / DECISION:
FROZEN PLAN:
IN SCOPE:
OUT OF SCOPE:
FILES:
TESTS RUN:
STOP CONDITIONS:
RISKS:
NEXT ACTION:
```

Do not include raw conversation history when this summary is enough.

## Efficiency Metrics

A high-quality AI-assisted task should ideally show:

- bounded file scope
- little or no duplicate investigation
- minimal number of agents needed
- focused verification
- one consolidated final report
- no opportunistic scope creep

Token efficiency is not a substitute for engineering quality. It is a constraint to improve discipline.
