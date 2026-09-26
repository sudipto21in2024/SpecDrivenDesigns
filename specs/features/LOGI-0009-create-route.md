---
ticket: LOGI-0009
status: draft
---

## 1. Summary
As a **Dispatcher**, I want to create a route for a working day and assign a vehicle and a driver to it,
so that shipments can be grouped onto a deliverable trip with a responsible driver and a capable vehicle.

This ticket covers **route creation + vehicle/driver assignment** (planning domain, BR-3 vehicle readiness,
BR-4 driver readiness). It introduces `POST /api/v1/routes` (create, vehicle/driver optional at creation),
`GET /api/v1/routes` (paged list), `GET /api/v1/routes/{id}` (detail) and `PATCH /api/v1/routes/{id}`
(assign / reassign / unassign vehicle and driver, rename, reschedule). Assignment validates existence
(404), field shape (400) and double-booking (409): the same vehicle or the same driver cannot be assigned
to two routes with overlapping planned time windows (BR-3/BR-4) while both are `Planned`/`InProgress`.
Creating a route never moves a
shipment — shipment→route assignment with the BR-5 capacity check is LOGI-0010. The deferred
delete-when-referenced 409s declared by LOGI-0004 (vehicles) and LOGI-0005 (drivers) become enforceable
once the `routes.vehicle_id` / `routes.driver_id` FKs exist here.

## 2. Actors & roles
- Admin: create, assign, reassign, read any route.
- Dispatcher: create, assign, reassign, read any route (primary daily user).
- Viewer: read-only — list/detail are 200, `POST`/`PATCH` are 403 (BR-6 read-only).
- Driver: reads own routes only — `GET /routes` returns only routes assigned to the caller's linked driver;
  `GET /routes/{id}` for another driver's route is 403; `POST`/`PATCH` are 403 (BR-6).

## 3. Preconditions
- The caller is authenticated with a JWT (`Authorization: Bearer …`); anonymous calls are 401.
- The route exists for detail/assign reads and writes (otherwise 404).
- A referenced vehicle exists (otherwise 404, §7 O1) and a referenced driver exists (otherwise 404).
- The route's status is `Planned` for any assignment change (assignment to a Completed/Cancelled route is 409).
- At least one vehicle and one driver exist before an assigned create can succeed (unassigned create allowed).

## 4. Acceptance criteria (Given/When/Then)

Every criterion below must map to at least one automated test carrying a `// LOGI-0009 AC-n` traceability comment.

**AC-1 — Create happy path (assigned)**
```
Given I am Admin or Dispatcher
When I POST /api/v1/routes with { "name": "North loop", "plannedStart": "2026-10-01T08:00:00Z", "plannedEnd": "2026-10-01T16:00:00Z", "vehicleId": 1, "driverId": 2 }
Then I receive 201 with the full RouteResponse (status "Planned", vehicleId 1, driverId 2)
And GET /api/v1/routes/{id} reads back the same values
And GET /api/v1/routes lists the new route
And no shipment row is modified (routeId of every shipment is unchanged)
```

**AC-2 — Create unassigned, assign later via PATCH**
```
Given I am Admin or Dispatcher
When I POST /api/v1/routes with { "name": "Spare run", "plannedStart": "2026-10-02T08:00:00Z", "plannedEnd": "2026-10-02T16:00:00Z" } (no vehicleId/driverId)
Then I receive 201 with vehicleId null and driverId null
When I PATCH /api/v1/routes/{id} with { "vehicleId": 1, "driverId": 2 }
Then I receive 200 with vehicleId 1 and driverId 2 persisted
And PATCH with { "vehicleId": null } unassigns the vehicle (200, vehicleId null, driver kept)
```

**AC-3 — Create/assign validation: field-keyed 400, nothing written**
```
Given I am Admin or Dispatcher
When I POST with name blank/whitespace-only, or longer than 200 characters
Then I receive 400 with errors.name populated
When I POST with plannedStart/plannedEnd missing, unparseable, or plannedEnd <= plannedStart
Then I receive 400 with errors.plannedStart / errors.plannedEnd populated
When I PATCH with vehicleId 0 / negative / non-numeric, or driverId 0 / negative / non-numeric
Then I receive 400 with errors.vehicleId / errors.driverId populated
When I PATCH with an empty body {}
Then I receive 400 with errors.body populated ("at least one field is required")
And in every case no route row is created or modified
```

**AC-4 — Unknown vehicle/driver and unknown route**
```
When I POST /api/v1/routes with vehicleId 999999 (or driverId 999999)
Then I receive 404 ProblemDetails
When I PATCH /api/v1/routes/{id} with vehicleId 999999 (or driverId 999999)
Then I receive 404 ProblemDetails and the route row is byte-identical afterwards
When I GET or PATCH /api/v1/routes/999999
Then I receive 404 ProblemDetails and nothing is written
```

**AC-5 — Double-booking guard (BR-3/BR-4 window overlap, 409)**
```
Given route A 2026-10-01 08:00-16:00Z with vehicle 1 (status Planned)
When I POST route 2026-10-01 12:00-20:00Z with vehicleId 1
Then I receive 409 ProblemDetails whose detail names the conflicting vehicle
And no route row is created
Given route B 2026-10-01 08:00-16:00Z with driver 2 (status Planned or InProgress)
When I PATCH another Planned route 2026-10-01 12:00-20:00Z with { "driverId": 2 }
Then I receive 409 and the target route is unchanged
And a non-overlapping window (e.g. 16:00-20:00Z touching at the boundary), or a Completed/Cancelled route, does NOT conflict (2xx)
```

