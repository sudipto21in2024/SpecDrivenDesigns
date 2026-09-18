# Spec-Driven Workflow (End-to-End State Machine)

Every unit of work is a **ticket** — a markdown file in `/specs/`. Tickets move through states in
order. No state can be skipped. The Orchestrator Agent enforces this; worker agents self-report
state transitions by updating the ticket's front matter.

## Ticket front matter

```yaml
---
id: LOGI-0007
title: Create shipment
status: draft            # see State Machine below
owner_agent: spec-agent
created: 2026-09-18
depends_on: []
---
```

## State machine

```
DRAFT
  → (Spec Agent writes acceptance criteria) → SPEC_REVIEW
SPEC_REVIEW
  → (human or Orchestrator approves) → SPEC_APPROVED
  → (rejected, needs rework) → DRAFT
SPEC_APPROVED
  → (Architect Agent writes OpenAPI + ADR + migration plan) → CONTRACT_REVIEW
CONTRACT_REVIEW
  → (Orchestrator validates contract lints, no breaking changes to existing consumers) → CONTRACT_APPROVED
  → (rejected) → SPEC_APPROVED
CONTRACT_APPROVED
  → fan-out in parallel:
      → Database Agent applies migration → DB_READY
      → Backend Agent implements against contract → BACKEND_IN_PROGRESS → BACKEND_DONE (tests green)
      → Frontend Agent implements against contract + mock server → FRONTEND_IN_PROGRESS → FRONTEND_DONE (unit tests green)
  → when DB_READY + BACKEND_DONE + FRONTEND_DONE → INTEGRATION_READY
INTEGRATION_READY
  → (QA Agent writes & runs Playwright specs against integrated app) → E2E_IN_PROGRESS
  → all acceptance criteria pass → E2E_PASSED
  → any criterion fails → BUG_FOUND → routed back to Backend/Frontend Agent (with failing test as reproduction) → BACKEND_IN_PROGRESS/FRONTEND_IN_PROGRESS
E2E_PASSED
  → (Code Review Agent reviews PR) → REVIEW_IN_PROGRESS
  → approved → REVIEW_APPROVED
  → changes requested → back to the owning implementation agent
REVIEW_APPROVED
  → (DevOps Agent runs full CI) → CI_GREEN
  → (Orchestrator merges) → MERGED
MERGED
  → (Documentation Agent updates docs/changelog) → DONE
```

## Escalation to human

Agents escalate instead of guessing when:
- Acceptance criteria are ambiguous or contradict an existing feature.
- A change requires altering the DB schema in a breaking way (data loss risk).
- Two agents produce conflicting outputs the Orchestrator can't reconcile after 1 retry.
- A security-sensitive decision is needed (auth model changes, PII handling).

Escalations are written to `/specs/escalations/<ticket-id>.md` and block the ticket until a
human resolves them (Orchestrator polls for resolution, does not proceed on assumption).

## Scope guardrails (v1)

**In scope:** warehouses, vehicles, drivers, shipments (CRUD + status lifecycle), manual route
assignment, a planning board (list/kanban view), basic dashboard (counts, SLA breach flags),
role-based auth (Admin/Dispatcher/Driver/Viewer).

**Explicitly out of scope for v1** (agents must not build these without a new approved spec):
automatic route optimization algorithms, real-time GPS tracking, third-party carrier
integrations, billing/invoicing, multi-tenant SaaS support, mobile native apps (driver view is
responsive web only).

## Definition of done (applies to every ticket)

1. Spec's acceptance criteria all have a corresponding, passing Playwright test.
2. Backend unit tests + frontend unit tests green.
3. API contract has no undocumented endpoints/fields in the implementation.
4. Code Review Agent approved with no unresolved comments.
5. CI green on the merge commit.
6. Docs updated.
