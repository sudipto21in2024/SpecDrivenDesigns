---
ticket: LOGI-0005
arm: backend
status: locked
created: 2026-09-21T03:49:12.500Z
depends_on_plans: LOGI-0005-architect
---

## 1. Objective
LOGI-0005 backend (PRD F3, spec approved): Driver entity + EF migration (unique license_number, nullable user FK) + MediatR CRUD (duplicate license 409; userId nonexistent 400 / linked-elsewhere 409; PUT null clears) + RBAC endpoints mirroring vehicles + integration tests AC-1..AC-9.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Domain/Driver.cs` | create | Driver entity (fullName/licenseNumber/phone/status/optional user link) — AC-1..AC-8 | ~55 |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | modify | Add Drivers DbSet — AC-1..AC-8 | ~3 |
| `src/backend/LogiFlow.Application/Features/Drivers/DriverCommands.cs` | create | Create/Update/Delete + validators/handlers — license unique 409 (AC-3), user link existence 400 / 1:1 409 (AC-5/AC-6), PUT clears link (AC-6) | ~190 |
| `src/backend/LogiFlow.Application/Features/Drivers/DriverQueries.cs` | create | List (paged q/status, id asc) + GetById (AC-7, AC-8) | ~100 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify | Register driver validators | ~5 |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | modify | drivers mapping, unique license_number index, nullable FK user_id -> users.id NO ACTION — AC-3/AC-6 | ~25 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/*LOGI-0005_AddDrivers*.cs` | create | Additive migration + designer (drivers table, unique index, nullable FK) | ~300 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/LogiFlowDbContextModelSnapshot.cs` | modify | Snapshot gains the drivers entity | ~55 |
| `src/backend/LogiFlow.Api/Endpoints/DriverEndpoints.cs` | create | /api/v1/drivers routes + RequireRoles matrix = contract x-roles — AC-9 | ~75 |
| `src/backend/LogiFlow.Api/Program.cs` | modify | MapDriverEndpoints wiring (after MapVehicleEndpoints, line 127) | ~2 |
| `src/backend/LogiFlow.Api.Tests/DriverEndpointsTests.cs` | create | Integration tests AC-1..AC-9 | ~220 |

Reuse note: ConflictException and its ExceptionHandlingMiddleware 409 mapping already exist from LOGI-0004 — drivers reuses them; no API-middleware change in this manifest.

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0005-drivers-crud.md` | full | AC-1..AC-9 source of truth + out-of-scope boundaries |
| `contracts/v1-openapi.yaml` | 155-193, 459-568 | DriverRequest/DriverResponse fields, endpoint declarations, exact x-roles per operation |
| `memory/journal/LOGI-0005.md` | full | Architect findings: user-link semantics (400 nonexistent / 409 linked-elsewhere), no createdAt, migration plan, deferred items |
| `Docs/ProjectTechGuidence/04-database-schema.md` | 39-47, 120-125 | Approved driver columns/enums + unique-index rule for drivers.license_number |
| `src/backend/LogiFlow.Domain/Vehicle.cs` | full | Entity idiom (Create/Update, trim, string-typed enums) to mirror |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleCommands.cs` | full | Command/validator/handler idiom (404 via NotFound, duplicate pre-check + UNIQUE backstop) |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleQueries.cs` | full | Paged-list idiom (AsNoTracking, q filter, PagedResult) |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | full | Seam to extend; Users DbSet for the user-link existence check |
| `src/backend/LogiFlow.Application/Common/PagedResult.cs` | full | PagedResult.Create + NotFoundException |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | full | Per-type validator registration convention |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | 26-70 | Entity-mapping idiom (snake_case columns, indexes, FK style) |
| `src/backend/LogiFlow.Api/Endpoints/VehicleEndpoints.cs` | full | Endpoint + RequireRoles matrix idiom (201 + Location, 204, role sets) |
| `src/backend/LogiFlow.Api/Program.cs` | 116-133 | Route-wiring point (Map*Endpoints block) |
| `src/backend/LogiFlow.Domain/Security/Roles.cs` | full | Role constants for RequireRoles (Driver role needed for the AC-9 403 test) |
| `src/backend/LogiFlow.Api.Tests/VehicleEndpointsTests.cs` | full | Integration-test idiom + AC-to-test mapping precedent |
| `src/backend/LogiFlow.Api.Tests/TestAuth.cs` | full | Role sign-in helper (Admin/Dispatcher/Viewer/Driver clients for AC-9) |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/20260920060044_LOGI-0004_AddVehicles.cs` | full | Migration shape precedent (fallback if dotnet-ef is unavailable) |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/LogiFlowDbContextModelSnapshot.cs` | full | Snapshot to extend (also listed in §2) |

