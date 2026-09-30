---
ticket: LOGI-0010
arm: backend
status: locked
created: 2026-09-30T07:15:04.223Z
depends_on_plans:
---

## 1. Objective
LOGI-0010 backend arm: implement assign/unassign/list shipments of a route (BR-5 capacity guard) per specs/features/LOGI-0010-assign-shipment-to-route.md AC-1..AC-10 and contracts/v1-openapi.yaml.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Domain/Shipment.cs` | modify (additive) | `AssignToRoute` / `UnassignFromRoute` + guard exceptions (AC-1, AC-3, AC-4, AC-6) | +70/-0 |
| `src/backend/LogiFlow.Application/Features/Routes/RouteShipmentCommands.cs` | create | assign + unassign commands, validators, handlers, BR-5 guard (AC-1..AC-6, AC-9) | ~230 |
| `src/backend/LogiFlow.Application/Features/Routes/RouteShipmentQueries.cs` | create | `ListRouteShipmentsQuery` + `RouteCapacityView` + Driver scoping (AC-7, AC-8) | ~120 |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | modify (additive) | `ExecuteInTransactionAsync` seam so the BR-5 read+write is one transaction (AC-9) | +12/-0 |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | modify (additive) | implement the transaction seam | +14/-0 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify (additive) | register the 3 new validators | +4/-0 |
| `src/backend/LogiFlow.Api/Endpoints/RoutePayloadParsers.cs` | modify (additive) | `ParseAssign` (field-keyed 400) (AC-5) | +28/-0 |
| `src/backend/LogiFlow.Api/Endpoints/RouteEndpoints.cs` | modify (additive) | 3 endpoints + role policies (AC-1, AC-6, AC-7, AC-8) | +55/-0 |
| `src/backend/LogiFlow.Api.Tests/RouteShipmentAssignTests.cs` | create | AC-1..AC-6, AC-9 | ~230 |
| `src/backend/LogiFlow.Api.Tests/RouteShipmentListTests.cs` | create | AC-7, AC-8, AC-10 | ~150 |
| `src/backend/LogiFlow.Api.Tests/LogiFlowTestFactory.cs` | modify (additive) | shared-cache in-memory SQLite so each request opens its OWN connection — AC-9's concurrent race is only observable with two connections (a single shared `SqliteConnection` cannot host two transactions, so the loser surfaced as 500 instead of the 409 the guard must produce) | +18/-4 |
| `state/plans/LOGI-0010-backend.plan.md` | modify | this plan (tick/lock) | ~55 |
| `memory/journal/LOGI-0010.md` | modify (append) | seal notes | ~25 |
| `state/events.jsonl`, `state/handoffs.jsonl`, `state/tasks.json`, `memory/active.md`, `memory/progress.md` | via CLI only | bookkeeping | — |

**No migration.** `shipments.route_id` already exists in the schema and in the deployed DB (the LOGI-0006
migration ships the column; only the routes FK was deferred to LOGI-0009, which created the table). This
arm adds no column and — deliberately — **no index on `shipments.route_id`**, because adding one would
put the model ahead of the migrations and break the "no pending model changes" promise LOGI-0008
recorded. See §5.

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0010-assign-shipment-to-route.md` | §§4 + 6 + 7 | the ACs and the four decided defaults (read once, already encoded in the steps below) |
| `state/plans/LOGI-0010-architect.plan.md` | §5.1 | the decision reasoning the implementation must honour |
| `src/backend/LogiFlow.Domain/Shipment.cs` | full | `TransitionTo` idiom, the `IllegalShipmentTransitionException` → 409 pattern to mirror |
| `src/backend/LogiFlow.Application/Features/Routes/RouteCommands.cs` | full | handler/validator idiom, `ConflictException` / `NotFoundException` usage |
| `src/backend/LogiFlow.Application/Features/Routes/RouteQueries.cs` | 12-36 | the Driver own-route scoping block to reuse for AC-7 |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentCommands.cs` | 13-18 + 64-96 + 168-190 | the ShipmentDto.From projection; the one-SaveChanges-is-one-transaction idiom |
| `src/backend/LogiFlow.Api/Endpoints/RouteEndpoints.cs` | full | endpoint + `RequireRoles` idiom |
| `src/backend/LogiFlow.Api/Endpoints/RoutePayloadParsers.cs` | 24-60 | `JsonElement` parse + field-keyed `ValidationFailure` idiom |
| `src/backend/LogiFlow.Api.Tests/RouteAssignTests.cs` | full | test idiom: real JWT clients, direct-SQLite seeding, reflection to force a non-Planned status |

## 4. Steps (each with verify gate)
- [x] 1. M1 — **Domain + BR-5 guard + assign/unassign commands.** `Shipment.AssignToRoute(routeId, changedByUserId, at)` and `Shipment.UnassignFromRoute(expectedRouteId, changedByUserId, at)`, both returning a `ShipmentStatusEvent` for the audit row; new `ShipmentNotAssignableException` (not Pending) and `ShipmentNotOnRouteException` (routeId mismatch) carrying messages the middleware surfaces as 409 ProblemDetails, mirroring `IllegalShipmentTransitionException`. `UnassignFromRoute` deliberately does **not** call `TransitionTo` (plan §5.1 O4 — BR-7 has no `Assigned → Pending` edge, so the generic validator must stay untouched). Then `RouteShipmentCommands.cs`: `AssignShipmentToRouteCommand` (+ validator `shipmentId > 0`) whose handler loads route (404) → asserts `Planned` (409) → loads shipment (404) → asserts `Pending` (409) → handles same-route idempotency (200, no write) and other-route (409) → sums `weight_kg` for `route_id = @id` → loads the route's vehicle `capacity_kg` when present and compares (409 with the assigned/adding/capacity numbers; **no vehicle = check skipped**); and `RemoveShipmentFromRouteCommand` (404 when the route/shipment is missing or the shipment is not on it, 409 when it has left `Assigned`). Both run inside `ExecuteInTransactionAsync` so the total is re-read inside the same transaction that writes (AC-9) → verify: `dotnet build src/backend/LogiFlow.sln` 0 errors; `dotnet test --filter FullyQualifiedName~RouteShipmentAssignTests` green.
- [x] 2. M2 — **Queries, endpoints, parsing, DI.** `RouteShipmentQueries.cs`: `RouteShipmentPageDto` (the `PagedResult<ShipmentDto>` fields + `RouteCapacityView(vehicleId, capacityKg, assignedWeightKg, remainingCapacityKg, shipmentCount)`), `ListRouteShipmentsQuery` (+ validator page/pageSize) projecting rows through the existing `ShipmentDto.From` (so AC-10's read-model parity is free) and the capacity view with `null` (never `0`) capacity for a vehicle-less route, plus the Driver own-route check copied from `GetRouteByIdHandler` (403 on another driver's route). `RoutePayloadParsers.ParseAssign` for the field-keyed 400 of AC-5. Three endpoints in `RouteEndpoints.cs` — `POST /{id:long}/shipments` (200, Admin+Dispatcher), `GET /{id:long}/shipments` (Admin+Dispatcher+Viewer+Driver), `DELETE /{id:long}/shipments/{shipmentId:long}` (204, Admin+Dispatcher). Validator registrations in `DependencyInjection.cs` → verify: `dotnet build` 0 errors; `dotnet test --filter FullyQualifiedName~RouteShipmentListTests` green; the three new routes answer 401 anonymous.
- [x] 3. M3 — **Arm verification.** `RouteShipmentAssignTests.cs` (AC-1 happy path incl. exactly one history row and the route row untouched; AC-2 two-fit-then-409 with the numbers in `detail` and a byte-identical shipment, plus the vehicle-less skip; AC-3 unknown route 404 + non-Planned 409; AC-4 unknown shipment 404, terminal status 409, other-route 409, same-route idempotent 200; AC-5 empty/missing/0/negative 400 keyed `shipmentId`; AC-6 unassign 204 + back to Pending + one `Assigned → Pending` history row + freed capacity reusable + the three 404/409 shapes; AC-9 two concurrent boundary assigns → exactly one 200 and one 409) and `RouteShipmentListTests.cs` (AC-7 401/403 + Driver own-route-only + Viewer 403 on writes; AC-8 paged envelope + the capacity numbers + null-not-zero for a vehicle-less route + invalid page 400 + unknown route 404; AC-10 the assigned shipment still reads back through `GET /shipments` and `GET /shipments/{id}/status-history` unchanged). Then confirm **no migration is pending** (`dotnet ef migrations has-pending-model-changes` → "No changes were detected") and that the whole LOGI-0006/0007/0008/0009 suite still passes → verify: `dotnet test src/backend/LogiFlow.Api.Tests` green with every new test carrying a `// LOGI-0010 AC-n` marker; the pre-existing count still passes with no test edited.

