---
id: LOGI-0012
title: Operations dashboard (counts, SLA-risk, utilization)
status: planned
owner_agent: spec-agent
created: 2026-10-01
depends_on:
  - LOGI-0007
  - LOGI-0004
  - LOGI-0005
  - LOGI-0011
---

## 1. Summary
As an **Ops Manager**, I want one screen that tells me how the operation is doing right now — how
many shipments sit in each status, which of them are going to breach their SLA, and how much of the
fleet and the driver pool is actually deployable — so that I can decide in sixty seconds whether
today needs intervention, instead of exporting a list and counting rows in a spreadsheet
(BRD BO-2, PRD F14, PRD §5.3).

This ticket covers **one read-only aggregate endpoint**, `GET /api/v1/dashboard`, that projects
shipments, vehicles and drivers into a single response, plus the dashboard built on it. Like the
planning board (LOGI-0011), the dashboard is a **read projection** (§7 O2): every number it shows is
already owned by `GET /shipments` (BR-2 at-risk projection), `GET /vehicles` and `GET /drivers`, so
no write, no cached aggregate and no second copy of a business rule is introduced.

No new table, column or enum value is required. `shipments.status`, `shipments.sla_due_at`,
`vehicles.status` and `drivers.status` already exist and are only read here. In particular the
`at_risk` flag stays a **read-time projection** exactly as `Docs/business-rules/BR-sla-rules.md`
rule 2.5 and §5 require — a persisted flag would need a BRD revision and would go stale the moment a
status changes.

## 2. Actors & roles
- Admin: reads the dashboard (200) — full organisation visibility (BRD §4.1).
- Dispatcher: reads the dashboard (200) — the same operational picture the board gives, in numbers.
- Viewer: reads the dashboard (200), read-only, consistent with Viewer being read-allowed on every
  v1 read.
- Driver: **403** on the dashboard (§7 O1). BR-6 and the LOGI-0009/LOGI-0010 Driver rule both scope a
  Driver to their own route's shipments only; the Driver's surface is F12 "My routes", not an
  org-wide management view. The Driver navigation does not link the dashboard.

## 3. Preconditions
- The caller is authenticated with a JWT (`Authorization: Bearer …`); anonymous calls are 401.
- The BR-2 at-risk projection, the vehicle/driver status enums and the standard `PagedResponse`
  envelope already exist (LOGI-0002, LOGI-0004, LOGI-0005, LOGI-0007). The dashboard computes
  nothing new; it reuses those definitions verbatim.
- A dashboard over an empty database is a valid state, not an error: every count is 0 and the
  at-risk list is an empty first page.

## 4. Acceptance criteria (Given/When/Then)

Every criterion below must map to at least one automated test carrying a `// LOGI-0012 AC-n`
traceability comment.

**AC-1 — Counts by status**
```
Given shipments exist in several BR-7 statuses
When I GET /api/v1/dashboard
Then the response carries one entry per status in the fixed server order
    Pending, Assigned, InTransit, Delivered, Delayed, Cancelled
And a status with no shipments is present with count 0 (entries are never omitted)
And each count is the UNTRUNCATED number of shipments in that status for the active filters
And the counts are computed over the same filter set the at-risk list uses
```

**AC-2 — SLA-at-risk list**
```
Given shipments exist whose sla_due_at is within 2 hours
When I GET /api/v1/dashboard
Then atRiskTotalCount is the number of shipments satisfying BR-2
    (now >= sla_due_at - 2h AND status NOT IN { Delivered, Cancelled }, whole-second UTC)
And atRiskShipments is a page of those shipments sorted by slaDueAt ascending with id ascending
    as the tiebreak, using the standard envelope (page, pageSize, totalCount, totalPages)
And each row carries referenceCode, status, priority, slaDueAt and minutesToDue
And a shipment with no sla_due_at is never at risk (BR-2 rule 2.7)
And a Delayed shipment is at risk and cannot escape by being delayed (BR-2 rule 2.4)
```

**AC-3 — The tile and the list cannot disagree**
```
Given any active filter set
When I read the dashboard response
Then atRiskTotalCount equals the totalCount of the at-risk page it carries
And every shipment in the page is itself at risk under the same generatedAt instant
And the whole response is evaluated at a single captured instant, exposed as generatedAt,
    so no count and no row is computed against a different now
```

