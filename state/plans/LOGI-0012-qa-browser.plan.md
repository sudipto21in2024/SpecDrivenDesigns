---
ticket: LOGI-0012
arm: qa
status: locked
created: 2026-10-04T06:41:52.242Z
depends_on_plans:
  - state/plans/LOGI-0012-frontend-followup.plan.md
---

## 1. Objective

LOGI-0012 qa follow-up #2: **prove the route-scoped drill-down works in a real browser**, the one
milestone the previous qa arm deliberately skipped and the last evidence before the ticket closes.

Chain so far, and where each stopped:

- architect: added `routeId` to `GET /shipments` in the contract (additive).
- backend: implemented the filter (238/238), semantics identical to `PlanningBoardFilters.Apply`.
- qa #1: proved the **API** agreement route-scoped (`dashboard-route-drilldown.spec.ts`, 3 cases) and
  found the browser half still lossy.
- frontend: closed the three client links — regenerated `schema.d.ts`, `client.listShipments` now
  serializes `routeId`, and `ShipmentsPage` hydrates its filters from `window.location` through the
  lazy `useState` initialiser in `shipmentsFilterParams.ts` (155/155).

None of that has been exercised **in a browser**. The frontend arm's own risk section says so: its
evidence is unit tests over a pure parser plus MSW, and "MSW is not proof — the mock already accepts
routeId, so frontend tests can go green while the real API disagrees."

This arm writes one spec that closes that gap:

1. **Assert the tile href carries `routeId`.** Necessary but NOT sufficient — `shipmentListHref` has
   always emitted it, even while the API ignored the parameter entirely, so an href-only assertion
   would have passed against the fully broken code. It is kept because it pins the query shape
   (status + routeId, target `/shipments`) the followed-link case then depends on.
2. **FOLLOW the link and assert the rendered rows.** The assertion with teeth: the shipments table must
   show the seeded route's rows and must NOT show the other route's row or the unassigned one. This is
   the step that fails if any of the three client links is reverted, and the only place the browser's
   own navigation is involved.
3. **Assert the URL the list page sits on** still carries `routeId` and the tile's status, so a
   "it happened to render the right rows by coincidence" outcome stays distinguishable.

## 2. Touched files (WRITE manifest — the scope boundary)

| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/dashboard-drilldown-browser.spec.ts` | create | AC-6 traceability: the tile href, the FOLLOWED link, and the rendered rows the previous arms could not reach | ~140 |
| `state/plans/LOGI-0012-qa-browser.plan.md` | create (via CLI) | this arm's milestones | via CLI |
| `memory/journal/LOGI-0012.md` | modify (tracker seal only) | qa-browser journal section | via CLI |

No existing spec, page object or support module is edited. Everything needed already exists:
`DashboardPage.filterByRouteId` / `tileLink` / `hrefOf`, `ShipmentsPage.row` / `table` / `goto`,
`seedRoute`, `seedDashboardShipment` (with its `routeId` option and per-run `dashboardTag` reference
codes), and `slaMinutesFromNow`. `dashboard-route-drilldown.spec.ts` is left exactly as written — its
API-level cases remain the right place for the tile-vs-list numeric agreement, and duplicating them in
the browser would add runtime without adding evidence.

## 3. Required files (READ-ONLY scope)

| Path | Lines | What's needed |
|---|---|---|
| `tests/e2e/dashboard-route-drilldown.spec.ts` | 46-82 | `seedTwoRoutes`, whose exclusion-row statuses were chosen deliberately (`Delayed`, not `Pending`, so planning-board's unpaged Pending read stays under its page cap) — the browser spec must honour the same reasoning |
| `tests/e2e/pages/dashboard.page.ts` | 48-53, 98-103, 127-129 | `tileLink`, `filterByRouteId`, `hrefOf` |
| `tests/e2e/pages/shipments.page.ts` | 23-28, 46-56 | `goto`, `table`, `row(text)` |
| `src/frontend/src/features/dashboard/schema.ts` | 128-148 | `shipmentListHref` — the exact href shape being asserted |
| `src/frontend/src/features/shipments/shipmentsFilterParams.ts` | 84-127 | the parser and the projection, so the spec asserts what the page really does rather than what it should |

## 4. Milestones (vertical slices)

- [ ] 1. **M1 — the browser drill-down, followed.** Seed two routes plus an unassigned row (exclusion
      rows `Delayed`, for the reason recorded in the API spec above), open the dashboard as a
      Dispatcher, `filterByRouteId(routeId)`, assert the Pending tile's href targets `/shipments` with
      both `status=Pending` and `routeId=<id>`, then CLICK it and assert the rendered table shows the
      route's row and neither the other route's row nor the unassigned one. Tagged `// LOGI-0012 AC-6`.
      → verify: `cd tests/e2e && npx playwright test dashboard-drilldown-browser.spec.ts` green; no raw
      selector in the spec (page objects only).

- [ ] 2. **M2 — at-risk drill-down, the same chain one filter deeper.** The at-risk tile builds
      `slaRisk=true` instead of `status=`, so it exercises the tri-state parse path (`triState`) rather
      than the enum path. Seed a route with one at-risk and one healthy shipment, follow the at-risk
      link and assert only the at-risk row rendered. Without this, "it works" would rest on one branch
      of the parser.
      → verify: same spec file green.

- [ ] 3. **M3 — whole-suite gate, no regression.** The frontend arm touched `ShipmentsPage` and the
      client, so the full Playwright suite must stay green. Check the API run log for SQLITE_BUSY /
      no-such-table, `check-size.mjs` on the new spec, `validate-plan` 0 errors, and `git status --short`
      showing only §2 paths.
      → verify: `npx playwright test` all green with no pre-existing spec edited; clean API run log.

## 5. Risks

- **A passing browser test that proves nothing.** Three ways this arm could fool itself, carried over
  from the API spec's risk list: asserting the href only (it always had routeId); asserting only that
  the page loaded (an unfiltered org-wide list loads fine AND contains the route's own rows, so only
  the EXCLUDED-row assertions fail when the filter is missing); and asserting a count rather than rows
  (a coincidental match would still pass). Every case therefore asserts the excluded reference codes
  are absent from the table.
- **Row visibility is the whole claim.** The list page pages its results, so extra org-wide rows could
  push the route's row off page 1 and make the positive assertion flaky. The tile href carries
  `status=`, which excludes most of the backlog server-side, and this spec seeds nothing beyond the
  rows it asserts on.
- **Following the link is SPA navigation.** `StatusTile` calls `preventDefault()` and routes through
  the injected navigator, so the click is not a full page load. The spec must wait on the shipments
  table, not on a load event, or it will assert against the old DOM.
- **Org-wide data.** Both screens are org-scoped; every assertion is scoped to this run's own route
  and warehouse, made unique by `dashboardTag()` and `uniqueRef()`.
- **Suite runtime.** M3 is the expensive gate (165+ tests) and runs last, so targeted failures surface
  first.

## 6. Exit gates

- `npx playwright test` in `tests/e2e` is fully green with no pre-existing spec edited.
- Every new case carries a `// LOGI-0012 AC-6` marker.
- No raw selector in the new spec — page objects only.
- `node tools/plan/validate-plan state/plans/LOGI-0012-qa-browser.plan.md` reports 0 errors.
- `check-size.mjs` clean on the new spec (under 150).
- `git status --short` lists only §2 paths; one atomic commit `test(LOGI-0012): verify the route-scoped drill-down in the browser`.
