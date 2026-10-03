---
ticket: LOGI-0012
arm: qa
status: locked
created: 2026-10-03T07:05:00.000Z
depends_on_plans:
  - state/plans/LOGI-0012-backend-followup.plan.md
---

## 1. Objective

LOGI-0012 qa follow-up: **prove the route-scoped drill-down is lossless end-to-end**, which is the
whole point of the two arms that preceded this one.

The chain so far: the original qa arm found that `GET /dashboard` accepted `routeId` while
`GET /shipments` did not, so AC-6 was false and a route-scoped tile linked to a list filtered by
nothing. It could not test the fix, because the fix did not exist. The architect arm closed the
contract; the backend arm implemented it (238/238). This arm verifies the three surfaces agree.

Three things must hold, and each is a different failure mode:

- **The API honours the filter.** `GET /shipments?routeId=N` returns only that route's rows. This was
  the real defect: nothing rejected unknown query parameters, so before the backend arm the
  parameter bound to nothing and silently returned the unfiltered list.
- **The tile and the list agree on the same route.** A route-scoped dashboard's status count and its
  at-risk total must equal what the equivalent `GET /shipments` call reports, row for row.
- **The browser link carries the filter.** `shipmentListHref` already sets `routeId` on the drill-down
  href. That was true even while the API ignored it, so the href assertion alone would have passed
  against the broken code — the test must ALSO follow the link and check the rendered rows.

That third point is why a pure API test is not enough here, and why this arm does not simply extend
the existing AC-6 case: that case scoped by `originWarehouseId` because `routeId` was unusable, and its
comment records the substitution explicitly. This arm adds the route-scoped comparison the original
case could not make.

## 2. Touched files (WRITE manifest — the scope boundary)

| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/dashboard-route-drilldown.spec.ts` | create | AC-6 traceability: the route-scoped API agreement, the drill-down href, and the followed-link rows the original qa arm could not test | ~150 |
| `state/plans/LOGI-0012-qa-followup.plan.md` | create (via CLI) | this arm's milestones | via CLI |
| `memory/journal/LOGI-0012.md` | modify (tracker seal only) | qa-followup journal section | via CLI |

No existing spec, page object or support module is edited. The dashboard support module already
exports seedDashboardShipment with a routeId option, the shipments support module already exports
listShipments taking a routeId (its query type is already a permissive record), and the dashboard
page object already has filterByRouteId and hrefOf. The existing AC-6 case in dashboard.spec.ts is
left exactly as written, including its FINDING comment — it is a true record of why that case scoped
by warehouse, and rewriting it would erase the history this arm exists to close.

## 3. Required files (READ-ONLY scope)

| Path | Lines | What's needed |
|---|---|---|
| `tests/e2e/dashboard.spec.ts` | 378-438 | the original AC-6 case and the FINDING comment recording that routeId was unusable then |
| `tests/e2e/support/dashboard.ts` | 121-208 | `dashboardTag`, `SeedDashboardOptions`, `seedDashboardShipment` — the seeding and org-wide scoping rule |
| `tests/e2e/support/shipments.ts` | 223-272 | `ShipmentListQuery` and `listShipments`, the endpoint helper this arm compares against |
| `tests/e2e/pages/dashboard.page.ts` | 98-129 | `filterByRouteId` and `hrefOf`, the browser-side accessors |
| `src/frontend/src/features/dashboard/schema.ts` | 125-148 | `shipmentListHref`, which sets routeId on the drill-down target |
| `memory/journal/LOGI-0012.md` | qa-arm + backend-followup sections | the original finding and what the two follow-up arms changed |

## 4. Milestones (vertical slices)

- [ ] 1. **M1 — the API agreement, route-scoped.** Seed a route with shipments in several statuses,
      one of them at risk, plus an unassigned shipment and a second route's shipment so a widened
      filter would be caught. Then assert a route-scoped dashboard's counts and at-risk total equal
      what `GET /shipments` reports for the SAME routeId, and that neither the unassigned row nor the
      other route's row appears. Tagged `// LOGI-0012 AC-6`.
      → verify: `cd tests/e2e && npx playwright test dashboard-route-drilldown.spec.ts` green.

- [ ] 2. **M2 — the browser link, followed rather than trusted.** Drive the real UI: filter the
      dashboard by route, read the tile's href, assert it targets `/shipments` carrying `routeId`, then
      CLICK it and assert the rendered shipment list shows the route's rows and not the excluded ones.
      Following the link is what makes this meaningful: the href already contained routeId while the
      API ignored it, so an href-only assertion would pass against the broken code.
      → verify: the same spec file green; no raw selector in the spec (page object only).

- [ ] 3. **M3 — whole-suite gate, no regression.** The full Playwright suite must stay green, because
      the backend arm changed a filter chain that LOGI-0007's list specs and LOGI-0011's board specs
      both exercise. Check the API log for SQLITE_BUSY / no-such-table, and confirm `git status` shows
      only §2 paths.
      → verify: `npx playwright test` all green with no pre-existing spec edited; clean API run log.

## 5. Risks

- **A test that passes against the broken code is worse than no test.** The three ways this arm could
  have fooled itself: asserting only the href (routeId was always in it), asserting only that the
  parameter is accepted (a 400-only suite would pass while the filter did nothing), or asserting an
  unfiltered count (the dashboard is org-wide, so that measures other specs' rows). Each case below
  is written to fail if the filter were reverted.
- **Org-wide scoping.** The dashboard support module records the load-bearing rule: an unfiltered
  dashboard read contains rows seeded by every other spec. Every assertion here is scoped by this
  run's own routeId, which dashboardTag() makes unique.
- **The existing AC-6 case is not evidence against this arm.** It scopes by `originWarehouseId` and
  passes both before and after the fix. That is correct — it was never claiming to cover routeId — but
  it means the suite going green proves nothing about the route filter. This arm's file is what does.
- **Suite runtime.** The full suite is 162 tests; M3 is the expensive one and is gated last so the
  cheap, targeted failures surface first.
