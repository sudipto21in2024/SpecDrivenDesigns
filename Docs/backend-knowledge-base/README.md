# Backend Knowledge Base — LogiFlow ASP.NET Core API

A set of documents that explains **how the LogiFlow backend is implemented and how a request flows
through it**. Written for developers who are new to .NET minimal APIs and/or this repository, and
designed to pair with the frontend knowledge base.

## Where things live

- The backend source root is `c:\Sudipto\SpecDrivenDesigns\src\backend` (referred to below as
  `<backend>/`).
- All paths in these documents are relative to the repository root
  `c:\Sudipto\SpecDrivenDesigns` unless stated otherwise.
- The API contract both sides implement is `contracts/v1-openapi.yaml`; the frontend consumes it
  via generated types, the backend mirrors it with `x-roles` annotations and ProblemDetails.

## Reading order

| # | Document | What it answers |
|---|----------|-----------------|
| 01 | [01-tech-stack.md](01-tech-stack.md) | Which .NET/libraries are used, how to build/run/test, configuration and ports |
| 02 | [02-solution-architecture.md](02-solution-architecture.md) | The 5-project solution, the dependency rule, the seams, where a feature lives |
| 03 | [03-api-pipeline.md](03-api-pipeline.md) | Program.cs wiring, endpoint pattern, middleware order, ProblemDetails error pipeline |
| 04 | [04-application-layer.md](04-application-layer.md) | MediatR commands/queries, FluentValidation pipeline, exception vocabulary, paging |
| 05 | [05-domain-model.md](05-domain-model.md) | Entities, encapsulation idiom, the Shipment aggregate and its BR-7 state machine |
| 06 | [06-persistence.md](06-persistence.md) | EF Core DbContext, snake_case mapping, transactions, migrations, seeding |
| 07 | [07-auth-and-security.md](07-auth-and-security.md) | Identity, JWT issuance/validation, refresh rotation, role authorization |
| 08 | [08-business-rules.md](08-business-rules.md) | Where each business rule (BR-1…BR-7) lives and how it is enforced/tested |
| 09 | [09-testing.md](09-testing.md) | xUnit integration testing: the test factory, shared SQLite, real login, patterns |
| 10 | [10-end-to-end-flows.md](10-end-to-end-flows.md) | Traced walkthroughs of the main scenarios + "where do I change X" cheat sheet |

## The 60-second version

1. `Program.cs` (LogiFlow.Api) is a **.NET 9 minimal-API** host: Serilog logging → camelCase JSON →
   `AddApplication()` (MediatR + validators) → `AddInfrastructure()` (EF Core SQLite + Identity +
   JWT) → JWT bearer auth with ProblemDetails-producing 401/403 handlers → migrate + seed on
   startup → one exception-handling middleware → `MapXxxEndpoints()` per resource.
2. Each endpoint file maps HTTP routes to **MediatR commands/queries** and applies role
   requirements that mirror the contract's `x-roles` (`RequireRoles(...)` = any-of whitelist).
3. Application-layer **handlers** own use-case logic: a FluentValidation validator runs first
   (pipeline behavior), then the handler talks to the database through the `IAppDbContext` seam and
   throws typed exceptions (`NotFoundException` → 404, `ConflictException` → 409, ...) that the
   API middleware converts into **RFC 7807 ProblemDetails**.
4. The **Domain** project holds entities and the hard business rules (shipment status state
   machine, route capacity guards' inputs); the **Infrastructure** project holds EF Core, JWT and
   Identity implementations behind Application-defined interfaces.
5. Tests (244, xUnit) host the real API via `WebApplicationFactory` against a shared-cache
   in-memory SQLite database and sign in through the real `/auth/login` endpoint — no fakes.

## Quick directory map

```text
src/backend/
├── LogiFlow.sln
├── Directory.Packages.props        # central NuGet package versions
├── LogiFlow.Api/                   # composition root (host + HTTP surface)
│   ├── Program.cs                  # wiring: DI, authN/authZ, middleware, endpoint mapping
│   ├── Endpoints/                  # one file per resource (Auth, Warehouses, Vehicles, ...)
│   ├── Middleware/                  # ExceptionHandlingMiddleware, ProblemDetailsWriter
│   ├── Authorization/              # CurrentUser + RequireRoles helper
│   └── appsettings*.json
├── LogiFlow.Application/           # use cases (no HTTP, no EF specifics)
│   ├── Abstractions/               # IAppDbContext, ICurrentUser, ITokenIssuer, IUserCredentials
│   ├── Behaviors/                  # ValidationBehavior (MediatR pipeline)
│   ├── Common/                     # typed exceptions + PagedResult
│   ├── Features/<Name>/            # Commands / Queries / Dtos / validators per feature
│   └── DependencyInjection.cs      # MediatR + per-type validator registration
├── LogiFlow.Domain/                # entities, status state machine, Roles
├── LogiFlow.Infrastructure/        # EF Core DbContext, migrations, JWT, Identity, seeding
└── LogiFlow.Api.Tests/             # 244 integration tests + factory + TestAuth
```
