---
id: LOGI-0011
title: Planning board (kanban + list views)
status: spec_approved
owner_agent: spec-agent
created: 2026-09-30
depends_on:
  - LOGI-0007
  - LOGI-0009
  - LOGI-0010
---

## 1. Summary
As a **Dispatcher**, I want one screen that shows every shipment the organisation is currently
responsible for — grouped by status as a kanban board, or as a flat sortable list — so that I can
find the at-risk work and the unassigned backlog in one glance instead of scanning a list, a route
detail page and a spreadsheet (BRD §3 BO-3, PRD F11).

This ticket covers **one read-only aggregate endpoint**, `GET /api/v1/planning-board`, that projects
shipments, routes and the BR-5 capacity projection into a single response, plus the kanban and list
views built on it. The board is a **read projection** (§7 O3): every write it could imply — a status
transition (BR-7, LOGI-0006) or an assignment (BR-5, LOGI-0010) — already has its own endpoint with
its own guards and status-history row, and the board deliberately does not become a second entry
point to either.

No new table, column or enum value is required: `shipments.status`, `shipments.route_id`,
`shipments.sla_due_at` and the at-risk projection (BR-2) already exist and are only read here.

## 2. Actors & roles
- Admin: reads the board (200) — full organisation visibility.
- Dispatcher: reads the board (200); the primary daily user (PRD F11, BRD BO-3).
- Viewer: reads the board (200), read-only, consistent with Viewer being read-allowed on every v1 read.
- Driver: **403** on the board (§7 O1). BR-6 and the LOGI-0009/LOGI-0010 Driver rule both scope a
  Driver to their own route's shipments only; the Driver's surface is F12 "My routes", not the
  org-wide board. The Driver navigation does not link the board.

## 3. Preconditions
- The caller is authenticated with a JWT (`Authorization: Bearer …`); anonymous calls are 401.
- At least one warehouse exists (LOGI-0001) so shipments can reference an origin; a board with no
  shipments renders as six empty columns, which is a valid state, not an error.
- `shipments.route_id` exists (LOGI-0010) — it is what makes the unassigned lane (AC-5) meaningful.
- The BR-2 at-risk projection and the BR-5 capacity projection are computed read-time, exactly as
  LOGI-0007 and LOGI-0010 compute them; the board stores nothing.

## 4. Acceptance criteria (Given/When/Then)

Every criterion below must map to at least one automated test carrying a `// LOGI-0011 AC-n`
traceability comment.

**AC-1 — Kanban columns**
```
Given shipments exist in several statuses across several routes
When I GET /api/v1/planning-board
Then the response carries one column per BR-7 status in the fixed server order
    Pending, Assigned, InTransit, Delivered, Delayed, Cancelled
And every shipment appears in exactly one column, matching its own status
And each column's totalCount is the UNTRUNCATED number of cards in that column for the active filters
And a status with no shipments is present with totalCount 0 and an empty cards array
    (columns are never omitted)
And no shipment id appears in two columns
```

**AC-2 — List view over the same data**
```
Given the same filters as the kanban view
When I request the list projection
Then I receive one flat list of cards sorted by slaDueAt ascending by default, with createdAt
    ascending or descending selectable
And the list is paged with the standard envelope (page, pageSize, totalCount, totalPages)
And the list and the kanban view agree card-for-card: the same shipment ids, no extras on either side
```

**AC-3 — Filters compose and are echoed**
```
Given shipments in different statuses, priorities, warehouses and routes
When I filter by status=Pending AND priority=Express AND originWarehouseId=1 AND slaRisk=true
    AND routeId=7 AND q=SHP-000123 (any subset, all optional)
Then only shipments matching every supplied filter are returned, in both views
And the response echoes the applied filter set (including values not supplied, as null)
**AC-4 — Route cards carry the BR-5 capacity projection**
```
Given route R has vehicle V (capacityKg 1000) with 700kg of Assigned shipments
When the board renders R's card
Then the card reports capacity: { vehicleId V, capacityKg 1000, assignedWeightKg 700,
    remainingCapacityKg 300, shipmentCount N }
And a route with no vehicle reports capacityKg, vehicleId and remainingCapacityKg as null, and the UI
    reads "no vehicle assigned" — never 0, which would read as full
And the projection is numerically identical to GET /api/v1/routes/{R}/shipments
    (single source, LOGI-0010 — the board must not recompute BR-5 its own way)
```

**AC-5 — The unassigned lane is visible**
```
Given a Pending shipment S with routeId null
When I load the board with no filters
Then S is present in the Pending column
And the response reports unassignedTotalCount including S
And filtering by routeId=7 does NOT hide S — routeId is a filter, not an implicit equality on null,
    so narrowing by route stays the dispatcher's explicit choice
