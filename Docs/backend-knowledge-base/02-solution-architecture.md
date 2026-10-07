# 02 — Solution Architecture

The five projects, the dependency rule that holds them together, and where new code goes.

## 1. The project graph

```text
LogiFlow.Api            (host, HTTP surface, composition root)
   ├──► LogiFlow.Application   (use cases, validation, abstractions)
   │         └──► LogiFlow.Domain   (entities, business rules)
   ├──► LogiFlow.Infrastructure (EF Core, JWT, Identity, seeding)
   │         ├──► LogiFlow.Domain
   │         └──► LogiFlow.Application
   └──► LogiFlow.Domain

LogiFlow.Api.Tests ──► LogiFlow.Api + LogiFlow.Application
```

**The dependency rule in one line:** Domain knows nothing; Application depends only on Domain and
declares *interfaces* for everything it needs; Infrastructure implements those interfaces;
Api is the only project that wires them together and the only one that knows about HTTP.

| Project | Responsibility | Must NOT contain |
|---|---|---|
| **LogiFlow.Domain** | Entities (`Shipment`, `Route`, `Warehouse`, ...), status state machine, `Roles`, domain exceptions | EF, MediatR, HTTP, DTOs |
| **LogiFlow.Application** | Commands/queries + handlers, FluentValidation validators, DTO records, `PagedResult`, typed exceptions, seams (`Abstractions/`) | concrete EF/Identity/JWT types, `HttpContext` |
| **LogiFlow.Infrastructure** | `LogiFlowDbContext`, migrations, `JwtTokenService`, Identity adapters, `SeedData` | HTTP endpoints, use-case logic |
| **LogiFlow.Api** | `Program.cs`, endpoint mappings, `CurrentUser`, middleware, ProblemDetails | business rules, direct EF queries |
| **LogiFlow.Api.Tests** | Integration tests against the real host | production code (helpers like `TestAuth` live here) |

## 2. The seams (`LogiFlow.Application/Abstractions/`)

The Application layer defines the ports it needs; other projects provide the adapters:

| Interface | Implemented in | Purpose |
|---|---|---|
| `IAppDbContext` | Infrastructure (`LogiFlowDbContext`) | DbSet access + `SaveChangesAsync` + `ExecuteInTransactionAsync` without naming EF types in handlers |
| `ICurrentUser` | Api (`Authorization/CurrentUser`) | "who is calling?" — id/email/role from `HttpContext.User` (ADR-007) |
| `ITokenIssuer` | Infrastructure (`JwtTokenService`) | create access tokens, refresh values, hash refresh tokens |
| `IUserCredentials` | Infrastructure (`IdentityUserCredentials`) | find user by email + verify password via `UserManager` |

Handlers depend on the interface, never the adapter — which is why the whole Application layer can
be unit-tested and why swapping SQLite→PostgreSQL (ADR-005) or JWT→anything is contained.

## 3. Anatomy of a feature (`LogiFlow.Application/Features/`)

One folder per feature area, mirroring the frontend's `src/features/`:

```text
Features/
├── Auth/           AuthCommands.cs, AuthQueries.cs, AuthDtos.cs
├── Warehouses/     WarehouseCommands.cs, WarehouseQueries.cs
├── Vehicles/       VehicleCommands.cs, VehicleQueries.cs
├── Drivers/        DriverCommands.cs, DriverQueries.cs
├── Shipments/      ShipmentCommands.cs, ShipmentQueries.cs, SlaPolicy.cs
├── Routes/         RouteCommands.cs, RouteQueries.cs, RouteShipmentCommands.cs,
│                   RouteShipmentQueries.cs, RouteConflictCheck.cs
├── Planning/       PlanningBoardQueries.cs, PlanningBoardDtos.cs, PlanningBoardFilters.cs
└── Dashboard/      DashboardQueries.cs, DashboardDtos.cs
```

Each use case is three small types in one place (see doc 04):

```csharp
public record CreateWarehouseCommand(...) : ICommand<WarehouseDto>;   // 1. the message
public class CreateWarehouseValidator : AbstractValidator<...> { }    // 2. its rules
public class CreateWarehouseHandler(IAppDbContext db)                 // 3. its handler
    : IRequestHandler<CreateWarehouseCommand, WarehouseDto> { ... }
```

Reads (`IQuery<T>`) and writes (`ICommand<T>`) are split into separate files/records but share the
same pipeline. Some features add view-model policy files (`SlaPolicy.cs`, `RouteConflictCheck.cs`)
so a rule has exactly one home (doc 08).

## 4. HTTP surface (`LogiFlow.Api/Endpoints/`)

One static class per resource, each exposing `Map<Resource>Endpoints(this IEndpointRouteBuilder)`:

| File | Route group |
|---|---|
| `AuthEndpoints.cs` | `/api/v1/auth` (login, refresh, logout, me) |
| `WarehouseEndpoints.cs` | `/api/v1/warehouses` |
| `VehicleEndpoints.cs` | `/api/v1/vehicles` |
| `DriverEndpoints.cs` | `/api/v1/drivers` |
| `ShipmentEndpoints.cs` | `/api/v1/shipments` (+ status-transitions, status-history) |
| `RouteEndpoints.cs` + `RoutePayloadParsers.cs` | `/api/v1/routes` (+ `/shipments` sub-collection) |
| `PlanningBoardEndpoints.cs` | `/api/v1/planning-board` |
| `DashboardEndpoints.cs` | `/api/v1/dashboard` |

Plus an inline `GET /api/v1/health` in `Program.cs` (anonymous).

## 5. Where does a new endpoint go? (checklist)

1. Contract first: add/modify the path + `x-roles` in `contracts/v1/`.
2. Domain (if new rules/entities): entity + invariants; migration if the shape changed
   (`dotnet ef migrations add TICKET_Name`).
3. Application: DTO record, command/query record, validator, handler in `Features/<Name>/` +
   register `IValidator<T>` in `Application/DependencyInjection.cs`.
4. Api: endpoint in `Endpoints/<Name>Endpoints.cs` with `RequireRoles(...)` matching `x-roles`;
   map it in `Program.cs`.
5. Tests: co-locate a `<Name>Tests.cs` in `LogiFlow.Api.Tests`.
6. Frontend in lockstep: `npm run generate:api`, `api/client.ts`, MSW handler, permissions.

## 6. Design invariants worth respecting

- **Exceptions, not result objects** — handlers throw typed exceptions; the API layer alone maps
  them to status codes (one conversion point).
- **Validation before side effects** — every command/query with rules gets an `IValidator<T>`; the
  pipeline guarantees it runs before the handler.
- **The contract is the source of truth** — status codes, role lists and DTO shapes are not free
  choices.
- **One home per business rule** — SLA math lives only in `SlaPolicy`; transitions only in
  `Shipment.TransitionTo`; capacity only in `RouteCapacityGuard`.
- **Server is the authority** — the frontend hides affordances; the API re-checks everything.

