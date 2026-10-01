---
ticket: LOGI-0011
arm: backend
status: locked
created: 2026-09-30T16:20:00.000Z
depends_on_plans: LOGI-0011-architect
---

## 1. Objective
Implement the LOGI-0011 planning board read path: `GetPlanningBoardQuery` + validator + handler and the
`GET /api/v1/planning-board` endpoint, returning the six BR-7 columns, the route cards with the BR-5
capacity projection, the applied-filter echo and the unassigned count. **Read-only** (spec O3): no
command, no migration, no write path.

Two rules govern the shape of the handler and both come straight from the spec:
- **One query source.** Cards project through `ShipmentDto.From(s, now)` — the same factory
  `GET /shipments` uses — so `atRisk` cannot drift between the board and the list (AC-9).
- **One BR-5 implementation.** Route cards reuse `RouteCapacityViewFactory` rather than
  re-deriving the load (spec O4), so the capacity bar cannot disagree with the assignment guard.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Application/Features/Planning/PlanningBoardDtos.cs` | create | the 5 board DTOs (cards, columns, filters, response) | ~65 |
| `src/backend/LogiFlow.Application/Features/Planning/PlanningBoardFilters.cs` | create | the shared filter set mirroring LOGI-0007 (AC-3) | ~48 |
| `src/backend/LogiFlow.Application/Features/Planning/PlanningBoardQueries.cs` | create | query, validator, handler | ~150 |
| `src/backend/LogiFlow.Api/Endpoints/PlanningBoardEndpoints.cs` | create | GET /planning-board, roles, query binder | ~47 |
| `src/backend/LogiFlow.Application/Features/Routes/RouteShipmentQueries.cs` | modify (visibility only) | RouteCapacityViewFactory made public for O4 reuse | +3/-1 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify (+2 lines) | register the validator (per-type convention) | +2/-0 |
| `src/backend/LogiFlow.Api/Program.cs` | modify (+1 line) | `app.MapPlanningBoardEndpoints();` | +1/-0 |
| `src/backend/LogiFlow.Api.Tests/PlanningBoardFixture.cs` | create | shared seeding + JSON-navigation helpers | ~150 |
| `src/backend/LogiFlow.Api.Tests/PlanningBoardColumnTests.cs` | create | AC-1..AC-3 coverage | ~98 |
| `src/backend/LogiFlow.Api.Tests/PlanningBoardReadTests.cs` | create | AC-4, AC-5 coverage | ~87 |
| `src/backend/LogiFlow.Api.Tests/PlanningBoardContractTests.cs` | create | AC-8, AC-9 coverage | ~108 |
| `src/backend/LogiFlow.Api.Tests/PlanningBoardAuthzTests.cs` | create | AC-6 authz + AC-7 read-only proof | ~131 |
| `state/plans/LOGI-0011-backend.plan.md` | modify | this plan (tick/lock) | ~55 |
| `memory/journal/LOGI-0011.md` | modify | backend-arm section | ~10 |
| `state/events.jsonl` | append via CLI only | STEP_DONE bookkeeping | — |
| `state/handoffs.jsonl` | append via CLI only | backend→frontend handoff | — |
| `state/tasks.json` | update via CLI only | status transitions | — |
| `memory/active.md` | update via CLI only | active state | — |
| `memory/progress.md` | update via CLI only | progress row | — |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0011-planning-board.md` | §§1-8 via spec slicer | ACs, O1 Driver 403, O2 column order, O3 read-only, O4 capacity reuse |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentQueries.cs` | 91-164 | the filter + SlaRisk + ordering idiom to mirror (AC-3, AC-9) |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentCommands.cs` | 168-190 | the ShipmentDto.From projection the board MUST reuse |
| `src/backend/LogiFlow.Application/Features/Routes/RouteShipmentQueries.cs` | 20-40, 102-137 | `RouteCapacityView` + `RouteCapacityViewFactory` (spec O4) |
| `src/backend/LogiFlow.Application/Features/Shipments/SlaPolicy.cs` | full | `IsAtRisk`, `AtRiskCutoff`, `TruncateToSeconds`, `ExemptStatuses` |
| `src/backend/LogiFlow.Domain/ShipmentStatus.cs` | 19-32 | the lifecycle-ordered ShipmentStatusValues.All list (spec O2) |
| `src/backend/LogiFlow.Api/Endpoints/RouteEndpoints.cs` | 1-30 | endpoint + `RequireRoles` pattern |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | 40-58 | per-type validator registration convention |
| `src/backend/LogiFlow.Api.Tests/RouteShipmentListTests.cs` | 1-70 | fixture + sign-in + seed idiom for the new tests |
| `contracts/v1/paths/planning-board.yaml` | full | the contract the implementation must match |
## 4. Steps (each with verify gate)
- [x] 1. M1 — Application slice: create `Features/Planning/PlanningBoardQueries.cs` with the five DTOs (`BoardShipmentCard` projecting via `ShipmentDto.From`, `BoardRouteCard` carrying a reused `RouteCapacityView`, `BoardColumn`, `BoardFilters`, `PlanningBoardResponse`), `GetPlanningBoardQuery` (status, priority, originWarehouseId, slaRisk, routeId, q, sort, maxPerColumn), its validator (unknown enum/sort → 400, `maxPerColumn` 1..200 per AC-8), and the handler. Handler rules: one `now = SlaPolicy.TruncateToSeconds(DateTime.UtcNow)` for the whole response (AC-9); filters mirror `ListShipmentsHandler` so `slaRisk` uses the same SQL-translatable bound and `q` the same case-insensitive contains (AC-3); one `GroupBy(status)` pass for the six untruncated `totalCount`s instead of six paged queries (spec §6 note); columns built from `ShipmentStatusValues.All` so the order is lifecycle order by construction and empty columns are still emitted (O2/AC-1); per-column `Take(maxPerColumn)` with `truncated = count > maxPerColumn` (AC-8); ordering `slaDueAt` asc with `id` asc tiebreak (AC-9); `unassignedTotalCount` = filtered rows with `RouteId == null` (AC-5); route cards via `RouteCapacityViewFactory.BuildAsync` (O4). Register the validator in `DependencyInjection.cs` per the per-type convention and map the endpoint in `Program.cs`.
  → verify: `dotnet build` 0 errors 0 warnings.

