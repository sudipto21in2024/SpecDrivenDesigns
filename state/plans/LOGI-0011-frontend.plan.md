---
ticket: LOGI-0011
arm: frontend
status: locked
created: 2026-10-01T08:00:00.000Z
depends_on_plans:
  - state/plans/LOGI-0011-architect.plan.md
  - state/plans/LOGI-0011-backend.plan.md
---

## 1. Objective

LOGI-0011 frontend arm: sync the OpenAPI client, add the MSW mock for the read-only
`GET /api/v1/planning-board` aggregate, and build the Dispatcher's planning board — a kanban view
plus a flat list view over **one** client hook, a composable filter bar, a view switch, the terminal
column collapse, the BR-5 capacity bar, and "load more" driven by `truncated`/`totalCount`.

The board is read-only in v1 (spec §7 O3). Every control is navigation, filtering, sorting, view
switching or load-more. A card links out to the shipment surface (transition, LOGI-0006) and its
route links to the route surface (assign, LOGI-0009/0010) rather than mutating anything here.

## 2. Touched files (WRITE manifest — the scope boundary)

| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/schema.d.ts` | regenerate (`npm run generate:api`) | AC-1..AC-9 — the op + the five `Board*`/`PlanningBoardResponse` types come from the contract, never hand-written | generated |
| `src/frontend/src/api/client.ts` | modify | AC-1/AC-3/AC-6/AC-8 — `getPlanningBoard(params)` + aliases `PlanningBoardResponse`, `BoardColumn`, `BoardShipmentCard`, `BoardRouteCard`, `BoardFilters`, `GetPlanningBoardParams` | ~40 |
| `src/frontend/src/features/auth/permissions.ts` | modify | AC-6 — `viewPlanningBoard` = Admin/Dispatcher/Viewer, mirroring the op's `x-roles`; **Driver excluded** (spec §7 O1) | ~12 |
| `src/frontend/src/features/planning/schema.ts` | create | AC-1/AC-2/AC-4 — column-order constant (the six BR-7 statuses), filter state <-> query-param mapping, sort helpers, terminal-column set | ~140 |
| `src/frontend/src/features/planning/hooks.ts` | create | AC-1/AC-2/AC-6/AC-9 — `planningBoardKeys` + one `usePlanningBoard(params)` read; no mutation hook, because the board is read-only | ~60 |
| `src/frontend/src/features/planning/PlanningBoardPage.tsx` | create | AC-1..AC-8 — filter bar, view switch, kanban board, list view, capacity bar, unassigned lane, load-more, empty/error states | ~520 |
| `src/frontend/src/features/planning/BoardCard.tsx` | create | AC-1/AC-4/AC-5/AC-7 — shipment card (reference, status, priority, atRisk, weight, SLA) and route card (status, dates, capacity bar with the explicit "no vehicle assigned" state) | ~220 |
| `src/frontend/src/App.tsx` | modify | AC-6 — a "Board" tab gated on `viewPlanningBoard`, so a Driver never sees the surface the API 403s | ~15 |
| `src/frontend/src/mocks/handlers.ts` | modify | AC-1..AC-9 — the `/api/v1/planning-board` handler: six columns in lifecycle order incl. empty, untruncated `totalCount`, `truncated` + `maxPerColumn` cap, composed filters + echoed `appliedFilters`, `sort`, `q`, 400 field-keyed validation, 401 anonymous, 403 Driver, capacity through the **existing** `toRouteCapacityView` | ~220 |
| `src/frontend/src/test/renderApp.tsx` | modify | reset parity if the board handler needs a new store helper | ~5 |
| `src/frontend/src/features/planning/PlanningBoardPage.test.tsx` | create | AC-1..AC-10 traceability, each case tagged `// LOGI-0011 AC-n` | ~480 |
| `memory/journal/LOGI-0011.md` | modify (tracker seal only) | frontend-arm journal section | via CLI |

## 3. Required files (READ-ONLY scope)

| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0011-planning-board.md` | §4, §5, §7 | AC-1..AC-10, out-of-scope, and the O1-O4 decisions the backend already implemented against |
| `contracts/v1-openapi.yaml` | planning-board op + board schemas | exact response shape, the eight query params, `x-roles`, ProblemDetails wiring |

## 4. Steps (each with verify gate)

- [x] 1. **M1 — Contract sync + logic (client, permissions, board schema, hooks, MSW handler).**
  Regenerate `schema.d.ts`; add `getPlanningBoard` + the five type aliases; add `viewPlanningBoard`
  (Driver excluded); create `features/planning/schema.ts` (column order, filter<->param mapping,
  sort helpers, terminal-column set) and `hooks.ts` (one query, params in the key); implement the
  `/api/v1/planning-board` MSW handler projecting from the existing `shipmentsDb` / `routesDb` so
  `atRisk` and the BR-5 capacity come from the same mock sources the other handlers read — with
  every guard: 401 anonymous, 403 Driver, 400 field-keyed for `maxPerColumn` 0/201 and enum
  violations, six columns always present in lifecycle order, `totalCount` untruncated, `truncated`
  set when capped, echoed `appliedFilters` with nulls for unsupplied filters, and `q` matching
  reference code or destination address case-insensitively.
  → verify: `npm run generate:api` yields no hand-edited drift, `npx tsc --noEmit` passes, and a
  scratch vitest spec exercises each 200/400/401/403 branch plus truncation against the mock.

- [x] 2. **M2 — Integration + UI (`PlanningBoardPage` + `BoardCard` + `App.tsx` tab).** Build the
  board over the single hook: the filter bar (status, priority, warehouse, `slaRisk`, route, `q`,
  sort) driving query params — never a client-side fetch-and-filter; the kanban/list view switch over
  the same response; the six columns with Delivered/Cancelled collapsed **in the UI by default only**
  (spec §7 O2 — the API still returns all six); per-column `load more` that raises `maxPerColumn`
  when `truncated` is true and never renders a wrong "50 of 312"; the capacity bar showing
  assigned/capacity/remaining with an explicit "no vehicle assigned" state rather than 0 (AC-4);
  the unassigned lane rendered as a **count**, never a synthetic route row (AC-5); and role gating
  so no board control mutates anything (AC-7). Add the `Board` tab to `App.tsx` behind
  `viewPlanningBoard` so a Driver never sees it.
  → verify: `npx tsc --noEmit` + `npm run build` pass; the full test suite still green.

- [x] 3. **M3 — Arm verification.** Write `PlanningBoardPage.test.tsx` covering AC-1..AC-10 with
  `// LOGI-0011 AC-n` comments: six columns incl. the empty one and no duplicate id (AC-1), list/kanban
  card-for-card agreement and sort switching (AC-2), composed filters + echo (AC-3), the capacity bar
  and its no-vehicle case matching the route-shipments capacity (AC-4), the unassigned lane
  surviving a `routeId` filter (AC-5), the per-role matrix incl. Driver's absent tab and direct 403

## 5. Risks / open questions

- **Driver 403 (spec §7 O1) is the load-bearing one.** The tab must be hidden for Driver, but the
  hidden tab is affordance hygiene only — the mock must independently return 403 for a Driver token
  on a direct `api.getPlanningBoard` call, or AC-6 would assert a UI behaviour the real API lacks.
- **Two views, one request (AC-2).** The list view must be a projection of the *same* board response,
  not a second paged `/shipments` call, or the two views could disagree card-for-card. The mock must
  therefore return the same ids for both readings of one response.
- **Truncation is a display contract (AC-8).** `totalCount` is untruncated; rendering
  `cards.length` as the count would silently show "50 of 312" as "50". `load more` raises
  `maxPerColumn` rather than paging, because the endpoint has no per-column cursor.
- **Capacity nulls (AC-4).** `toRouteCapacityView` already nulls `capacityKg`/`vehicleId`/
  `remainingCapacityKg` for a vehicle-less route; the bar must read "no vehicle assigned" there,
  and a 0 would read as full. Reuse the same helper the route-shipments handler uses so the board
  and the assignment dialog cannot disagree (spec §7 O4).
- **Terminal columns.** Collapsing Delivered/Cancelled is a UI default only. The mock returns all
  six regardless, and the UI test must assert the response carries all six while only four render
  expanded — otherwise the API would start encoding a screen-size decision.
- **routeId filter is not a null equality (AC-5).** The mock must not add "routeId filter implies
  routeId != null" semantics, and the unassigned lane is a count on the response, not a column.
- **No drag, no write (spec §7 O3).** Any temptation to add a transition control here is a second
  BR-7 entry point; cards link out to the shipment surface instead.

## 6. Exit gates

- `npx tsc --noEmit` and `npm run build` in `src/frontend` succeed with 0 errors.
- `npm test` in `src/frontend` passes every suite, including the new `PlanningBoardPage.test.tsx`;
  all pre-existing LOGI-0006..0010 suites still pass (AC-10).
- Every AC-1..AC-9 is covered by at least one test carrying a `// LOGI-0011 AC-n` comment; no test
  asserts a 400/401/403 the mock does not actually produce.
- `src/frontend/src/api/schema.d.ts` matches `npm run generate:api` output; no hand-invented
  endpoint, and no board mutation hook exists.
- `git status --short` shows only §2 manifest paths (plus tracker-derived state); one atomic commit
  for the arm.

  (AC-6), read-only controls (AC-7), truncation + `load more` + 400 surfacing (AC-8), determinism of
  column/card order (AC-9), and AC-10 on the pre-existing suites.
  → verify: `npm test` green in `src/frontend`, an AC-n comment for every AC, then seal +
  HANDOFF frontend→qa naming the Playwright surface.

| `src/frontend/src/api/client.ts` | 20-60, 300-330 | the type-alias block and the `listRouteShipments` method the new method must mirror |
| `src/frontend/src/mocks/handlers.ts` | 1605-1665, 1740-1842 | `toRouteCapacityView`, `shipmentsForRoute`, `authorize`/role-rule conventions and the route-shipments handler style |
| `src/frontend/src/features/routes/RouteShipmentsPanel.tsx` | 1-120 | the existing capacity banner the board's capacity bar must agree with (AC-4) |
| `src/frontend/src/features/routes/hooks.ts` | 1-50 | query-key + hook conventions |
| `src/frontend/src/App.tsx` | 100-147 | tab wiring and the "Tab must stay a direct child of Tabs" constraint |
