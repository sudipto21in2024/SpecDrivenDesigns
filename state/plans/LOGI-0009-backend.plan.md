---
ticket: LOGI-0009
arm: backend
status: locked
created: 2026-09-27T14:38:05.138Z
depends_on_plans:
---

## 1. Objective
LOGI-0009 backend arm: implement F9 Create/Assign Route - POST /api/v1/routes (Planned, nullable vehicle/driver FKs), PATCH /api/v1/routes/{id} (Planned-only partial edit/assign with server-owned-key + empty-body 400s), GET list/detail with Driver own-routes scoping, BR-3/BR-4 window-overlap double-booking 409, unknown-FK 404, and AC-8 vehicle/driver delete-when-referenced 409. New routes migration. Local gate: dotnet build + dotnet test LogiFlow.sln.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Domain/Route.cs` | create | Route aggregate: `Create`/`AssignOrUpdate`, Planned-only guard, `RouteStatusValues` (AC-1/2/3/6) | ~95 |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | modify | add `DbSet<Route> Routes` (AC-1..AC-8) | ~2 |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | modify | map `routes` table (snake_case, planned_start/end, nullable FKs Restrict, indexes) (AC-1/AC-8) | ~30 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/LOGI-0009_AddRoutes.cs` | create | EF migration for the new `routes` table (spec §6) | ~70 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/LogiFlowDbContextModelSnapshot.cs` | modify | EF-regenerated snapshot incl. `routes` | auto |
| `src/backend/LogiFlow.Application/Features/Routes/RouteCommands.cs` | create | `RouteDto` + Create/Update commands+validators+handlers; FK 404, Planned guard, window-overlap 409 (AC-1..AC-6, AC-10) | ~240 |
| `src/backend/LogiFlow.Application/Features/Routes/RouteQueries.cs` | create | List (filters AND, q=name contains, sort -createdAt, Driver own-routes scoping) + Get-by-id (404 / cross-driver 403) (AC-1/AC-7/AC-9) | ~150 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify | register the four route validators per-type | ~6 |
| `src/backend/LogiFlow.Api/Endpoints/RouteEndpoints.cs` | create | GET/POST `/`, GET/PATCH `/{id}`; `RequireRoles` per `x-roles`; `JsonElement` body→command mapper (presence + server-owned reject + empty-body) (AC-1..AC-10) | ~120 |
| `src/backend/LogiFlow.Api/Program.cs` | modify | `app.MapRouteEndpoints()` | ~1 |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleCommands.cs` | modify | `DeleteVehicleHandler` → route-reference `ConflictException` (AC-8) | ~6 |
| `src/backend/LogiFlow.Application/Features/Drivers/DriverCommands.cs` | modify | delete handler → route-reference `ConflictException` (AC-8) | ~6 |
| `src/backend/LogiFlow.Api.Tests/RouteCreateTests.cs` | create | integration AC-1, AC-3, AC-4, AC-5 (POST half), AC-9, AC-10 | ~260 |
| `src/backend/LogiFlow.Api.Tests/RouteAssignTests.cs` | create | integration AC-2, AC-5 (PATCH half), AC-6, AC-7 (auth + Driver scoping), AC-8 | ~260 |
| `state/plans/LOGI-0009-backend.plan.md` | modify | this plan | auto |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0009-create-route.md` | full | AC-1..AC-10 + §6 data + §7 checkpoint decisions O1-O4 |
| `contracts/v1/paths/routes.yaml` | full | route endpoints, `x-roles`, responses |
| `src/backend/LogiFlow.Domain/Vehicle.cs` | 1-37 | master data aggregate pattern |
| `src/backend/LogiFlow.Domain/Driver.cs` | 1-41 | master data aggregate + `UserId` linking pattern |
| `src/backend/LogiFlow.Domain/Shipment.cs` | 1-100 | `ShipmentNotEditableException` pattern for Planned-only guard |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | full | context interface to extend with `DbSet<Route>` |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | 1-100 | EF core mapping & navigation configurations |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentCommands.cs` | 1-100 | `UpdateShipmentCommand` partial update & `ConflictException` idioms |
| `src/backend/LogiFlow.Api/Endpoints/ShipmentEndpoints.cs` | 95-170 | `JsonElement` body parsing, presence tracking, and server-owned key rejection pattern |
| `src/backend/LogiFlow.Api.Tests/LogiFlowTestFactory.cs` | 1-80 | in-memory db setup, auth headers, and seed idioms |