- [x] 2. M2 — Endpoint + coverage: create `PlanningBoardEndpoints.cs` mapping `GET /api/v1/planning-board` with `RequireAuthorization()` + `RequireRoles(Admin, Dispatcher, Viewer)` so Driver is 403 (O1) and anonymous 401 (AC-6). Then `PlanningBoardTests.cs` (AC-1 six columns always present, lifecycle order, unique membership; AC-2 the empty board; AC-3 AND-composition + filter echo; AC-4 capacity parity against `GET /routes/{id}/shipments` including the no-vehicle null case; AC-5 unassigned lane and routeId not excluding it; AC-8 400s for out-of-range/unknown values plus truncation flags; AC-9 determinism across two identical calls and card/shipment-endpoint agreement) and `PlanningBoardAuthzTests.cs` (AC-6 per role incl. Driver 403; AC-7 POST/PATCH/DELETE against the board path return 405).
  → verify: `dotnet test` full suite green with no pre-existing test edited; every AC carries a `// LOGI-0011 AC-n` marker.

- [x] 3. M3 — Close the arm: confirm read-only at the DB level (`dotnet ef migrations has-pending-model-changes` → no changes, since O3 forbids a write path), re-run build + test as the exit gates, seal the journal with the backend-arm section, HANDOFF backend→frontend naming the client contract (`getPlanningBoard`, the 8 params, the DTOs, Driver 403 so the nav hides the board), and update active state.
  → verify: `dotnet build` 0 errors; `dotnet test` all green; `has-pending-model-changes` reports no changes; `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0011-backend.plan.md` 0 errors; `git status --short` shows only §2 manifest paths; one atomic commit `feat(LOGI-0011): implement planning board backend arm`.

## 5. Risks / open questions

### 5.1 Decisions inherited from the architect arm (do not re-litigate)
- **O1 — Driver is 403.** The endpoint simply omits `Driver` from `RequireRoles`, so the handler needs
  no role branch and no own-route scoping. That is *why* the LOGI-0010 comment promising "the third
  call site is LOGI-0011's board" does not come due: with O1 there is no third Driver call site, so
  the shared driver-scoping helper stays deferred to F12. If that forward-reference still names the
  board as its third call site, correct it in this arm.
- **O2 — six columns, never omitted.** Built from `ShipmentStatusValues.All`, which is already in
  lifecycle order, so the order is correct by construction rather than by a literal that can drift.
- **O3 — read-only.** No command, no migration. The endpoint is `MapGet` only; AC-7's 405 for other
  verbs falls out of the routing table and the test proves it.
- **O4 — capacity reused.** `RouteCapacityViewFactory` is `internal static` in the Routes namespace
  and the board needs it from the Planning namespace, so its accessibility must widen. Prefer moving
  only the visibility, never the implementation — a second capacity calculation would violate O4.

### 5.2 Risks
- **N+1 on route cards.** Each `RouteCapacityView` runs three queries, and the board returns all
  routes at once, so this is where the shared factory's per-route cost bites. Accepted in v1 (routes
  number in the tens, not thousands) and recorded, rather than writing a divergent batch capacity
  implementation that would violate O4.
- **Board vs list ordering disagree by design.** `GET /shipments` defaults to newest-first while the
  board defaults to `slaDueAt` ascending (AC-9). Intentional and specified; a future ticket must not
  "unify" them by changing the board default, which would break its deadline-first purpose.
- **Group-by counts over the wrong set.** The six `totalCount`s must be computed over the *filtered*
  set, not the whole table, or AC-3 leaks filtered-out shipments through the counts even while `cards`
  is correct.