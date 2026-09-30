---
id: LOGI-0010
title: Assign shipment to route (BR-5 capacity check)
status: spec_approved
owner_agent: spec-agent
created: 2026-09-30
depends_on:
  - LOGI-0006
  - LOGI-0007
  - LOGI-0009
---

## 1. Summary
As a **Dispatcher**, I want to add a shipment to a planned route and remove it again, so that a trip
carries a load that fits the assigned vehicle and every shipment on that route is traceable to a
driver and a delivery window (BR-5).

This ticket covers **shipment→route assignment and its inverse**: `POST /api/v1/routes/{id}/shipments`,
`DELETE /api/v1/routes/{id}/shipments/{shipmentId}` and `GET /api/v1/routes/{id}/shipments` (paged list
with a running capacity projection). Assignment enforces the **BR-5 capacity check** — the sum of
`weight_kg` over the route's assigned shipments must not exceed the assigned vehicle's `capacity_kg` —
and, per PRD F10, the shipment's status auto-transitions `Pending → Assigned` in the same transaction,
appending exactly one `shipment_status_history` row.

Route creation and vehicle/driver assignment are LOGI-0009 (done) and are never touched here. Route
status transitions (Planned → InProgress → …) remain a later ticket: the planning board (LOGI-0011) and
dashboard (LOGI-0012) consume what lands here. The claim recorded in the LOGI-0009 contract —
"shipment assignment is LOGI-0010 — no shipment is touched here" — is discharged by this ticket.

## 2. Actors & roles
- Admin: assign, unassign, read any route's shipment list.
- Dispatcher: assign, unassign, read any route's shipment list (primary daily user).
- Viewer: read-only — `GET /routes/{id}/shipments` is 200, `POST`/`DELETE` are 403 (BR-6).
- Driver: reads **only** the shipment list of routes assigned to the caller's linked driver; every
  write is 403 (BR-6, PRD F12). This enforces the ownership scoping that LOGI-0006/0007 declared and
  deferred ("Driver may only transition shipments on their own routes").

## 3. Preconditions
- The caller is authenticated with a JWT (`Authorization: Bearer …`); anonymous calls are 401.
- The route exists (otherwise 404) and is in status `Planned` (otherwise 409, §7 O2).
- The shipment exists (otherwise 404) and is in status `Pending` (otherwise 409, §7 O3).
- The route's vehicle — when set — is loaded to read `capacity_kg` for the BR-5 check. A route with
  **no** vehicle skips the check (§7 risk note).
- `shipments.route_id` already exists in the approved schema (§shipments) and the LOGI-0006/0007
  migration set has created the column; no new table is introduced by this ticket.

## 4. Acceptance criteria (Given/When/Then)

Every criterion below must map to at least one automated test carrying a `// LOGI-0010 AC-n` traceability comment.

**AC-1 — Assign happy path (PRD F10 auto-transition)**
```
Given I am Admin or Dispatcher, route R is Planned with vehicle V (capacityKg 1000)
And shipment S is Pending with weightKg 300 and routeId null
When I POST /api/v1/routes/{R}/shipments with { "shipmentId": S }
Then I receive 200 with the ShipmentResponse (routeId = R, status "Assigned", weightKg unchanged)
And GET /api/v1/routes/{R}/shipments lists S
And GET /api/v1/shipments/{S} reads back routeId = R and status "Assigned"
And GET /api/v1/shipments/{S}/status-history gained exactly one row
    (fromStatus "Pending", toStatus "Assigned", changedByUserId = me, note null)
And the route row itself (name, window, vehicle, driver, status) is unchanged
```

