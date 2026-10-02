---
ticket: LOGI-0012
arm: frontend
status: locked
created: 2026-10-02T06:50:00.000Z
depends_on_plans:
  - state/plans/LOGI-0012-architect.plan.md
  - state/plans/LOGI-0012-backend.plan.md
---

## 1. Objective

LOGI-0012 frontend arm: sync the OpenAPI client, add the MSW mock for the read-only
`GET /api/v1/dashboard` aggregate, and build the manager's operations dashboard — one route holding
the six BR-7 status tiles, the SLA-at-risk list and the two utilization panels, over **one** client
hook reading **one** request.

The dashboard is read-only (spec §7, backend O2/O3). Every control is navigation, filtering or paging.
No tile computes a count, no row re-derives "at risk", and no bucket is summed client-side: the server
returned all of it at one captured instant and the screen is a pure rendering of that response. That
is what keeps AC-3 (tile and list cannot disagree) true end-to-end rather than only inside the API.

Three rules shape the client, all inherited from the architect and already proven by the backend:
- **One request.** The landing page issues exactly one `getDashboard` call. A fan-out of
  `/shipments` + `/vehicles` + `/drivers` would reintroduce the cross-request timing skew that
  `generatedAt` exists to eliminate, so the tiles are never sourced from a second endpoint.
- **One filter vocabulary.** The dashboard filter bar uses the *planning-board* filter fields
  (status, priority, originWarehouseId, routeId) because every one of them is already a
  `GET /shipments` filter (AC-6). No dashboard-only parameter is introduced.
- **Every tile links out.** A status tile drills to `GET /shipments?status=…`, the at-risk tile to
  `GET /shipments?slaRisk=true`, and a utilization bucket to `GET /vehicles?status=…` /
  `GET /drivers?status=…` — existing endpoints with the equivalent filter (AC-6), never a
  dashboard-only results route.

## 2. Touched files (WRITE manifest — the scope boundary)

| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/schema.d.ts` | regenerate (`npm run generate:api`) | AC-1..AC-8 — the `getDashboard` op and the `Dashboard*` / `*Utilization` / `AtRiskShipmentPage` types come from the contract, never hand-written | generated |
| `src/frontend/src/api/client.ts` | modify | AC-1/AC-3/AC-6/AC-8 — `getDashboard(params)` + aliases `DashboardResponse`, `StatusCount`, `DashboardAtRiskShipment`, `AtRiskShipmentPage`, `VehicleUtilization`, `DriverUtilization`, `GetDashboardParams` | ~45 |
| `src/frontend/src/features/auth/permissions.ts` | modify | AC-7 — `viewDashboard` = Admin/Dispatcher/Viewer, mirroring the op's `x-roles`; **Driver excluded** (spec §7 O1) | ~12 |
| `src/frontend/src/features/dashboard/schema.ts` | create | AC-1/AC-2/AC-4/AC-6 — tile ordering, at-risk formatting helpers (minutes-to-due, overdue emphasis), the drill-down link builder mapping a tile/bucket onto an existing endpoint, bucket-label helpers for the null-percent case | ~160 |
| `src/frontend/src/features/dashboard/hooks.ts` | create | AC-1/AC-2/AC-3/AC-9 — `dashboardKeys` + one `useDashboard(params)` read; no mutation hook, because the dashboard is read-only | ~55 |
| `src/frontend/src/features/dashboard/DashboardPage.tsx` | create | AC-1..AC-8 — filter bar, the six status tiles, the at-risk list with paging, the vehicle + driver utilization panels, loading/error/empty states | ~480 |
| `src/frontend/src/features/dashboard/StatusTile.tsx` | create | AC-1/AC-6 — a status tile whose count is the server's untruncated number, rendering in lifecycle order including the zero tiles | ~140 |
| `src/frontend/src/App.tsx` | modify | AC-7 — a "Dashboard" tab gated on `viewDashboard`, so a Driver never sees the surface the API 403s | ~15 |
| `src/frontend/src/mocks/handlers.ts` | modify | AC-1..AC-9 — the `/api/v1/dashboard` handler: six counts in lifecycle order incl. zeros, the at-risk page with the standard envelope and `slaDueAt`-then-id ordering, `atRiskTotalCount === totalCount` from one instant, utilization over the **existing** vehicle/driver status lists, 400 field-keyed validation, 401 anonymous, 403 Driver | ~230 |
| `src/frontend/src/features/dashboard/DashboardPage.test.tsx` | create | AC-1..AC-9 traceability, each case tagged `// LOGI-0012 AC-n` | ~460 |
| `memory/journal/LOGI-0012.md` | modify (tracker seal only) | frontend-arm journal section | via CLI |

