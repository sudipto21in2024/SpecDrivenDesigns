---
ticket: LOGI-0012
arm: backend
status: locked
created: 2026-10-02T05:10:00.000Z
depends_on_plans: LOGI-0012-architect
---

## 1. Objective
Implement the LOGI-0012 operations dashboard read path: `GetDashboardQuery` + validator + handler and the
`GET /api/v1/dashboard` endpoint, returning the six untruncated BR-7 status counts, the BR-2 SLA-at-risk
page in the standard envelope, and the vehicle/driver utilization snapshots. **Read-only** (spec O2): no
command, no migration, no persisted `at_risk` column.

Three rules govern the shape of the handler, and all three come straight from the architect decisions:
- **One instant.** `generatedAt = SlaPolicy.TruncateToSeconds(DateTime.UtcNow)` is captured once and is the
  `now` for the cutoff bound, for every minutes-to-due figure and for the echoed `generatedAt`, so the tile
  and the list it carries cannot disagree (AC-3, architect section 5.2 "Aggregation drift").
- **One filter implementation.** The dashboard reuses the LOGI-0011 `PlanningBoardFilters` predicate rather
  than a second copy, because AC-6 makes every dashboard filter a `GET /shipments` filter; two filter
  implementations is exactly how the tile and the drill-down list would drift.