**AC-4 — Vehicle utilization**
```
Given vehicles exist across statuses
When I GET /api/v1/dashboard
Then vehicleUtilization reports the total vehicle count and a per-status breakdown over
    Available, InRoute, Maintenance
And inUseCapacityKg is the summed capacityKg of the InRoute vehicles
And totalCapacityKg is the summed capacityKg of every vehicle
And capacityUtilizationPercent is inUseCapacityKg / totalCapacityKg, or null when
    totalCapacityKg is 0 (an empty fleet is "no capacity", never "0% used")
And a Maintenance vehicle is never counted as available capacity
```

**AC-5 — Driver utilization**
```
Given drivers exist across statuses
When I GET /api/v1/dashboard
Then driverUtilization reports the total driver count and a per-status breakdown over
    Active, OffDuty, Suspended
And utilizationPercent is the Active count over the total driver count, or null when there
    are no drivers at all
And a Suspended driver is never counted as available capacity
```

**AC-6 — Drill-down, not a second query language**
```
Given the dashboard is rendered
When the user clicks a status tile, the at-risk tile, or a utilization bucket
Then the target is an existing endpoint with the equivalent filter —
    GET /api/v1/shipments?status=…, GET /api/v1/shipments?slaRisk=true,
    GET /api/v1/vehicles?status=…, GET /api/v1/drivers?status=…
And the dashboard defines no query parameter that GET /shipments does not already accept
And following the link shows exactly the rows the tile counted
And every dashboard parameter — including routeId — is one GET /shipments accepts
    (routeId was added to GET /shipments by this follow-up so the vocabulary is
    genuinely shared and the drill-down is lossless in both directions)
```

**AC-7 — Authorization**
```
Given an anonymous, Driver, Viewer, Dispatcher and Admin caller respectively
When each calls GET /api/v1/dashboard
Then anonymous is 401 and Driver is 403
And Viewer, Dispatcher and Admin each receive 200
```

**AC-8 — Validation and determinism**
```
Given a pageSize outside 1..100 or an unknown status/priority enum value
When I GET /api/v1/dashboard
Then the response is 400 with a keyed errors map naming each offending parameter
And with no pageSize supplied, the default is 20
And two identical requests against unchanged data are byte-comparable apart from generatedAt
And the dashboard stores nothing: no aggregate table, no cached at_risk column (BR-2 rule 2.5)
```

**AC-9 — No regression**
```
Given the dashboard is in use
When LOGI-0006/0007/0008/0009/0010/0011 behaviour is exercised
Then their contracts, responses and status-history semantics are unchanged
And GET /api/v1/shipments keeps its own filters, paging and at-risk projection
And GET /api/v1/planning-board, /vehicles and /drivers are unaffected
```

## 5. Out of scope (explicit)
- Historical SLA-performance reporting (on-time rate over time, trend charts). `BR-sla-rules.md` §5
  places SLA reporting over time outside v1; the dashboard is a *now* snapshot.
- Any persisted `at_risk` / `breached` column or SLA history table (`BR-sla-rules.md` §5). Revisiting
  this needs an ADR, and only if dashboard p95 breaches 300ms.
- Alerting on breach — e-mail, push, escalation (`BR-sla-rules.md` §5).
- Per-driver or per-vehicle shift/duty-hour utilization; v1 has no duty-time data (§7 O3).
- Saved/personal dashboard widgets or layout preferences.
- Route optimisation, GPS tracking, billing, mobile native app (PRD §4 "Won't have (v1)").
- Automatic re-planning or expediting of at-risk shipments (`BR-sla-rules.md` §5).
- Any write path: the dashboard creates nothing (§7 O2), the same read-only posture as LOGI-0011 O3.

## 6. Data touched
Read-only, from tables already owned by earlier tickets:
- `shipments` — `status`, `sla_due_at`, `priority`, `origin_warehouse_id`, `destination_address`,
  `route_id` (LOGI-0007, LOGI-0010).
- `vehicles` — `status`, `capacity_kg` (LOGI-0004).
- `drivers` — `status` (LOGI-0005).