## 5. Risks / open questions
- **Weight arithmetic is `double`, not `decimal` (spec §8 asked for `decimal`).** `shipments.weight_kg`
  and `vehicles.capacity_kg` are `REAL` in the approved schema and `double` in the domain
  (`Shipment.WeightKg`, `Vehicle.CapacityKg`). Switching either to `decimal` is a schema change the
  approved schema forbids and this ticket does not ask for, so the guard sums in SQL over the *same*
  storage type the row is written in — the comparison is therefore exactly consistent with what is
  persisted, which is the property that actually matters for BR-5. The residual risk is a
  representation artefact at the exact boundary (e.g. 0.1+0.2), which the AC-2 test pins using whole
  kilograms. **Recorded as a deviation, not silently ignored**; a follow-up ticket may migrate both
  columns to a fixed-point type.
- **The BR-5 sum has no index.** The sum is `WHERE route_id = @id`, and no index on `route_id` exists
  (adding one would create a pending model change and force a migration, contradicting the deliberate
  "no migration" promise). At BRD §7 volumes (≤50k shipments/year) this is a scan over a small table
  and the NFR (<300ms) holds. **Follow-up:** a later ticket may add `ix_shipments_route_id` together
  with whatever dashboard query first needs it.
- **Concurrency is enforced by re-reading the total inside the write transaction, not by a lock.** A
  route-row lock would be the textbook answer, but SQLite serialises writers anyway and v1 is
  single-node (ADR-005), so the transaction is the portable expression of the same guarantee. A
  reviewer-visible requirement: the total **must** be read after the transaction opens.
