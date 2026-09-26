---
id: LOGI-0008
title: Edit (Pending) / cancel (Pending, Assigned)
status: draft
owner_agent: spec-agent
created: 2026-09-26
depends_on:
  - LOGI-0001
  - LOGI-0003
  - LOGI-0006
  - LOGI-0007
---

> `status: draft` until the architect checkpoint approves §7. Contract slices and the backend arm
> must not start before `spec_approved` (03-spec-driven-workflow.md state machine).

## 1. Summary
As a **Dispatcher**, I want to correct a shipment that has not left the warehouse yet, and to cancel
one that is still `Pending` or `Assigned`, so that planning mistakes or withdrawn orders do not
create freight that nobody can deliver.

This ticket covers **F6**. Editing is a narrow, additive capability over the LOGI-0007/0006 write
paths: `PATCH /api/v1/shipments/{id}` updates the *descriptive* columns of a `Pending` shipment only
(origin warehouse, destination, coordinates, weight). **Cancel introduces no new status-write path** —
it reuses `POST /api/v1/shipments/{id}/status-transitions` with `toStatus: "Cancelled"`, which BR-7
already permits from `Pending`/`Assigned` and which LOGI-0006 records in the append-only audit trail
via `Shipment.TransitionTo`. What this ticket *adds* on that path is the missing **BR-6 role rule**:
`Cancelled` becomes Admin/Dispatcher-only, so a Driver token can no longer cancel a shipment.
The edit form also needs the shipment detail read deferred by LOGI-0007 §5, so
`GET /api/v1/shipments/{id}` lands here.

## 2. Actors & roles
- Admin: edit and cancel any shipment; read shipment detail.
- Dispatcher: edit and cancel any shipment (primary daily user); read shipment detail.
- Viewer: read-only — detail is 200, `PATCH` is 403, `Cancelled` transition is 403 (BR-6).
- Driver: cannot edit or cancel — `PATCH` is 403 and `toStatus: "Cancelled"` is 403 (BR-6). Other
  transitions keep the LOGI-0006 behaviour; own-route scoping for them arrives with route assignment
  (LOGI-0009/0010). Detail access is **deferred** with the rest of Driver visibility (LOGI-0007 §7):
  Driver-role callers are excluded from `GET /shipments/{id}` until then.

## 3. Preconditions
- The caller is authenticated with a JWT (`Authorization: Bearer …`); anonymous calls are 401.
- The shipment exists (otherwise 404).
- For `PATCH`, the shipment's status is exactly `Pending` (BR-7 guard; see AC-2).
- For `toStatus: "Cancelled"`, the shipment's status is `Pending` or `Assigned` (BR-7; LOGI-0006 AC-2).
- At least one warehouse exists (needed only when `originWarehouseId` is part of the edit body).

## 4. Acceptance criteria (Given/When/Then)

Every criterion below must map to at least one automated test carrying a `// LOGI-0008 AC-n`
traceability comment (06-testing-strategy-playwright.md).

**AC-1 — Edit happy path (Pending only)**
```
Given a shipment in status Pending
When I PATCH /api/v1/shipments/{id} with any non-empty subset of
     { originWarehouseId, destinationAddress, destinationLat, destinationLng, weightKg }
Then I receive 200 with the full ShipmentResponse of the updated shipment
And GET /api/v1/shipments/{id} and the GET /api/v1/shipments list both read back the new values
And referenceCode, status, priority, slaDueAt and createdAt are unchanged
And no shipment_status_history row is written (an edit is not a status transition)
```

**AC-2 — Editing is Pending-only (BR-7 state guard)**
```
Given a shipment in status Assigned (or InTransit, Delivered, Delayed or Cancelled)
When I PATCH /api/v1/shipments/{id} with a valid body
Then I receive 409 ProblemDetails whose detail names the required status ("Pending")
And every column of the shipment is unchanged (nothing is partially applied)
```

**AC-3 — Edit validation: field-keyed 400, nothing written**
```
Given a shipment in status Pending
When I PATCH with destinationAddress blank/whitespace-only, or longer than 500 characters
Then I receive 400 ProblemDetails with errors.destinationAddress populated
When I PATCH with weightKg <= 0 (or weightKg null)
Then I receive 400 with errors.weightKg populated
When I PATCH with destinationLat outside [-90, 90] or destinationLng outside [-180, 180]
Then I receive 400 with errors.destinationLat / errors.destinationLng populated
When I PATCH with an unknown originWarehouseId (e.g. 999999 or a non-numeric value)
Then I receive 400 with errors.originWarehouseId populated (warehouse-existence precedent of LOGI-0007)
When I PATCH with an empty body `{}`
Then I receive 400 with errors.body populated ("at least one editable field is required")
And in every case the shipment row is byte-identical afterwards and no history row appears
```

