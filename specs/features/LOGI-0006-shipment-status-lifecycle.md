---
id: LOGI-0006
title: Shipment status lifecycle (TransitionTo)
status: done
owner_agent: spec-agent
created: 2026-09-22
depends_on:
  - LOGI-0003
---

## 1. Summary
As a **Dispatcher**, I want to move a shipment through its lifecycle (Pending → Assigned →
InTransit → Delivered, with Cancelled and Delayed side states) via a dedicated transition
endpoint, so that the status shown to customers is always trustworthy and every change is
attributable (BR-7, BO-4).

This is the BR-7 state machine as a first-class sub-resource: transitions are their own
endpoint (`POST /shipments/{id}/status-transitions` per 05-api-contract-standards), not a
raw PATCH of the status column. Shipment creation (LOGI-0007) and edit/cancel UX
(LOGI-0008) are separate tickets — this arm ships the state machine + audit trail that
they will reuse. The `shipments` entity and `shipment_status_history` table are already
approved in the database schema (§shipments, §shipment_status_history); no schema change
is introduced here.

## 2. Actors & roles
- Admin: transition any shipment, view history.
- Dispatcher: transition any shipment, view history.
- Driver: may transition **only shipments on their own routes** (BR-6). Route assignment
  lands with LOGI-0009/0010; until then the Driver role is declared in the contract but
  ownership scoping is deferred — v1 backend behavior for Driver-role callers is defined
  at LOGI-0009/0010 integration (flagged in §7).
- Viewer: read-only (history view only, no transitions).

## 3. Preconditions
- LOGI-0003 auth enforced: callers present `Authorization: Bearer <jwt>`; anonymous → 401.
- A shipment row exists (LOGI-0007 creates them; tests seed directly until 0007 lands).

## 4. Acceptance criteria (Given/When/Then)

**AC-1 — Legal forward transitions (happy path)**
```
Given a shipment in status Pending
When I POST /api/v1/shipments/{id}/status-transitions with { "toStatus": "Assigned" }
Then I receive 200 with the event echo (fromStatus "Pending", toStatus "Assigned",
     changedByUserId = my user id, changedAt ISO8601 UTC, note null)
And GET /api/v1/shipments/{id}/status-history shows the transition as the newest entry
And the shipment's status is now "Assigned"
And the full forward chain Pending → Assigned → InTransit → Delivered succeeds
    one transition at a time (each step 200, each recorded)
```

**AC-2 — Cancelled: legal only from Pending or Assigned**
```
Given a shipment in status Pending (or Assigned)
When I transition toStatus "Cancelled"
Then I receive 200 and the shipment status is "Cancelled"
Given a shipment in status InTransit (or Delivered or Cancelled)
When I transition toStatus "Cancelled"
Then I receive 409 ProblemDetails naming the legal next states, and the status is unchanged
```

**AC-3 — Delayed: only from InTransit, reversible back to InTransit**
```
Given a shipment in status InTransit
When I transition toStatus "Delayed"
Then I receive 200 and the status is "Delayed"
When I then transition toStatus "InTransit"
Then I receive 200 and the status is back to "InTransit"
Given a shipment in status Pending (or Assigned/Delivered/Cancelled)
When I transition toStatus "Delayed"
Then I receive 409 ProblemDetails
```

**AC-4 — Illegal transition rejected with 409 (BR-7 server-side enforcement)**
```
Given a shipment in status Pending
When I transition directly toStatus "InTransit" (or "Delivered", or any non-legal jump)
Then I receive 409 ProblemDetails whose detail names the legal next state(s) ("Assigned")
And the shipment status is unchanged
And no shipment_status_history row is written for the rejected attempt
```

**AC-5 — Validation: toStatus required and must be a known status**
```
When I POST with an empty body, or toStatus missing/empty
Then I receive 400 ProblemDetails with errors.toStatus populated
When I POST with toStatus "Flying" (not in the enum)
Then I receive 400 ProblemDetails with errors.toStatus populated
When I POST with a note longer than 500 characters
Then I receive 400 ProblemDetails with errors.note populated
```

**AC-6 — Not found**
```
When I POST /api/v1/shipments/999999/status-transitions with { "toStatus": "Assigned" }
Then I receive 404 ProblemDetails
When I GET /api/v1/shipments/999999/status-history
Then I receive 404 ProblemDetails
```

