---
ticket: LOGI-0004
arm: backend
status: done
created: 2026-09-20T05:57:09.598Z
depends_on_plans: LOGI-0004-architect
---

## 1. Objective
LOGI-0004 backend (PRD F2, spec `specs/features/LOGI-0004-vehicles-crud.md` approved): Vehicle entity + EF migration (unique plate) + MediatR CRUD (duplicate plate to 409) + RBAC endpoints mirroring warehouses + tests AC-1..AC-9. RBAC from day one per ADR-007.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Domain/Vehicle.cs` | create | Entity (plate/type/capacity/status) — AC-1..AC-6 | ~45 |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | modify | Add `Vehicles` DbSet — AC-1..AC-8 | ~3 |
| `src/backend/LogiFlow.Application/Common/ConflictException.cs` | create | 409 signal for duplicate plate (AC-3) | ~10 |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleCommands.cs` | create | Create/Update/Delete + validators/handlers (AC-1..AC-6, AC-8) | ~170 |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleQueries.cs` | create | List (paged q/status/type) + GetById (AC-7, AC-8) | ~110 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify | Register vehicle validators | ~5 |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | modify | `vehicles` mapping, unique plate index — AC-3 | ~20 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/20260920060044_LOGI-0004_AddVehicles.cs` | create | Additive migration (vehicles + unique plate index) | ~45 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/20260920060044_LOGI-0004_AddVehicles.Designer.cs` | create | EF designer for the migration | ~250 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/LogiFlowDbContextModelSnapshot.cs` | modify | Snapshot gains `vehicles` entity | ~50 |
| `src/backend/LogiFlow.Api/Middleware/ExceptionHandlingMiddleware.cs` | modify | `ConflictException` → 409 ProblemDetails — AC-3 | ~8 |
| `src/backend/LogiFlow.Api/Endpoints/VehicleEndpoints.cs` | create | `/api/v1/vehicles` routes + RequireRoles — AC-9 | ~70 |
| `src/backend/LogiFlow.Api/Program.cs` | modify | `MapVehicleEndpoints()` wiring | ~2 |
| `src/backend/LogiFlow.Api.Tests/VehicleEndpointsTests.cs` | create | Integration tests AC-1..AC-9 | ~200 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0004-vehicles-crud.md` | full | AC-1..AC-9 source of truth |
| `contracts/v1-openapi.yaml` | 122-154, 315-419 | Vehicle schemas + endpoint/role declarations |
| `src/backend/LogiFlow.Domain/Warehouse.cs` | full | Entity idiom (Create/Update, trim) |
| `src/backend/LogiFlow.Application/Features/Warehouses/WarehouseCommands.cs` | full | Command/validator/handler idiom (404 via NotFoundException) |
| `src/backend/LogiFlow.Application/Features/Warehouses/WarehouseQueries.cs` | full | Paged-list idiom (AsNoTracking, q filter, PagedResult) |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | full | Seam to extend |
| `src/backend/LogiFlow.Application/Common/PagedResult.cs` | full | PagedResult.Create + NotFoundException |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | full | Per-type validator registration convention |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | 26-45 | Entity-mapping idiom (snake_case, indexes) |
| `src/backend/LogiFlow.Api/Endpoints/WarehouseEndpoints.cs` | full | Endpoint + RequireRoles matrix idiom |
| `src/backend/LogiFlow.Api/Program.cs` | 116-128 | Route-wiring point |
| `src/backend/LogiFlow.Api/Middleware/ExceptionHandlingMiddleware.cs` | full | Exception → ProblemDetails mapping to extend |
| `src/backend/LogiFlow.Api.Tests/UnitTest1.cs` | full | Integration-test idiom (Admin sign-in, envelope asserts) |
| `src/backend/LogiFlow.Api.Tests/TestAuth.cs` | full | Role sign-in helper for AC-9 |
| `Docs/ProjectTechGuidence/04-database-schema.md` | §vehicles + indexing | Approved columns/enums/unique index |
| `src/backend/LogiFlow.Domain/Security/Roles.cs` | full | Role constants for RequireRoles |

## 4. Steps (each with verify gate)
- [x] 1. Domain + persistence: `Vehicle` entity (`Create`/`Update`, plate trimmed; type/status as strings validated by FluentValidation — SQLite stores TEXT, contract enums closed by validators); `IAppDbContext.Vehicles`; `LogiFlowDbContext` mapping (`vehicles`, `plate_number` UNIQUE + index, `type`, `capacity_kg`, `status`, `created_at`); `dotnet ef migrations add` → verify: `dotnet build src/backend/LogiFlow.sln` + `Migrations/*LOGI-0004*` exists
- [x] 2. Application: `ConflictException(resource, key)`; `VehicleCommands.cs` (Create: plate 1..20 required, type in Van/Truck/Trailer, capacityKg > 0, status empty to Available else valid enum; duplicate plate pre-check to ConflictException + DbUpdateException UNIQUE backstop; Update: same rules, dup-check excludes self, 404 when missing; Delete: hard delete, 404 when missing); `VehicleQueries.cs` (List: page/pageSize rules, q = plate contains case-insensitive, status/type exact filters with 400 on bad value; GetById to 404); DI validator registration → verify: `dotnet build` passes
- [x] 3. API: `ExceptionHandlingMiddleware` maps `ConflictException` to 409 ProblemDetails (`type: https://logiflow.dev/errors/conflict`); `VehicleEndpoints.cs` (GET list + GET by id: Admin/Dispatcher/Viewer; POST + PUT: Admin/Dispatcher; DELETE: Admin; POST to 201 + Location; DELETE to 204); `Program.cs` wiring → verify: `dotnet build` passes
- [x] 4. Tests `VehicleEndpointsTests.cs` (Admin client per warehouse-test precedent): AC-1 201+id+createdAt+persists; AC-2 empty plate to 400 `errors.plateNumber`; AC-3 duplicate plate to 409 + count unchanged; AC-4 bad type to 400; AC-5 capacity 0/neg to 400; AC-6 omitted status to Available, bad status to 400; AC-7 paged envelope + filters; AC-8 get/update/delete + 404s; AC-9 anonymous to 401, Viewer POST to 403, Dispatcher DELETE to 403 → verify: `dotnet test src/backend/LogiFlow.Api.Tests` full suite green
- [x] 5. Seal: journal backend-arm section (409 design, migration name, test counts); commit manifest-exact files; handoff backend to frontend → verify: `git status --short` only §2 files + journal; `tracker handoff` gates (build-pass, tests-green, 409-verified)

## 5. Risks / open questions
- `dotnet ef` tool may be missing — fallback: hand-author migration mirroring `20260918100153_LOGI-0001_AddVehicles.cs` + snapshot; verify via build + tests (factory uses EnsureCreated).
- SQLite plate uniqueness is BINARY (case-sensitive after trim); spec silent — v1 exact match, flagged in journal.
- Delete-referenced-by-route 409 deferred to LOGI-0009 (no `routes` table yet); v1 hard-deletes.

## 6. Exit gates
- `dotnet build` passes; `dotnet test` full suite green (warehouse + auth + vehicle).
- Duplicate plate to 409 ProblemDetails on POST and PUT; no second row created.
- Every `/api/v1/vehicles` op 401s anonymous; role matrix matches contract x-roles (delete Admin-only).
- Migration additive, one ticket = one migration; schema doc already describes `vehicles` (no doc change).