## 4. Steps (each with verify gate)
- [x] 1. Domain + persistence: `Driver` entity (FullName, LicenseNumber, Phone optional, Status string, int? UserId link; Create/Update mirroring Vehicle with trimmed inputs) + IAppDbContext.Drivers + LogiFlowDbContext mapping (drivers: full_name, license_number UNIQUE index, phone, status, nullable user_id FK to users.id, delete NO ACTION per approved schema) + `dotnet ef migrations add LOGI-0005_AddDrivers` (fallback: hand-author mirroring the LOGI-0004 migration + snapshot edit) → verify: `dotnet build src/backend/LogiFlow.sln` passes; Migrations dir contains the new LOGI-0005_AddDrivers.cs + .Designer.cs; snapshot contains drivers
- [x] 2. Application: DriverCommands.cs — Create handler/validator (fullName 1..200 required; licenseNumber 1..40 required; phone <= 40 optional; status empty -> Active, else must be Active/OffDuty/Suspended -> 400; userId null -> no link, else user must exist -> 400 with errors.userId entry, else no other driver may already hold that userId -> 409 ConflictException; duplicate licenseNumber pre-check -> 409 + DbUpdateException UNIQUE backstop); Update handler (full-replace, same rules; license dup-check excludes self; user-link check excludes self; 404 when missing; null/omitted userId clears the link); Delete handler (hard delete, 404 when missing); DriverQueries.cs — List (page/pageSize rules, q = fullName contains case-insensitive, status exact filter -> 400 on bad value, ordered by id asc) + GetById (404 when missing); register driver validators in DI → verify: `dotnet build src/backend/LogiFlow.sln` passes
- [ ] 3. API: DriverEndpoints.cs — GET /api/v1/drivers and GET /{id} RequireRoles(Admin, Dispatcher, Viewer); POST + PUT RequireRoles(Admin, Dispatcher); DELETE RequireRoles(Admin); POST -> 201 + Location; DELETE -> 204; payloads carry no createdAt (list ordered by id asc); Program.cs wiring `app.MapDriverEndpoints();` after MapVehicleEndpoints → verify: `dotnet build src/backend/LogiFlow.sln` passes
- [ ] 4. Tests: DriverEndpointsTests.cs mirroring VehicleEndpointsTests (TestAuth per-role clients; link tests use a real seeded user id — AC-5's "user id 7" is illustrative): AC-1 201 + id + status Active + persists in list; AC-2 empty/missing fullName -> 400 errors.fullName, no row; AC-3 duplicate license -> 409 on POST and on PUT of another driver, count unchanged, other driver keeps its license; AC-4 omitted status -> Active, bad status -> 400 errors.status; AC-5 link to a seeded user -> 201 echoes userId and GET /{id} carries it; AC-6 nonexistent userId -> 400 errors.userId + no row; userId already linked to another driver -> 409 on POST and PUT; PUT userId null -> 200 with userId null; AC-7 paged envelope + q/status filters + bad status param -> 400; AC-8 GET/PUT/DELETE happy paths + 404 on id 999999 for all three; AC-9 anonymous -> 401 everywhere, Viewer POST -> 403 + no row, Driver GET -> 403, Dispatcher GET/POST/PUT -> 2xx and DELETE -> 403, Admin DELETE -> 204 → verify: `dotnet test src/backend/LogiFlow.Api.Tests` full suite green (auth + warehouses + vehicles + drivers)
- [ ] 5. Seal: append backend-arm section to `memory/journal/LOGI-0005.md` (user-link 400/409 semantics, migration name + timestamp, test counts, 1:1 race note); commit §2 files manifest-exact + journal; record handoff → verify: `git status --short` shows only §2 files + journal; `tracker handoff --ticket LOGI-0005 --from backend --to frontend --summary "memory/journal/LOGI-0005.md#backend-arm" --gates "build-pass,tests-green,license-409,userlink-400-409"` recorded

## 5. Risks / open questions
- 1:1 user link is a handler pre-check only — the approved schema has NO unique index on user_id (only license_number), so a concurrent-create race could double-link. Accepted for v1 (SQLite dev, single-threaded tests); do NOT add an index the approved schema does not declare without a checkpoint.
- PUT collapses omitted vs explicit-null userId (int? DTO) — both clear the link. Consistent with the contract PUT description (full update); the frontend arm must always send the current link value on edit.
- dotnet-ef tool assumed available (9.0.8 at LOGI-0004) — fallback: hand-author the migration mirroring the LOGI-0004 migration + snapshot edit; verify via build + tests.
- SQLite license_number uniqueness is BINARY (case-sensitive after trim) — v1 exact match, same decision as vehicles plate.
- DELETE 409-when-referenced-by-route is contract-declared only — no routes table until LOGI-0009; v1 hard-deletes (mirror vehicles).
- No escalation triggers: schema pre-approved, additive change only, RBAC matrix copied from the vehicle arm; contracts/ and src/frontend/ boundaries untouched.

## 6. Exit gates
- `dotnet build src/backend/LogiFlow.sln` passes; `dotnet test src/backend/LogiFlow.Api.Tests` full suite green (auth + warehouse + vehicle + driver suites).
- Duplicate licenseNumber -> 409 ProblemDetails on POST and PUT; no second row; the other driver keeps its license.
- User link: nonexistent userId -> 400 with errors.userId; userId already linked to another driver -> 409; PUT null clears (userId null in the response); linked user echoed on GET.
- Response payloads carry no createdAt; list ordered by id asc.
- RBAC matrix matches contract x-roles exactly: list/get [Admin, Dispatcher, Viewer]; create/update [Admin, Dispatcher]; delete [Admin]; Driver role 403 on every /drivers operation; anonymous 401 everywhere.
- Migration additive, one ticket = one migration (LOGI-0005_AddDrivers), unique index on license_number, nullable FK user_id -> users.id (NO ACTION); no schema-doc change needed (drivers already documented).