No migration, no new column, no new index is introduced by this ticket. The BR-2 at-risk test and the
per-status aggregations are evaluated at read time, exactly as `GET /shipments` and
`GET /planning-board` already evaluate them.

## 7. Open questions (decided 2026-10-01 on BRD/PRD primacy — checkpoint answered)

Source order applied: BRD §4.1/§6 → PRD F14/§5.3 → HLD §5 → LOGI-0011 contract precedent. The full
pro/con reasoning for each row is recorded in `state/plans/LOGI-0012-architect.plan.md` §5.1, which
the backend, frontend and QA arms must read before implementing.

| # | Question | Decision | Basis | Rejected alternative |
|---|---|---|---|---|
| O1 | May a Driver read the dashboard? | **No — 403.** The dashboard is cross-organisation while BR-6 and LOGI-0009/0010 both scope a Driver to their own route. A 200 would need an implicit filter the contract never describes, and the utilization figures would mean "of what you may see" rather than "of the fleet". Viewer keeps read access, matching every other v1 read. | BR-6 + LOGI-0009/0010 Driver scoping + LOGI-0011 O1 precedent | 200 with implicit own-route filtering (undocumented semantics, wrong denominators); 403 for Viewer (Viewer is read-allowed everywhere in v1). |
| O2 | May `at_risk` be persisted for dashboard speed? | **No — read-time projection.** BR-2 rule 2.5 and `BR-sla-rules.md` §5 already forbid a stored flag, and §6 says revisit only "with an ADR if dashboard p95 exceeds 300ms". | `Docs/business-rules/BR-sla-rules.md` rule 2.5, §5, §6 | A persisted `at_risk` column (needs a BRD revision, and goes stale the moment a status changes). |
| O3 | What is "utilization"? | **Status-bucket counts + a capacity-weighted percent, not a percentage of hours worked.** The PRD says "available vs in-route/off-duty", the schema already models exactly those buckets, and v1 has no shift or duty-time data to compute anything else. | PRD F14 + `VehicleResponse`/`DriverResponse` enums | A time-based utilization % (no duty-hour data exists in v1; a definition the data cannot support is worse than the honest bucket count). |
| O4 | Does the dashboard define its own filters and paging? | **No — it reuses the shipment list's filter vocabulary and the standard `PagedResponse` envelope.** AC-6 makes the drill-down into `GET /shipments` lossless. | LOGI-0011 AC-2/AC-3 + `PagedResponse` precedent | A dashboard-specific filter DSL (the tile and the list it links to could then disagree). |

## 8. Non-functional requirements
- **Performance (PRD §6 NFR):** the dashboard is the heaviest read in the product — it must respond
  in **<300ms p95** at 50k shipments/year. The at-risk test, the per-status aggregations and the
  utilization buckets must be computable in a single query pass per source table, evaluated at one
  captured instant. If the budget is missed the fallback is an ADR, not a persisted `at_risk` flag
  (§7 O2).
- The dashboard holds no server-side state: two identical requests are byte-comparable apart from
  `generatedAt` (AC-8).
- All timestamps are ISO8601 UTC truncated to whole seconds, per the `BR-sla-rules.md` precision rule.
- Percentages are returned as numbers 0..100 with two decimals; a null denominator is `null`, never
  `0` and never `100` (AC-4/AC-5).
- The dashboard is usable at 1280px and degrades to vertical stacking on a phone; tiles never rely on
  colour alone to convey status (PRD §6 WCAG 2.1 AA).
- Loading the dashboard issues **one** request, not a fan-out of six (BO-3 administrative-time goal).

## Downstream artifacts (traceability)
- Contract: `GET /api/v1/dashboard` in `contracts/v1/paths/dashboard.yaml`; schemas `StatusCount`,
  `DashboardAtRiskShipment`, `ResourceUtilization`, `VehicleUtilization`, `DriverUtilization`,
  `DashboardResponse` in `contracts/v1/components/schemas/dashboard.yaml`.
- Backend: one aggregate query handler + a `DashboardResponse` DTO mapping, project-only.
- Frontend: one dashboard route (manager landing page) rendering tiles, the at-risk list and the two
  utilization panels; every tile links out per AC-6.
- QA: a test per AC above, each tagged `// LOGI-0012 AC-n`, plus the non-regression sweep of AC-9.