And the board never invents a synthetic "unassigned route" row; the lane is a count, not a route
```

**AC-6 — Authorization**
```
Given an anonymous, Viewer or Driver token
When I call GET /api/v1/planning-board
Then anonymous receives 401
And Viewer receives 200 with the same body an Admin receives
And Driver receives 403 with ProblemDetails (§7 O1)
```

**AC-7 — The board is read-only**
```
Given a loaded board
When I interact with any board control
Then every control is navigation, filtering, sorting, view switching or "load more" — no control
    changes shipment state
And GET /api/v1/planning-board is the only endpoint the board calls; a card's transition control lives
    on the shipment surface (LOGI-0006) and its assign control on the route surface (LOGI-0010)
And any write verb against /api/v1/planning-board or /api/v1/planning-board/{id}
    responds 405 Method Not Allowed
```

**AC-8 — Validation, bounds and truncation**
```
Given a caller supplies maxPerColumn=0, maxPerColumn=201, pageSize=0, pageSize=101,
    status=Bogus or priority=Urgent
When I call GET /api/v1/planning-board
Then I receive 400 with a ValidationProblem whose keyed errors map names each offending parameter
And nothing is mutated (the board holds no state)
And with maxPerColumn=50 and a column of 312 matching cards
Then that column returns 50 cards, totalCount 312, and truncated=true
```

**AC-9 — Determinism and consistency**
```
Given two identical consecutive requests with the same filters
When I compare the two responses
Then column order is identical and, within a column, card order is identical
And the default order is slaDueAt ascending with id ascending as the tiebreak, so equal due dates
    never reorder between requests
And every card id is unique within the response
And a card's status, routeId and atRisk value equal what GET /api/v1/shipments and
    GET /api/v1/shipments/{id} report for the same shipment at the same instant
    (the board reads the same source, never a stale cache)
```

**AC-10 — No regression**
```
## 5. Out of scope (explicit)
- **Drag-and-drop** — dropping a card between columns or onto a route. Each is a BR-7 transition or a
  BR-5 assignment that already has its own endpoint, guards and history row; a board write would be a
  second, differently-guarded entry point to both (§7 O3). Follow-up candidate, not v1.
- **Auto-assignment, route optimisation, load sequencing, multi-stop ordering** — out of scope v1
  (BRD §4.2).
- Route **status** transitions (Planned → InProgress → Completed / Cancelled) — the board reads route
  status, never changes it.
- Dashboard counts, SLA-risk widget and utilisation snapshot (LOGI-0012) — the board's per-column
  `totalCount` is a navigation aid, not a reporting aggregate; LOGI-0012 aggregates the board data.
- GPS tracking and third-party carriers (BRD §4.2).
- Saved / personal / shared filter sets, board column customisation, and any server-side persistence of
  a dispatcher's view. The filter set lives in the URL and the browser.
- Shipment creation, editing, cancellation and the transition endpoint (LOGI-0006/0007/0008) and
  route/assignment management (LOGI-0009/0010) — unchanged; the board only links to them.

## 6. Data touched
- **Writes: none.** The board is a pure read (§7 O3). No table, column, or history row is written by
  this ticket, which is also why the backend arm expects no migration.
- Reads: `shipments` (id, reference_code, status, priority, weight_kg, sla_due_at, route_id,
  origin_warehouse_id, destination_address, created_at), `routes` (id, name, status, vehicle_id,
  driver_id, planned_start, planned_end), `vehicles` (`capacity_kg` for the BR-5 projection, only for
  routes that have one).
- Computed read-time, never stored: the BR-2 at-risk flag and the BR-5 capacity projection
  (`assignedWeightKg` / `remainingCapacityKg` / `shipmentCount`).

Notes for the backend arm (decided here, recorded in plan §5.2):
- **One query source.** The board must project through the same shipment read model LOGI-0007 owns;
  a parallel "board query" that re-derives `atRisk` or the capacity total is how the two surfaces
  would silently disagree (AC-9).
- **Weight arithmetic in `decimal`, never `float`** — the same BR-5 boundary reason as LOGI-0010.
- **Counting is the expensive part.** `totalCount` per column is a group-by over the filtered set; the
  backend should compute the six counts in one pass rather than six paged queries.

## 8. Non-functional requirements
- `GET /planning-board` <300ms p95 at seeded volumes (~1000 shipments, ~20 routes), and <800ms at
## Downstream artifacts (traceability)
- **Contract** (additive only): `GET /planning-board` (`getPlanningBoard`, tag `Planning`,
  `x-roles: [Admin, Dispatcher, Viewer]`) with query params `status`, `priority`, `originWarehouseId`,
  `slaRisk`, `routeId`, `q`, `sort`, `maxPerColumn`; schemas `BoardShipmentCard`, `BoardRouteCard`,
  `BoardColumn`, `PlanningBoardResponse`. `RouteCapacityView` is reused by `$ref`, never redefined.