**AC-2 — BR-5 capacity guard (409, nothing written)**
```
Given route R is Planned with vehicle V capacityKg 1000, and S1 (400kg) and S2 (500kg) are Pending
When I POST /api/v1/routes/{R}/shipments { "shipmentId": S1 } then I receive 200 (total 400 <= 1000)
When I POST /api/v1/routes/{R}/shipments { "shipmentId": S2 } then I receive 200 (total 900 <= 1000)
Given shipment S3 (200kg) is Pending
When I POST /api/v1/routes/{R}/shipments { "shipmentId": S3 }
Then I receive 409 ProblemDetails whose detail names the three numbers
    (assigned 900, adding 200, capacity 1000)
And S3 is byte-identical afterwards (routeId null, status "Pending", no history row)
And R's shipment count and assigned weight are unchanged
Given a route with no vehicle assigned (capacity unknown)
When I assign a shipment to it
Then I receive 200 and the capacity is simply not checked
```

**AC-3 — Route must exist and be Planned**
```
When I POST /api/v1/routes/999999/shipments with a valid shipmentId → 404 ProblemDetails
When I POST /api/v1/routes/{R}/shipments where R is InProgress, Completed or Cancelled
Then I receive 409 ProblemDetails whose detail names the required status ("Planned")
And the shipment is unchanged (routeId null, status "Pending")
```

**AC-4 — Shipment must exist and be Pending; one route at a time**
```
When I POST with shipmentId 999999 → 404 ProblemDetails
When I POST with a shipment in status InTransit, Delivered, Delayed or Cancelled
Then I receive 409 ProblemDetails naming the required status ("Pending")
Given shipment S1 is already assigned to route R1
When I POST /api/v1/routes/{R2}/shipments with { "shipmentId": S1 } (R2 != R1)
Then I receive 409 ProblemDetails (unassign first — §7 O3) and S1 still belongs to R1
When I POST /api/v1/routes/{R1}/shipments with { "shipmentId": S1 } (same route)
Then I receive 200 as an idempotent no-op: no second history row, no capacity double-count
```

**AC-5 — Validation: field-keyed 400, nothing written**
```
When I POST with an empty body {} → 400 with errors.shipmentId populated
When I POST with shipmentId missing, null, 0, negative or non-numeric → 400 errors.shipmentId
When I POST to /api/v1/routes/{R}/shipments with a non-numeric {id} → 400
And in every case no shipment row, history row or route-derived number changes
```

**AC-6 — Unassign frees capacity and returns the shipment to Pending**
```
Given shipment S is assigned to route R (status "Assigned")
When I DELETE /api/v1/routes/{R}/shipments/{S}
Then I receive 204 with an empty body
And S has routeId null and status "Pending"
And S gained exactly one history row (fromStatus "Assigned", toStatus "Pending", changedByUserId = me)
And R's assigned weight drops by S.weightKg, so the freed capacity is reusable (AC-2 scenario reverses)
When I DELETE /api/v1/routes/{R}/shipments/{S} again → 404 (S is not on R)
When I DELETE /api/v1/routes/{R}/shipments/{S} where S is on R2 → 404
And unassign is refused (409) once S has left "Assigned" by another path (InTransit/Delivered/Cancelled)
```

**AC-7 — Authorization (BR-6)**
```
Given no Authorization header, any /routes/{id}/shipments call → 401
Given Viewer: GET → 200; POST/DELETE → 403
Given Driver (linked to driver 2): POST/DELETE → 403;
    GET /routes/{R}/shipments → 200 only for the route assigned to driver 2, 403 for any other route
Given Admin/Dispatcher: POST, DELETE, GET return 2xx (subject to AC-2/AC-3/AC-4/AC-6)
And every rejected call writes nothing
```

**AC-8 — Route shipment list and the capacity projection**
```
Given route R has 3 assigned shipments totalling 900kg and vehicle capacity 1000kg
When I GET /api/v1/routes/{R}/shipments?page=1&pageSize=20
Then I receive 200 with the standard paged envelope (items, page, pageSize, totalItems, totalPages)
And the capacity projection reads assignedWeightKg 900, remainingCapacityKg 100, shipmentCount 3, vehicleId = V
And for a route with no vehicle the projection's capacityKg/remainingCapacityKg are null (not 0)
And an invalid page/pageSize → 400; an unknown route → 404
```

