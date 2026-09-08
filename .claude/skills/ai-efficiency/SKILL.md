---
name: ai-efficiency
description: TourPilot'ta Claude Code, Codex, Cowork ve alt ajanları minimum tekrar, kontrollü kapsam ve en düşük yeterli model maliyetiyle kullanmak için zorunlu orkestrasyon standardı. Non-trivial planlama, implementasyon, debug, review ve çok-ajanlı çalışmalarda kullan.
---

# TourPilot AI Efficiency & Agent Orchestration

## Goal

Maximize useful engineering output per model call and per token while preserving TourPilot's engineering-quality standard.

AI efficiency never overrides correctness, security, data integrity, auditability, or operational safety.

## Core Rule

One model thinks deeply, one model implements, one model verifies when separation adds value.
Do not make multiple models rediscover the same problem from scratch.

## Context Discipline

Before loading broad repository context:

1. Read `CLAUDE.md`.
2. Load `engineering-quality`.
3. Identify the smallest relevant file/domain set.
4. Reuse an existing frozen plan or handoff if one exists.
5. Do not re-read unrelated architecture, logs, tests, or docs without evidence they are needed.

Prefer targeted file reads and focused searches over whole-repo exploration.

## Task Sizing

### S — Small
Examples: copy, isolated UI fix, simple type fix, focused test.

- one model
- no subagents by default
- no separate architecture phase
- focused verification only

### M — Medium
Examples: contained feature, API endpoint, form workflow, local refactor.

- one planner/implementer may be enough
- at most one independent review pass unless risk requires more
- freeze scope before editing

### L — Large
Examples: cross-layer feature, difficult bug, migration, auth, idempotency, integration safety.

Preferred flow:

1. strong reasoning model for root cause / frozen plan
2. implementation model for scoped execution
3. reviewer only after implementation

Do not let the implementer reopen architecture unless evidence invalidates the frozen plan.

### XL — Multi-workstream
Use Cowork/orchestration only when independent workstreams materially benefit from parallelism.

- split by non-overlapping ownership
- avoid concurrent writes to the same files
- provide each worker a bounded context and acceptance criteria
- consolidate once, not repeatedly

## Role Guidance

### Cowork
Use for:
- orchestration across tools, files, GitHub, and multiple workstreams
- project/phase execution
- coordinating handoffs

Do not use Cowork merely to wrap a task one coding agent can finish directly.

### Claude Code
Prefer for:
- architecture and difficult root-cause analysis
- migrations
- authentication / authorization
- concurrency / idempotency
- cross-system integration design
- complex production debugging

### Codex
Prefer for:
- implementation from a frozen plan
- focused refactors
- React/API changes
- tests
- type fixes
- mechanical or well-scoped engineering work

These are routing defaults, not rigid vendor rules. Use the cheapest sufficiently capable model available for the actual task.

## Frozen Scope

Before significant implementation, define:

- task goal
- acceptance criteria
- files/domains in scope
- files/domains explicitly out of scope
- known risks
- required tests
- stop conditions

Once frozen, do not expand scope for opportunistic cleanup.

## Stop Conditions

Stop implementation and report rather than silently expanding scope when any of these occur unless the task explicitly allows them:

- required root cause lies outside the agreed domain
- a database schema change becomes necessary unexpectedly
- auth/security semantics would change
- destructive migration or production-data mutation is required
- more than five additional unplanned files need modification
- a second source of truth or parallel architecture would be introduced
- an unrelated regression is discovered
- acceptance criteria cannot be satisfied without materially changing the plan

## Handoff Discipline

A handoff must be concise and reusable. Include only:

- goal
- confirmed root cause or decision
- frozen plan
- exact files touched / to touch
- constraints and stop conditions
- tests already run and results
- unresolved risks
- next action

Do not copy entire logs, long conversations, or broad repository summaries into handoffs when a short evidence summary is sufficient.

## Verification Discipline

Use focused verification first:

1. tests for changed business behavior
2. relevant typecheck/build
3. targeted security/RBAC/idempotency checks where applicable
4. full-suite checks only when risk, shared infrastructure, release gating, or project policy requires them

Never skip mandatory `definition-of-done` checks merely to save tokens or time.

## Output Discipline

Default final reports should be concise and structured around:

- result
- changed files
- tests/builds
- risks
- READY/BLOCKED

Do not narrate every exploratory step unless it is necessary evidence.

## Anti-Patterns

Avoid:

- asking Claude Code and Codex to independently inspect the whole repo for the same task
- repeated "review everything" loops
- spawning agents with overlapping responsibilities
- loading every skill for every task
- running full builds/tests after each tiny edit when focused validation is sufficient
- broad refactors during bug fixes
- re-explaining stable project context already captured in repo instructions
- escalating to the most expensive model for routine work

## Priority Order

When optimizing work, preserve this order:

1. correctness
2. security and data integrity
3. operational safety
4. maintainability and evolvability
5. verification quality
6. token/time efficiency

Efficiency is valuable only when the result remains trustworthy.