**AC-6 — Assignment is Planned-only**
```
Given a route in status InProgress, Completed or Cancelled
When I PATCH /api/v1/routes/{id} with { "vehicleId": 3 }
Then I receive 409 whose detail names the required status ("Planned")
And every column of the route is unchanged
```

**AC-7 — Route authorization (BR-6)**
```
Given no Authorization header, any /routes call → 401
Given Viewer: GET list/detail → 200; POST/PATCH → 403
Given Driver (linked to driver 2): POST/PATCH → 403; GET /routes → 200 only driverId 2;
GET another driver's route → 403
Given Admin/Dispatcher: POST, PATCH, GET return 2xx (subject to AC-4/AC-5/AC-6)
And every rejected call writes nothing
```

**AC-8 — Delete-when-referenced 409s go live**
```
Given route R references vehicle 1, DELETE /vehicles/1 → 409, row unchanged
Given route R references driver 2, DELETE /drivers/2 → 409, row unchanged
Given a vehicle/driver referenced by no route, DELETE → 204 as before
```

**AC-9 — List/detail shape and filters**
```
GET /routes?page=1&pageSize=25&q=north&status=Planned&vehicleId=1&driverId=2
→ 200 PagedResponse envelope; items are RouteResponse; filters AND; q = name contains;
sort defaults to -createdAt; unknown status enum → 400
```

**AC-10 — Server-owned fields; no shipment writes**
```
POST/PATCH body containing id, status, createdAt or updatedAt → 400 errors.<field>
No rejected request is partially applied; no shipment.routeId is ever set here (LOGI-0010 owns it)
```

## 5. Out of scope (explicit)
- Shipment→route assignment + BR-5 capacity check — LOGI-0010; `shipment.route_id` never set here.
- Route status transitions (Planned → InProgress → Completed/cancel) — later ticket; PATCH never takes status.
- Planning board / kanban (LOGI-0011), dashboard + utilisation (LOGI-0012).
- Route delete, bulk create, CSV import, route audit history; vehicle/driver edits (LOGI-0004/0005, exc. AC-8).

## 6. Data touched
- Writes: `routes` INSERT (name, route_date, vehicle_id nullable FK, driver_id nullable FK, status=Planned)
  and UPDATE of name/route_date/vehicle_id/driver_id while Planned (+ server row timestamp).
- Reads: `routes` (detail + overlap guard), `vehicles`/`drivers` (existence); vehicle/driver DELETE reads
  `routes` for the AC-8 FK guard.
- Never: `shipments`, `route.status` via PATCH, `sla_due_at`/`priority`, at-risk columns.
- Migration: **new** — `routes` table (id, name 1..200, planned_start/planned_end per schema §routes,
  vehicle_id→vehicles nullable, driver_id→drivers nullable, status default Planned,
  created_at/updated_at; indexes on status/vehicle/driver per schema rules).

## 7. Open questions (BRD-checked defaults — decided, confirm at checkpoint)
BRD primacy applied: BR-3/BR-4 ("overlapping planned time windows") + PRD F9 ("planned start/end window",
"rejects overlapping assignments") + schema §routes (planned_start/planned_end) outrank my shorthand.
| # | Question | Default | Alternative |
|---|---|---|---|
| O1 | Unknown vehicleId/driverId → 404 or 422? | **404** — BRD/HLD are silent on the code; contract precedent rules: every resource GET-by-id is 404 (warehouses/vehicles/drivers/shipments), and LOGI-0004/0005/0007/0008 use 404 for dangling FKs. A vehicle/driver *is* a first-class resource, so a dangling vehicleId/driverId reads as "referenced resource does not exist". | 422 errors.vehicleId (rejected — no 422 exists anywhere in v1-openapi.yaml; introducing it would break the RFC7807 uniformity). |
| O2 | Double-booking scope? | **409 on BR-3/BR-4 window overlap** (plannedStart < other.plannedEnd AND other.plannedStart < plannedEnd) while both Planned/InProgress; terminal routes never conflict | Same-date blocking (rejected — BRD says windows, schema has planned_start/end) |
| O3 | Unassigned create allowed? | **Yes** — BRD §scope lists "manual route creation AND assignment" as one bullet but PRD F9 says "creates a route, assigns a vehicle and driver" as a flow, not an atomicity rule; schema §routes shows vehicle_id/driver_id without NOT NULL. Nullable FKs give the LOGI-0011 unassigned lane with zero BRD conflict. | Require both (rejected — blocks draft planning, contradicts schema nullability). |
| O4 | Driver list semantics? | **Own-routes only** — BR-6 ("Driver may only transition shipments on their own routes") + PRD F12 ("Driver sees only routes/shipments assigned to them") directly require it; F12 is should-have but its read rule is the only BR-6-consistent choice. | Exclude Driver (rejected — contradicts F12 and leaves drivers phoneless). |

## 8. Non-functional requirements
- POST/PATCH/GET /routes <300ms p95 on seeded volumes; all-or-nothing writes (re-read to assert).
- Overlap check + FK writes atomic in one transaction; ISO8601 UTC timestamps; plannedEnd must be after plannedStart.
- List page stays primary surface — no full reload on create/assign.

---

## Downstream artifacts (traceability)
- Contract: POST/GET /routes (createRoute/listRoutes), GET/PATCH /routes/{id} (getRoute/updateRoute),
  RouteRequest/RouteResponse (additive only).
- Migration: new `routes` table (backend confirms; only it appears as pending).
- Backend: CreateRouteCommand + validator (overlap guard), GetRouteQuery, UpdateRouteCommand, Driver scoping,
  AC-8 FK guards. Frontend: routes list + create/assign dialogs + gating. QA: routes.spec.ts (AC-1..AC-10).