**AC-9 — Atomicity and concurrent assigns**
```
Given route R with vehicle capacity exactly 1000kg and shipment S of 1000kg, Pending
When two requests assign S and S' (1000kg each) to R at the same time
Then exactly one receives 200 and the other 409 (capacity exceeded)
And R's assigned weight never exceeds 1000 and the count is never wrong
Given any rejected assign (AC-2/AC-3/AC-4/AC-5)
Then no partial write survives: route_id, status and history are all-or-nothing
```

**AC-10 — No regression against the delivered tickets**
```
Given a shipment assigned to a route (status "Assigned")
When I read it through GET /api/v1/shipments and its status-history
Then the LOGI-0007 read model and the LOGI-0006 history are unchanged in shape, and the read-time
    at-risk projection (BR-2) still reports exactly as before
And creating a route (LOGI-0009) still touches no shipment

## 5. Out of scope (explicit)
- Route creation, vehicle/driver assignment and the BR-3/BR-4 overlap guard — LOGI-0009 (done).
- Route **status** transitions (Planned → InProgress → Completed / Cancelled) — a later ticket; this
  ticket only *reads* route status to gate assignment.
- Planning board / kanban (LOGI-0011) and dashboard counts / SLA-risk / utilisation (LOGI-0012) —
  they consume the capacity projection and the assigned set defined here.
- Auto-assignment, route optimisation, load sequencing, multi-stop ordering — out of scope v1
  (BRD §out-of-scope).
- Bulk assign (many shipments per request) and CSV import — future; one shipment per call keeps the
  capacity check trivially auditable.
- Editing or cancelling a shipment (LOGI-0008) and the transition endpoint (LOGI-0006) — unchanged.

## 6. Data touched
- Writes: `shipments.route_id` + `shipments.status`, and append to `shipment_status_history`
  (from_status, to_status, changed_by_user_id, changed_at, note) — **one transaction**: an assign
  either sets route + status + history, or does none of them (AC-9). Unassign mirrors it: nulls
  `route_id`, returns the status to `Pending`, and appends one `Assigned → Pending` history row.
- Reads: `routes` (existence + status), `vehicles` (`capacity_kg`, when the route has one),
  `shipments` (status, `weight_kg`, `route_id`) for the running total and the paged list.
- Never: `routes` own columns, `shipments.sla_due_at` / `priority` / addresses, the at-risk projection
  (read-time only), vehicle/driver rows.

Additional risks surfaced by the architect (decided here, noted for the backend arm):
- A route with **no vehicle** (nullable FK from LOGI-0009 O3) has no capacity to check. Default: the
  BR-5 check is **skipped** and the assignment is allowed, with `capacityKg` / `remainingCapacityKg`
  reported as `null` (not `0`, which would read as "full"). Rejected: refusing assignment until a
  vehicle is set — contradicts LOGI-0009 O3, which explicitly allows an unassigned route so the
  planning board can show a draft lane.
- Concurrent assigns can read the same running total and both pass. The backend must serialise on the
  route row (re-read the total inside the transaction) so AC-9's exactly-one-winner holds on SQLite.

## 8. Non-functional requirements
- `POST` / `DELETE` /routes/{id}/shipments and `GET` <300ms p95 at seeded volumes (~1000 shipments,
  ~20 per route).
- All writes are all-or-nothing in a single transaction; the BR-5 check and the write must not be
  separable, and the read that feeds the check is repeated inside the transaction.
- All timestamps ISO8601 UTC; weight arithmetic in `decimal`, never `float` (0.1+0.2 class drift would
  let a boundary assignment through).
- No full page reload on assign/unassign — the capacity projection updates in place.

---

## Downstream artifacts (traceability)
- Contract: POST/GET `/routes/{id}/shipments` (assignShipmentToRoute / listRouteShipments),
  DELETE `/routes/{id}/shipments/{shipmentId}` (removeShipmentFromRoute), plus
  `AssignShipmentToRouteRequest` and the `RouteCapacityView` projection (additive only).
- Migration: none expected — `shipments.route_id` already exists; backend confirms (§6).
- Backend: `AssignShipmentToRouteCommand` + validator + BR-5 capacity guard serialised on the route
  row, `RemoveShipmentFromRouteCommand` (the `Unassign` domain operation), `ListRouteShipmentsQuery`
  with the running-total projection, and the Driver own-route scoping that LOGI-0006/0007 deferred.
  Frontend: route detail shipment list + assign/unassign dialogs + a live capacity bar
  (`features/routes/**`).
  QA (E2E, real API + throwaway SQLite, `tests/e2e/`): `support/routes.ts` helpers,
  `route-assign.spec.ts` (AC-1..AC-6, AC-9), `route-shipments-list.spec.ts` (AC-8),
  `route-assign-authz.spec.ts` (AC-7), `route-assign-ui.spec.ts` (AC-1/AC-2/AC-6 through the screen).

- Migration: **none expected** — `shipments.route_id` is already part of the approved schema and the
  LOGI-0006/0007 migration set; backend confirms at the start of its arm and adds an additive
  migration only if the deployed schema proves otherwise. A lookup index on `shipments.route_id` is
  additive if it is not already covered by the schema indexing rules.

## 7. Open questions (decided 2026-09-30 on BRD/PRD primacy — checkpoint answered)

Source order applied: BRD §6 → PRD F10 → HLD §6 → contract precedent. Full pro/con reasoning for every
row below is recorded in `state/plans/LOGI-0010-architect.plan.md` §5.1, which the backend and QA arms
must read before implementing.

| # | Question | Decision | Basis | Rejected alternative |
|---|---|---|---|---|
| O1 | Capacity breach → 400 or 409? | **409 Conflict.** BR-5 is a precondition on assignment, not an input-validation rule; every rule-state violation in v1 is 409 (LOGI-0009 AC-5, LOGI-0006 AC-4) and 400 is reserved for malformed input. `detail` names assigned weight, added weight and capacity. | BR-5 wording + contract precedent | 400 per the HLD §6 sequence diagram — a control-flow sketch, not a status-code contract, and inconsistent with two shipped tickets. 422 — no 422 exists in v1. |
| O2 | Which route statuses accept an assignment? | **`Planned` only.** A route is a plan until it departs; BR-3/BR-4 already treat `InProgress` as locked, and LOGI-0009 AC-6 fixes assignment changes as Planned-only. An `InProgress` trip has a physical load that the API can no longer re-fit. | BR-3/BR-4 + PRD F10 + LOGI-0009 AC-6 | Allow InProgress (no good failure mode when a mid-trip capacity re-check fails — the vehicle is already loaded). |
| O3 | May an assigned shipment move to another route in one call? | **No — 409; unassign then assign.** BR-5 is evaluated against one vehicle's `capacity_kg` and BO-4 requires attributable history, so an implicit move would hide a vehicle change. Re-assigning to the **same** route is an idempotent 200 no-op (no second history row, no double count). | BR-5 + BRD BO-4 | Implicit move (two capacity checks, one history row, ambiguous "which truck is this on"). |
| O4 | What does unassign do to the status? | **Returns the shipment to `Pending`** via a first-class `Shipment.Unassign()` writing one `Assigned → Pending` history row in the same transaction that nulls `route_id`. BR-7 is exhaustive and has no such edge, so this must **not** go through the generic `Shipment.TransitionTo` — that would extend BR-7 by implementation. The shipment cannot stay `Assigned` either: BR-6 scopes Driver action by own-route shipments, and an `Assigned` shipment with a null route is a delivery nobody owns. | BR-7 (exhaustive) + BR-6 | Leave it `Assigned` with a null route (breaks BR-6 scoping, strands it on the board); cancel on unassign (a business decision with its own endpoint, not a side effect of detaching). |

And the transition endpoint is unaffected: assigning is the only automated path to "Assigned" here
```