## 4. Steps (Vertical Slice Milestones — 2 to 3 milestones maximum)
- [x] 1. Milestone 1 — Domain & Migration & Core Commands: Create `Route.cs` aggregate entity (with Planned-only guard and `RouteStatusValues`), register `DbSet<Route>` in `IAppDbContext` and configure `LogiFlowDbContext` (snake_case `routes`, indexes, restrict FKs), generate/add migration and update snapshot. Implement `RouteCommands.cs` (`RouteDto`, Create/Update commands, validators, and handlers enforcing AC-4 404 for dangling FKs, AC-5 double-booking window overlap 409, AC-6 Planned-only edit guard, and AC-8 FK delete guards in `VehicleCommands.cs` / `DriverCommands.cs`). Register validators in `DependencyInjection.cs`. → verify: `dotnet build src/backend/LogiFlow.sln` passes with zero errors/warnings.
- [x] 2. Milestone 2 — Queries & Endpoints & Integration Tests: Implement `RouteQueries.cs` (`ListRoutesQuery` supporting paging, sorting by `-createdAt`, AND filters, and Driver role scoping to assigned routes, plus `GetRouteByIdQuery` with 404 and cross-driver 403). Implement `RouteEndpoints.cs` with routes mapped in `Program.cs`, implementing `RequireRoles` per OpenAPI `x-roles`, and `JsonElement` partial-patch binder rejecting server-owned fields (AC-10) and empty body (AC-3). Write comprehensive integration test suites in `RouteCreateTests.cs` and `RouteAssignTests.cs` covering AC-1 through AC-10 with `// LOGI-0009 AC-n` traceability comments. → verify: `dotnet test src/backend/LogiFlow.sln -c Release` fully passes.
- [x] 3. Milestone 3 — Arm Verification & Verification Gates: Verify `dotnet build` clean, all tests passing without regressions, verify contract conformance with slicers, commit atomicity, seal journal, and record handoff to frontend arm. → verify: `node tools/tracker/index.mjs status` and `dotnet test src/backend/LogiFlow.sln` green.

## 5. Risks / open questions
- **R1 (Double-booking overlap check):** BR-3/BR-4 and PRD F9 specify overlap on planned time windows (`plannedStart < other.plannedEnd && other.plannedStart < plannedEnd`). Routes in `Completed` or `Cancelled` states do not conflict. Handlers must perform this check within the transaction when `vehicleId` or `driverId` is assigned or updated.
- **R2 (Partial PATCH binding):** Like `ShipmentUpdateRequest`, `RouteUpdateRequest` binds as `JsonElement` to detect omitted vs null fields (e.g. `{ "vehicleId": null }` unassigns, while omitting keeps current value), reject server-owned keys (`id`, `status`, `createdAt`, `updatedAt`), and reject empty object `{}` per AC-3.
- **R3 (Driver role scoping):** Driver caller can only see routes assigned to their driver record. The handler queries `db.Drivers.SingleOrDefaultAsync(d => d.UserId == currentUser.UserId)` to find the linked `driver.Id`. Cross-driver GET yields 403 Forbidden.
- **R4 (AC-8 Delete restrictions):** Deleting a vehicle or driver that has any associated routes must throw `ConflictException` (409) rather than cascading or silently failing.

## 6. Exit gates
- `dotnet build src/backend/LogiFlow.sln -c Release --no-incremental` builds clean with zero errors.
- `dotnet test src/backend/LogiFlow.sln -c Release` passes with 100% success across all existing and new test suites.
- AC-1 through AC-10 covered with explicit `// LOGI-0009 AC-n` traceability comments.
- Contract alignment verified against OpenAPI spec for `/routes` and `/routes/{id}`.
- All touched files remain within 150 lines or modularized appropriately per project standards.