- **`IAppDbContext` gains a transaction seam.** The Application layer already depends on EF Core
  (`AnyAsync`, `CountAsync`), so this is consistent, but the seam is a method rather than an exposed
  `Database` property so the transaction stays an implementation detail of Infrastructure.
- **Driver read scoping duplicates the LOGI-0009 block** in `GetRouteByIdHandler`. Two call sites is
  below the threshold for extracting a shared helper; extracting it is left to the arm that adds the
  third (LOGI-0011's board), with a comment pointing there.

## 6. Exit gates
- `dotnet build src/backend/LogiFlow.sln` 0 errors; `dotnet test src/backend/LogiFlow.Api.Tests` green
  with no pre-existing test edited.
- AC-1..AC-10 each covered by at least one test carrying a `// LOGI-0010 AC-n` marker.
- `dotnet ef migrations has-pending-model-changes` → "No changes were detected" (no migration shipped,
  `shipments.route_id` reused).
- Every write goes through one `SaveChangesAsync` inside the transaction seam: `route_id`, `status`
  and the history row are all-or-nothing.
- Unassign does not route through `Shipment.TransitionTo` (BR-7 untouched) and the BR-6 Driver scoping
  is enforced on the list read.
- Journal sealed, HANDOFF backend→frontend written naming the frontend scope, one atomic commit.