## 3. Required files (READ-ONLY scope)

| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0012-operations-dashboard.md` | §4, §5, §7 | AC-1..AC-9, out-of-scope, and the O1-O4 decisions already implemented by the backend |
| `contracts/v1/components/schemas/dashboard.yaml` | 1-128 | the exact response shape: six `StatusCount`s, the at-risk envelope, the `ResourceUtilization` allOf pair |
| `state/plans/LOGI-0012-backend.plan.md` | §2, §5 | the handler's three governing rules, so the mock cannot encode a different one |
| `memory/journal/LOGI-0012.md` | architect + backend sections | the findings the backend recorded, esp. the keyed `errors` map and the Driver-403 confirmation |
| `src/frontend/src/api/client.ts` | 44-63, 356-378 | the type-alias block and `getPlanningBoard` the new method mirrors |
| `src/frontend/src/features/planning/PlanningBoardPage.tsx` | 1-403 | the filter-bar, tile-column and loading/error conventions the dashboard must match |
| `src/frontend/src/features/planning/schema.ts` | 1-119 | the board's filter-state/label helpers the dashboard filter bar reuses |
| `src/frontend/src/mocks/handlers.ts` | 1914-1990 | the `planning-board` handler style: `authorize`, role rules, composed filters, echoed filters, 400 field-keyed validation |
| `src/frontend/src/App.tsx` | 100-155 | tab wiring and the "Tab must stay a direct child of Tabs" constraint |
| `src/frontend/src/features/auth/permissions.ts` | 98-110 | the `viewPlanningBoard` precedent this capability mirrors |
## 4. Milestones (vertical slices)

- [x] 1. **M1 — Client + mock + AC-1..AC-5 coverage.** Regenerate `schema.d.ts` from the contract, add
      the `Dashboard*` aliases and `getDashboard(params)` to the client, add the `/api/v1/dashboard`
      MSW handler, and add `DashboardPage.test.tsx` covering: the six tiles in lifecycle order with
      zero counts present and untruncated numbers (AC-1), the at-risk list with a Delivered/Cancelled
      row never at risk while a Delayed one is, the `slaDueAt`-then-`id` ordering and the envelope
      (AC-2), `atRiskTotalCount` equal to the carried page's `totalCount` with one `generatedAt`
      (AC-3), the vehicle buckets with in-use capacity counting only InRoute and a Maintenance vehicle
      excluded (AC-4), and the driver buckets with a Suspended driver excluded (AC-5).
      → verify: `npm test` green; the new suite asserts only what the handler actually produces.

- [x] 2. **M2 — Drill-down, authz, validation, no regression.** Wire the Dashboard tab behind
      `viewDashboard`, add the filter bar, the drill-down links and the paging controls, and extend the
      suite: every tile and bucket link resolves to an existing endpoint with the equivalent filter and
      the dashboard defines no parameter `GET /shipments` does not accept (AC-6); the tab is absent
      for Driver and a direct call is 403 while Viewer/Dispatcher/Admin each get 200 (AC-7); an
      out-of-range `pageSize` and unknown `status`/`priority` surface the keyed `errors` map and the
      default page size is 20 (AC-8); the shipments, board, vehicles and drivers surfaces are
      unchanged (AC-9).
      → verify: `npm test` full suite green; `npx tsc --noEmit` 0 errors.

- [x] 3. **M3 — Arm verification.** Re-run `npx tsc --noEmit`, `npm run build` and `npm test` as the
      exit gates, confirm `schema.d.ts` matches `npm run generate:api` with no hand-invented endpoint
      and no dashboard mutation hook, seal the journal with the frontend-arm section, HANDOFF
      frontend→qa naming the Playwright surface (the manager landing page, the six tiles, the at-risk
      pager, the two utilization panels, the Driver-absent nav item), and update active state.
      → verify: `npx tsc --noEmit` 0 errors; `npm run build` clean; `npm test` all green; every
      AC-1..AC-9 carries a `// LOGI-0012 AC-n` marker; `git status --short` shows only §2 manifest
      paths; one atomic commit `feat(LOGI-0012): implement operations dashboard frontend arm`.