**AC-4 — Server-owned and immutable fields are never accepted**
```
Given a shipment in status Pending
When the PATCH body contains id, referenceCode, status, slaDueAt, createdAt, updatedAt,
     routeId or atRisk
Then I receive 400 ProblemDetails with errors.<field> naming it server-owned
When the PATCH body contains priority (Standard or Express)
Then I receive 400 with errors.priority populated ("priority is immutable; create a new shipment")
     — the §7 O1 default, which keeps BR-1's single sla_due_at writer (LOGI-0007) intact
And no field of a rejected request is partially applied
```

**AC-5 — Unknown shipment**
```
When I PATCH /api/v1/shipments/999999 with a valid body
Then I receive 404 ProblemDetails
When I GET /api/v1/shipments/999999
Then I receive 404 ProblemDetails
And no row is written to shipments or shipment_status_history
```

**AC-6 — Shipment detail (the read LOGI-0007 deferred here)**
```
Given a shipment created by POST /api/v1/shipments
When I GET /api/v1/shipments/{id}
Then I receive 200 with exactly the ShipmentResponse shape the list rows use,
     including the read-time atRisk projection (BR-2) and routeId (null until LOGI-0010)
And the response for a shipment edited per AC-1 reflects the edited values
```

**AC-7 — Edit/detail authorization (BR-6)**
```
Given I have no Authorization header
When I call GET or PATCH /api/v1/shipments/{id}
Then I receive 401 ProblemDetails
Given I am logged in as Viewer
When I GET /api/v1/shipments/{id} → 200; When I PATCH it → 403 ProblemDetails
Given I am logged in as Driver
When I call GET or PATCH /api/v1/shipments/{id} → 403 (own-route scoping is LOGI-0009/0010)
Given I am logged in as Admin or Dispatcher
Then GET and PATCH return 2xx for any existing Pending shipment
And every rejected call writes nothing
```

**AC-8 — Cancel happy path (BR-7 via the LOGI-0006 endpoint)**
```
Given a shipment in status Pending (or Assigned)
When I POST /api/v1/shipments/{id}/status-transitions with
     { "toStatus": "Cancelled", "note": "Customer withdrew the order" }
Then I receive 200 with the audit echo (fromStatus, toStatus "Cancelled", changedByUserId, changedAt)
And GET /api/v1/shipments/{id} reports status "Cancelled"
And GET /api/v1/shipments/{id}/status-history shows the cancel as the newest entry, note included
And GET /api/v1/shipments?status=Cancelled returns the shipment
```

**AC-9 — Cancel is rejected outside Pending/Assigned (BR-7 regression)**
```
Given a shipment in status InTransit, Delivered, Delayed or already Cancelled
When I POST toStatus "Cancelled"
Then I receive 409 ProblemDetails whose detail names the legal next state(s)
And the status is unchanged and no shipment_status_history row is written
```

**AC-10 — Cancel authorization: the BR-6 role rule this ticket adds**
```
Given a shipment in status Pending or Assigned
When a Driver calls POST /status-transitions with toStatus "Cancelled"
Then I receive 403 ProblemDetails (BR-6: only Admin and Dispatcher may cancel)
And no shipment_status_history row is written for the rejected attempt
Given the same Driver transitions a non-terminal status (e.g. Assigned → InTransit)
Then the LOGI-0006 behaviour is unchanged (2xx, history row) — only "Cancelled" is role-gated here
Given a Viewer calls toStatus "Cancelled" → 403; Given no Authorization header → 401
Given Admin or Dispatcher → 200 and the history row is written
```

**AC-11 — UI seams (list row actions)**
```
Given I am Admin or Dispatcher on the Shipments tab
Then a Pending row offers Edit and Cancel; an Assigned row offers Cancel but not Edit;
     InTransit, Delayed, Delivered and Cancelled rows offer neither
When I choose Edit, a dialog is pre-filled from GET /api/v1/shipments/{id}, saving sends PATCH,
     and the row refreshes with the new values (errors rendered per field on 400)
When I choose Cancel, a confirmation is required before the transition is sent with
     toStatus "Cancelled"
And Viewer and Driver see no row actions at all
And a 409 (state changed in another tab) surfaces a message and refreshes the row
```

**AC-12 — BR-1/BR-2 non-regression after an edit or cancel**
```
Given a Pending shipment whose address, weight and origin warehouse are edited (AC-1)
Then slaDueAt is byte-identical to its creation value (BR-1: computed once at insert by LOGI-0007)
And priority is unchanged
Given a shipment cancelled per AC-8
Then the BR-2 read-time projection still reports atRisk=false for it (rule 2.3: Delivered and
     Cancelled are excluded) and slaRisk=true/false behaves exactly as before
And no at_risk/breached column is introduced anywhere
```

## 5. Out of scope (explicit)
- Route creation and vehicle/driver assignment (BR-3, BR-4) — LOGI-0009; assigning shipments to a
  route including the BR-5 capacity check — LOGI-0010. `routeId` stays null and is never set here.
- Driver own-route visibility/transition scoping — LOGI-0009/0010. This ticket only closes the
  `Cancelled` role hole (AC-10); it does not scope the remaining Driver transitions.