- **One utilization definition.** Bucket keys are the *existing* `VehicleCommands.Statuses` /
  `DriverCommands.Statuses` value sets, so the buckets are the schema's own enums and a Maintenance or
  Suspended member can never be folded into an "available" number (O3, AC-4, AC-5).

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Application/Features/Dashboard/DashboardDtos.cs` | create | StatusCount, DashboardAtRiskShipment, ResourceUtilization, VehicleUtilization, DriverUtilization, DashboardFilters, DashboardResponse | ~90 |
| `src/backend/LogiFlow.Application/Features/Dashboard/DashboardQueries.cs` | create | query, validator, handler (counts, at-risk page, utilization) | ~185 |
| `src/backend/LogiFlow.Application/Features/Planning/PlanningBoardFilters.cs` | modify (signature only) | add a filter-set overload the dashboard reuses; the existing Apply delegates to it (AC-6) | +25/-6 |
| `src/backend/LogiFlow.Api/Endpoints/DashboardEndpoints.cs` | create | GET /dashboard, roles, query binder, contract defaults | ~50 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify (+2 lines) | register the validator (per-type convention) | +2/-0 |
| `src/backend/LogiFlow.Api/Program.cs` | modify (+1 line) | map the dashboard endpoints | +1/-0 |
| `src/backend/LogiFlow.Api.Tests/DashboardFixture.cs` | create | shared seeding + JSON navigation helpers | ~160 |
| `src/backend/LogiFlow.Api.Tests/DashboardStatusCountTests.cs` | create | AC-1, AC-3 coverage | ~95 |
| `src/backend/LogiFlow.Api.Tests/DashboardAtRiskTests.cs` | create | AC-2, AC-3 coverage | ~110 |
| `src/backend/LogiFlow.Api.Tests/DashboardUtilizationTests.cs` | create | AC-4, AC-5 coverage | ~100 |
| `src/backend/LogiFlow.Api.Tests/DashboardContractTests.cs` | create | AC-6, AC-8, AC-9 coverage | ~120 |
| `src/backend/LogiFlow.Api.Tests/DashboardAuthzTests.cs` | create | AC-7 coverage | ~95 |
| `state/plans/LOGI-0012-backend.plan.md` | modify | this plan (tick/lock) | ~160 |
| `memory/journal/LOGI-0012.md` | modify | backend-arm section | ~15 |
| `state/events.jsonl` | append via CLI only | STEP_DONE bookkeeping | — |
| `state/handoffs.jsonl` | append via CLI only | backend-to-frontend handoff | — |
| `state/tasks.json` | update via CLI only | status transitions | — |
| `memory/active.md` | update via CLI only | active state | — |
| `memory/progress.md` | update via CLI only | progress row | — |


## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0012-operations-dashboard.md` | AC-1..AC-9 via the spec slicer `--section ac`; section 7 via `--section defaults` | the 9 ACs and O1..O4 |
| `contracts/v1/paths/dashboard.yaml` | full | the 6 query params, x-roles and responses the endpoint must match |
| `contracts/v1/components/schemas/dashboard.yaml` | full | the exact response field names and nullability |
| `src/backend/LogiFlow.Application/Features/Planning/PlanningBoardQueries.cs` | 46-116 | the handler idiom to mirror: one captured now, one group-by, the shared shipment projection |
| `src/backend/LogiFlow.Application/Features/Planning/PlanningBoardFilters.cs` | full | the filter set being widened for reuse (AC-6) |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentQueries.cs` | 66-163 | the list filter/paging/ordering idiom and the 1..100 pageSize rule |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentCommands.cs` | 168-190 | the shipment read model the at-risk row projects from |
| `src/backend/LogiFlow.Application/Features/Shipments/SlaPolicy.cs` | full | the cutoff, exempt statuses, second-truncation and priority helpers |
| `src/backend/LogiFlow.Domain/ShipmentStatus.cs` | 19-40 | the lifecycle-ordered status value list (AC-1 order) |
| `src/backend/LogiFlow.Domain/Vehicle.cs` | full | capacity and status for the capacity-weighted percent (AC-4) |
| `src/backend/LogiFlow.Domain/Driver.cs` | full | status for the driver buckets (AC-5) |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleCommands.cs` | 18 | the authoritative status list — never re-literal the enum |
| `src/backend/LogiFlow.Application/Features/Drivers/DriverCommands.cs` | 21 | the authoritative status list for drivers |
| `src/backend/LogiFlow.Application/Common/PagedResult.cs` | full | the standard envelope the at-risk page must use field-for-field |
| `src/backend/LogiFlow.Api/Endpoints/PlanningBoardEndpoints.cs` | full | endpoint, RequireRoles and explicit-binding pattern |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | 40-58 | per-type validator registration convention |
| `src/backend/LogiFlow.Api.Tests/PlanningBoardFixture.cs` | 1-80 | fixture, sign-in and seed idiom for the new tests |
| `src/backend/LogiFlow.Api.Tests/PlanningBoardAuthzTests.cs` | full | the per-role 401/403 assertion pattern |

## 4. Steps (Vertical Slice Milestones — each with verify gate)
- [x] 1. M1 — Application slice: create `Features/Dashboard/DashboardDtos.cs` with the seven DTOs
  (StatusCount, DashboardAtRiskShipment projecting from the shared shipment read model plus a
  minutes-to-due helper, ResourceUtilization, VehicleUtilization, DriverUtilization, DashboardFilters, and
  DashboardResponse whose at-risk page is a `PagedResult<DashboardAtRiskShipment>` — the standard
  envelope, not a look-alike) and `Features/Dashboard/DashboardQueries.cs` with `GetDashboardQuery`
  (status, priority, originWarehouseId, routeId, page=1, pageSize=20), its validator (unknown status/priority
  gives 400 through the known-value helpers; `page >= 1`; `pageSize` 1..100 per the contract) and the
  handler. Handler rules: **one** captured now and one cutoff for the whole response (AC-3); the filter set
  applied through the shared `PlanningBoardFilters` overload (AC-6); a **single** group-by pass over the
  filtered query for the six counts, emitted from the lifecycle-ordered status list so all six are present
  including zeros (AC-1); the at-risk set derived from the *same filtered query* by the same
  `sla_due_at <= cutoff && !ExemptStatuses.Contains(Status)` bound the shipments list uses (BR-2, AC-2), a
  count for `atRiskTotalCount`, ordering by `SlaDueAt` asc with `Id` asc tiebreak, and `Skip/Take` for the
  page; utilization via one group-by pass per resource plus a capacity sum over the InRoute vehicles and over
  all vehicles (AC-4/AC-5), with both percents **null** when the denominator is 0 and the bucket
  dictionaries seeded from the vehicle/driver status lists so zero buckets are present. Widen
  `PlanningBoardFilters` with a value-level overload and make the existing board entry point delegate to it
  (no behaviour change). Register the validator in `DependencyInjection.cs` per the per-type convention.
  → verify: `dotnet build` 0 errors 0 warnings; `dotnet test` full suite still green with no pre-existing
  test edited (the board is the regression canary for the `PlanningBoardFilters` change).

- [x] 2. M2 — Endpoint + coverage: create `DashboardEndpoints.cs` mapping `GET /api/v1/dashboard` with
  `RequireAuthorization()` + `RequireRoles(Admin, Dispatcher, Viewer)` so anonymous is 401 and Driver is 403
  (O1/AC-7), binding the six optional parameters explicitly and applying the contract defaults exactly as
  `PlanningBoardEndpoints` does. Map it in `Program.cs`. Then the five test files: `DashboardStatusCountTests`
  (AC-1 six entries always present in lifecycle order including the zero statuses; counts untruncated when
  more rows exist than the page size; counts follow every active filter; AC-3 `atRiskTotalCount` equals the
  at-risk page `totalCount` and every carried row is itself at risk), `DashboardAtRiskTests` (AC-2 a
  Delivered/Cancelled row and a row with no due date are never at risk while a Delayed one is; ordering by
  due date ascending with the id tiebreak; the paging envelope; minutes-to-due negative once overdue and
  null with no promise), `DashboardUtilizationTests` (AC-4/AC-5 bucket counts with zero buckets present, the
  in-use capacity counting only InRoute vehicles, a Maintenance vehicle excluded from in-use capacity, and
  the null-percent-when-empty cases for both resources), `DashboardContractTests` (AC-8 400 with a keyed
  `errors` map for out-of-range `pageSize` and unknown status/priority enums, the default page size of 20,
  two identical calls byte-comparable apart from `generatedAt`; AC-6 every dashboard filter maps onto an
  existing `GET /shipments` filter and the at-risk total equals that list's `slaRisk=true` `totalCount` under
  the same filters; AC-9 the shipments, planning-board, vehicles and drivers responses unchanged), and
  `DashboardAuthzTests` (AC-7 per role).
  → verify: `dotnet test` full suite green; every AC carries a `// LOGI-0012 AC-n` traceability comment.