## 5. Risks / open questions

- **Driver 403 (spec §7 O1) is the load-bearing one.** The tab must be hidden for Driver, but the
  hidden tab is affordance hygiene only — the mock must independently return 403 for a Driver token on
  a direct `api.getDashboard` call, or AC-7 would assert a UI behaviour the real API lacks.
- **One request is the whole point (AC-3).** A tempting "simpler" UI would fetch `/vehicles` and
  `/drivers` for the utilization panels instead of reading `vehicleUtilization`/`driverUtilization`
  off the single dashboard response. That would put the panels on a different instant from the tiles,
  which is precisely the drift `generatedAt` exists to prevent. The panels render the response's own
  buckets and never refetch.
- **Null percent is not zero (AC-4/AC-5).** `utilizationPercent`/`capacityUtilizationPercent` are
  null when the denominator is 0 — an empty fleet is "no capacity", never "0% used". Rendering the
  null as `0%` would assert something false, so the helper returns an explicit "—" with a title.
- **Untruncated counts (AC-1).** The tiles render the server's `count`, which is the full number, not
  `items.length` from any page — and the at-risk list is a *page*, so its length is never a count.
  `atRiskTotalCount` is the tile's number; `atRiskShipments.totalCount` is the pager's, and AC-3 is
  precisely that they are equal.
- **The backend handoff summary named the wrong filter names.** That handoff prose said
  `slaRisk`/`warehouseId`/`carrierId`, but the locked contract params are `status`, `priority`,
  `originWarehouseId`, `routeId`, `page`, `pageSize`. The contract is authoritative; the filter bar and
  the drill-down links use the contract names, and the QA handoff will restate them.
- **Zero buckets are present, not omitted (AC-4/AC-5).** `byStatus` includes empty buckets with 0, so
  the panels render every status of the enum rather than only the ones that happen to have members —
  the same "never invent a missing tile" rule the status tiles follow.
- **No write, no drill (spec §7 O2/O3).** Nothing here mutates; rows and tiles link out to the existing
  surfaces instead of embedding a transition or an assignment control.

## 6. Exit gates

- `npx tsc --noEmit` and `npm run build` in `src/frontend` succeed with 0 errors.
- `npm test` in `src/frontend` passes every suite, including the new `DashboardPage.test.tsx`; all
  pre-existing LOGI-0006..0011 suites still pass (AC-9).
- Every AC-1..AC-9 is covered by at least one test carrying a `// LOGI-0012 AC-n` comment; no test
  asserts a 400/401/403 the mock does not actually produce.
- `src/frontend/src/api/schema.d.ts` matches `npm run generate:api` output; no hand-invented endpoint,
  no dashboard-specific filter parameter, and no dashboard mutation hook exists.
- `git status --short` shows only §2 manifest paths (plus tracker-derived state); one atomic commit
  for the arm.