- Changing `priority` (and therefore `sla_due_at`) — see §7 O1. Amending BR-1's enforcement seam is a
  `Docs/business-rules/BR-sla-rules.md` change and needs a BRD revision, not a feature ticket.
- Deleting a shipment, bulk/batch edit, CSV import, edit history/audit of field changes (§7 O3).
- Planning board / kanban (LOGI-0011) and dashboard aggregates (LOGI-0012).
- `PATCH` of a shipment that has a route (only reachable from `Assigned`, which AC-2 rejects anyway).

## 6. Data touched
- Reads: `shipments` (detail + guard), `warehouses` (origin-existence check when
  `originWarehouseId` is edited), `shipment_status_history` (cancel audit echo).
- Writes: `shipments` — an **UPDATE restricted to** `origin_warehouse_id`, `destination_address`,
  `destination_lat`, `destination_lng`, `weight_kg` (and the server-managed row timestamp) while the
  status is `Pending`; `shipment_status_history` — only the row written by the LOGI-0006 cancel
  transition.
- Never written here: `sla_due_at` and `priority` (BR-1 seam — LOGI-0007 is their single writer),
  `status` through PATCH (BR-7 is owned by `Shipment.TransitionTo` in LOGI-0006), `reference_code`,
  `created_at`, `route_id` (LOGI-0010), and any at-risk column (it does not exist by design).
- Migration: **none expected** — all columns already exist from the LOGI-0006/0007 migrations. The
  backend arm must confirm with `dotnet ef migrations has-pending-model-changes` (expects "none").

## 7. Open questions (safe defaults applied — confirm at the checkpoint)
| # | Question | Safe default applied | Alternative |
|---|---|---|---|
| O1 | Is `priority` editable while `Pending`? | **No** — 400 `errors.priority` ("priority is immutable; create a new shipment"). Keeps BR-1's single `sla_due_at` writer and needs no doc change. | Allow it and recompute `sla_due_at = created_at + offset` — requires amending `Docs/business-rules/BR-sla-rules.md` (BRD revision). |
| O2 | Dedicated `POST /shipments/{id}/cancel` endpoint? | **No** — reuse the LOGI-0006 transition endpoint with `toStatus: "Cancelled"`; one status-write path (`Shipment.TransitionTo`), one audit trail, no contract surface duplication. | Add the convenience endpoint (a second path into the state machine; rejected for BR-7 ownership). |
| O3 | Is a field edit audited? | **No** `shipment_status_history` row — F7 audits *status* transitions; the server-managed row timestamp is the only trace. | Add an edit-audit table (new migration, outside F6). |
| O4 | Driver cancelling shipments | **403** for `toStatus: "Cancelled"` only (BR-6). | Exclude Driver from the transitions endpoint entirely (breaks LOGI-0006 AC-8); or implement own-route scoping now (LOGI-0009/0010). |
| O5 | `Driver` reading the new detail endpoint | **403** — consistent with LOGI-0007 §7 (`GET /shipments` excludes Driver until own-route scoping). | Allow Driver detail reads with route scoping (LOGI-0010). |
| O6 | Is the response's `updatedAt` affected by an edit? | **Yes, server-managed** — `ShipmentResponse.updatedAt` already exists (nullable, additive from LOGI-0007) and is refreshed on a successful PATCH; it stays server-owned (rejected in the request body per AC-4) and no new response field is added. | Expose an explicit `editedByUserId`/edit timestamp pair (needs a migration + audit table). |

## 8. Non-functional requirements
- `PATCH /shipments/{id}` and `GET /shipments/{id}` respond in <300ms p95 on the seeded volumes.
- The edit is all-or-nothing: a rejected request must leave the row and the audit trail untouched
  (asserted by reading the row back, not by trusting the response).
- Audit trail stays append-only: no rejected edit or transition may produce a history row.
- All timestamps remain ISO8601 UTC; no timezone-naive values are introduced.
- The list page stays the primary surface — edit/cancel must not trigger a full page reload.

---

## Downstream artifacts this spec produces (for traceability)
- `contracts/v1-openapi.yaml` — `GET /shipments/{id}` (`getShipment`), `PATCH /shipments/{id}`
  (`updateShipment`), `components.schemas.ShipmentUpdateRequest`, plus the documented role×toStatus
  cancel rule on the existing transitions operation (Architect Agent, additive only).
- Migration — none expected (columns exist); backend arm confirms with
  `dotnet ef migrations has-pending-model-changes`.
- `src/backend/.../GetShipmentQuery.cs`, `UpdateShipmentCommand.cs` + validator, the BR-6
  role×toStatus guard in the status-transition handler, endpoint routing (Backend Agent).
- `src/frontend/src/features/shipments/` row actions, `EditShipmentDialog`, cancel confirmation and
  capability gating (Frontend Agent).
- `tests/e2e/edit-shipment.spec.ts` (AC-1..AC-7, AC-12) and `tests/e2e/cancel-shipment.spec.ts`
  (AC-8..AC-10, AC-12) plus the UI seams (AC-11) (QA Agent).