- **Migration:** none expected — `shipments.route_id` and the status enum already exist; the backend
  confirms at the start of its arm and adds an additive index only if the board query plan requires
  one (a `(route_id, status)` or `(status, sla_due_at)` index is the likely candidate).
- **Backend:** `GetPlanningBoardQuery` + validator + the `GET /planning-board` endpoint, the
  `BoardShipmentCard` / `BoardRouteCard` / `BoardColumn` DTOs, the single-pass group-by for column
  counts, and the Driver 403 (§7 O1).
- **Frontend** (`features/planning-board/**`): kanban and list views over one client hook, filter bar
  (status, priority, warehouse, at-risk, route, search), view switch, column collapse for the two
  terminal columns, capacity bar on each route card, and the "load more" affordance driven by
  `truncated`.
- **QA** (E2E, real API + throwaway SQLite, `tests/e2e/`): `support/planning-board.ts` helpers,
  `planning-board.spec.ts` (AC-1, AC-2, AC-3, AC-5, AC-8, AC-9), `planning-board-authz.spec.ts`
  (AC-6, AC-7), `planning-board-ui.spec.ts` (AC-1/AC-3/AC-4 through the screen), and a capacity
  parity assertion against `GET /routes/{id}/shipments` (AC-4).

## 7. Open questions (decided 2026-09-30 on BRD/PRD primacy — checkpoint answered)

Source order applied: BRD §4.1 → PRD F11 → HLD §5 → contract precedent. The full pro/con reasoning
for each row is recorded in `state/plans/LOGI-0011-architect.plan.md` §5.1, which the backend,
frontend and QA arms must read before implementing.

| # | Question | Decision | Basis | Rejected alternative |
|---|---|---|---|---|
| O1 | May a Driver read the org-wide board? | **No — 403.** The board is cross-organisation, while BR-6 and LOGI-0009/0010 both scope a Driver to their own route's shipments. A 200 would need an implicit filter the contract never describes, and the column `totalCount`s would mean "of what you may see" rather than "of the column" — untestable and unreadable. Viewer keeps read access, matching every other v1 read. | BR-6 + LOGI-0009/0010 Driver scoping + `x-roles` precedent | 200 with implicit own-route filtering (undocumented semantics, wrong counts); 403 for Viewer (Viewer is read-allowed everywhere in v1 and BRD §4.1 does not exclude it). |
| O2 | Which columns, in what order? | **All six BR-7 statuses in lifecycle order** (Pending, Assigned, InTransit, Delivered, Delayed, Cancelled), server-supplied and never omitted. Delivered and Cancelled are collapsed **in the UI by default** only; the API always returns all six, so the API never encodes a screen-size decision. | PRD F11 "columns = shipment status" + BR-7 exhaustiveness + BO-4 (Cancelled matters for the audit trail) | A fixed subset of columns (hides Cancelled, breaking audit visibility); merged Open / InTransit / Done columns (contradicts F11). |
| O3 | Can the board write? | **No — read-only in v1.** A drag is a BR-7 transition (LOGI-0006) and a drop-on-route is a BR-5 assignment (LOGI-0010); both already own their guards and history rows. The board reuses them by linking out, so BR-5 and BR-7 are enforced in exactly one place. | BR-5 + BR-7 + BO-4 attributable history | `PATCH /planning-board/{shipmentId}` (a second entry point to BR-7, guarded twice); optimistic UI with a local status flip (a board showing state the server never accepted is the failure this ticket exists to prevent). |
| O4 | Do route cards recompute the BR-5 capacity? | **No — reuse `RouteCapacityView` by `$ref`.** The board projects it from the same source as `GET /routes/{id}/shipments`, so the capacity bar can never disagree with the assignment dialog that enforces it. | BR-5 single source + LOGI-0010 contract | A board-local `boardCapacityKg` field (two implementations of one rule, guaranteed to drift). |

  ~5000 shipments — the board is the Dispatcher's landing page, so it is the most-requested read in
  the product.
- The board holds no server-side state: two identical requests are byte-comparable apart from
  `generatedAt` (AC-9).
- The board is usable at 1280px with six columns and degrades to horizontal scroll on a laptop; per
  §7 O2 the Delivered and Cancelled columns are collapsed by default in the UI only — the API always
  returns all six.
- Filtering is a query parameter, never a client-side fetch-and-filter over an unpaged list.
- All timestamps ISO8601 UTC. No partial render of a column: a column arrives with its `totalCount`
  and `truncated` flag or not at all.


Given the board is in use
When LOGI-0006/0007/0008/0009/0010 behaviour is exercised
Then their contracts, responses and status-history semantics are unchanged
And GET /api/v1/shipments keeps its own filters, paging and at-risk projection
And GET /api/v1/routes and GET /api/v1/routes/{id}/shipments are unaffected
```


And supplying no filter returns the unfiltered board
And q matches reference code or destination address, case-insensitively
```