**AC-7 — Audit trail: every accepted transition is recorded (BO-4)**
```
Given a shipment that has gone through Pending → Assigned → InTransit → Delayed
When I GET /api/v1/shipments/{id}/status-history
Then I receive a paged list ordered oldest → newest
And every entry carries fromStatus (null for the initial entry), toStatus,
    changedByUserId, changedAt (ISO8601 UTC) and the optional note exactly as supplied
And the history is append-only: rejected transitions (AC-4/AC-5) appear nowhere
```

**AC-8 — Authorization (RBAC enforced from day one)**
```
Given I have no Authorization header
When I call either /status-transitions or /status-history on any shipment
Then I receive 401 ProblemDetails
Given I am logged in as Viewer
When I POST a status transition
Then I receive 403 ProblemDetails
Given I am logged in as Viewer
When I GET /status-history
Then I receive 200 (read-only access is allowed)
Given I am logged in as Admin or Dispatcher
Then both endpoints return 2xx for any existing shipment
```

## 5. Out of scope (explicit)
- Shipment creation (reference codes, SLA due calculation) — LOGI-0007.
- Edit / cancel UX of a shipment — LOGI-0008 (cancel itself will call this endpoint).
- Route assignment, BR-4/BR-5 capacity/overlap rules — LOGI-0009/0010.
- Driver-role ownership scoping (only own-route shipments) — enforced from LOGI-0009/0010;
  until then Driver-role transitions are a documented deferral (§7), not silently allowed
  to roam (ADR-007 negative).
- SLA at-risk projection (read-time seam in BR-sla-rules) — LOGI-0012.
- Vehicle/driver status lifecycle — deliberately none exists (no BRD rule; free-form PUT
  per LOGI-0004/0005 §5); this ticket does not change that.
- Bulk transitions, scheduled/auto transitions, webhooks on status change — future.

## 6. Data touched
- Writes: `shipments.status` + append to `shipment_status_history`
  (from_status, to_status, changed_by_user_id, changed_at, note) — **one transaction**:
  a transition either updates the row and writes history, or does neither.
- Reads: `shipments`, `shipment_status_history` (paged, ordered by changed_at/id asc).
- Migration: `shipment_status_history` table exists in the approved schema but not yet in
  the DB — this arm's backend fan-out adds migration `<Timestamp>_LOGI-0006_AddShipmentStatusHistory`.

## 7. Open questions (checkpoint answers recorded)
- **Delayed → Cancelled:** BR-7 lists Cancelled only from Pending/Assigned — interpreted
  strictly: **not legal**. Answered at checkpoint.
- **409 vs 422 for illegal transitions:** 409 Conflict chosen (state-conflict semantics);
  ProblemDetails.detail carries the legal next states. Answered at checkpoint.
- **Ticket ordering (0006 before 0007):** state machine + history table ship first;
  LOGI-0007 reuses them. Answered at checkpoint.
- **Driver role ownership scoping:** declared in x-roles now, enforced at LOGI-0009/0010.
  Answered at checkpoint.

## 8. Non-functional requirements
- Transition endpoint responds <200ms p95; history list <300ms p95 at ~1000 history rows.
- Index on `shipment_status_history.shipment_id` (per schema indexing rules) keeps the
  history query cheap; `shipments.status` is already indexed for dashboard filters.
- All timestamps ISO8601 UTC.

---
## Downstream artifacts this spec produces (for traceability)
- `contracts/v1-openapi.yaml` — `POST /shipments/{id}/status-transitions` +
  `GET /shipments/{id}/status-history` + `StatusTransitionRequest`/`ShipmentStatusEvent`
  schemas (Architect Agent, this arm).
- Migration `<Timestamp>_LOGI-0006_AddShipmentStatusHistory` (Database Agent, additive).
- `src/backend/.../TransitionShipmentStatus/` command + handler + BR-7 transition table
  validator (Backend Agent) — the legal-transition map lives in one place, Application layer.
- `src/frontend/src/features/shipments/StatusTransition*` (Frontend Agent, from LOGI-0007/0008).
- `tests/e2e/shipment-status-lifecycle.spec.ts` covering AC-1..AC-8 (QA Agent).