- [x] 3. M3 — Arm verification: confirm read-only at the DB level (`dotnet ef migrations
  has-pending-model-changes` reports no changes, since O2 forbids a persisted aggregate and AC-8 requires
  that the dashboard stores nothing), re-run build + test as the exit gates, seal the journal with the
  backend-arm section, HANDOFF backend-to-frontend naming the client contract (the `getDashboard`
  operation, the 6 params, the response shape, the drill-down targets, and the Driver 403 so the nav hides
  the dashboard), and update active state.
  → verify: `dotnet build` 0 errors; `dotnet test` all green; `has-pending-model-changes` reports no changes;
  `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0012-backend.plan.md` 0 errors; `git status
  --short` shows only section 2 manifest paths; one atomic commit
  `feat(LOGI-0012): implement operations dashboard backend arm`.


## 5. Risks / open questions

### 5.1 Decisions inherited from the architect arm (do not re-litigate)
- **O1 — Driver is 403.** `RequireRoles(Admin, Dispatcher, Viewer)` omits Driver, so the handler needs no
  role branch and no own-route scoping. That is *why* the LOGI-0010 comment promising a third Driver call
  site still does not come due; if that forward-reference names the dashboard as its third call site,
  correct it in this arm.
- **O2 — no persisted at-risk flag.** The at-risk set is a read-time projection over the shipment table. A
  persisted column would violate BR-2 rule 2.5 and AC-8; if the p95 budget is ever missed the fallback is an
  ADR, not a column.
- **O3 — utilization is bucket counts plus a capacity-weighted percent.** No hours-worked figure is defined
  because v1 has no duty-hour data. The buckets must come from the existing vehicle and driver status lists,
  not a fresh literal, so a schema change cannot silently desync them.
- **O4 — reuse the list's filter vocabulary and the standard envelope.** No dashboard-specific filter DSL:
  AC-6 is only satisfiable if the dashboard's notion of "matching" is literally the list's.

### 5.2 Risks
- **Two filter implementations.** The strongest failure mode is a dashboard predicate that differs from the
  shipments list in one clause: the tile then counts rows the drill-down list will not show. The mitigation
  is structural — the dashboard calls the *shared* filter overload, and `DashboardContractTests` asserts
  parity against the shipments list rather than against a hand-written expectation.
- **Minutes-to-due is a second SLA computation.** The rule itself stays in `SlaPolicy`; only the whole-minute
  rendering of an already-fetched due date against the already-captured now belongs in the DTO. A shipment
  can cross the 2h boundary between two requests, so the tests must seed due dates clearly inside or clearly
  outside the window rather than exactly on the boundary.
- **Utilization percent precision.** The capacity ratio is a `double`; round to 2 decimals so two identical
  requests stay byte-comparable (AC-8) and the JSON carries no float noise.
- **Empty-fleet semantics.** A zero total must yield a null utilization percent and a null capacity percent,
  not `0` — the contract's "no capacity, never 0% used" is a real assertion (AC-4/AC-5), and a `0` would be
  indistinguishable from a genuinely idle fleet.
- **AC-1 untruncated vs AC-2 paged.** The status counts and the at-risk total are totals over the filtered
  set while only the at-risk page is paged. Computing the counts from the returned page would make the tiles
  silently wrong on any dashboard holding more rows than the page size; the group-by must run before
  `Skip/Take`.

## 6. Exit gates
- `dotnet build` reports 0 errors and 0 warnings.
- `dotnet test` is fully green with no pre-existing test edited.
- Every AC-1..AC-9 carries at least one `// LOGI-0012 AC-n` marker in the new test files.
- `dotnet ef migrations has-pending-model-changes` reports no changes (read-only arm, O2).
- `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0012-backend.plan.md` reports 0 errors.
- `git status --short` lists only section 2 manifest paths; one atomic commit
  `feat(LOGI-0012): implement operations dashboard backend arm`.

