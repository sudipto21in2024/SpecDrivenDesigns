# 01 — Tech Stack & Tooling

What the LogiFlow backend is built with, why, and how you run it.

## 1. The stack at a glance

| Layer | Choice | Where |
|---|---|---|
| Runtime/framework | **.NET 9** (`net9.0`), ASP.NET Core **minimal APIs** (no MVC controllers) | all `*.csproj` |
| ORM / database | **EF Core 9 + SQLite** (`Data Source=logiflow.db`); PostgreSQL port planned (ADR-005) | `LogiFlow.Infrastructure` |
| Identity | ASP.NET Core Identity (`UserManager<AppUser>`) for hashing/lookup **only** — no cookies | `DependencyInjection.cs` (Infrastructure) |
| Auth tokens | JWT bearer (HS256), 15-min access + 7-day single-use refresh | `Security/JwtTokenService.cs` |
| Use-case bus | **MediatR 14** (`ICommand`/`IQuery` markers) | `Application/Messaging/Messaging.cs` |
| Validation | **FluentValidation 12** via a MediatR pipeline behavior | `Application/Behaviors/ValidationBehavior.cs` |
| DTO mapping | **Mapster** (ADR-003; used selectively — most projections are explicit records) | `LogiFlow.Api.csproj` |
| Logging | **Serilog** (console + rolling file `Logs/logiflow-*.txt`, request logging) | `Program.cs` |
| Error envelope | RFC 7807 **ProblemDetails** (`application/problem+json`) | `Middleware/` |
| Tests | **xUnit 2.9 + FluentAssertions 8 + Microsoft.AspNetCore.Mvc.Testing** | `LogiFlow.Api.Tests` |

Architecture decisions live in `Docs/adr/` — notably **ADR-001** (net9 minimal APIs),
**ADR-003** (Mapster), **ADR-004** (contract-first client + mocks), **ADR-005**
(SQLite→PostgreSQL), **ADR-007** (JWT auth model), **ADR-008** (multi-file OpenAPI).

## 2. Central package management

`src/backend/Directory.Packages.props` sets `ManagePackageVersionsCentrally=true`: `.csproj` files
declare `<PackageReference Include="MediatR" />` **without versions**; versions are pinned once in
that file (EF Core 9.0.0, MediatR 14.2.0, FluentValidation 12.1.1, JwtBearer 9.0.0,
`System.IdentityModel.Tokens.Jwt` 8.0.1, xunit 2.9.2, ...). The file also applies `net9.0`,
`Nullable` and `ImplicitUsings` to every project. To upgrade a package, change it in exactly one
place.

## 3. Commands

```bash
cd src/backend
dotnet restore            # (also implied by build)
dotnet build              # compile all 5 projects — 0 errors/0 warnings is the bar
dotnet test               # runs LogiFlow.Api.Tests (244 tests, ~9s after build)
dotnet run --project LogiFlow.Api      # start the API (Development)
dotnet ef migrations add <Name> \
  -p LogiFlow.Infrastructure -s LogiFlow.Api   # add a migration (tool: dotnet-ef)
```

- There is no frontend-style bundler: `dotnet build` **is** the type-safety gate (`<Nullable>enable</Nullable>`
  everywhere; warnings are treated seriously in this repo's gates).
- Migrations are **committed source files**, not generated on deploy.

## 4. Configuration & environments

| Key | Default | Purpose |
|---|---|---|
| `Database:ConnectionString` | `Data Source=logiflow.db` | SQLite file; overridden in tests (in-memory) |
| `Jwt:SigningKey` | falls back to a built-in dev key | HS256 key — supply via user-secrets/env in real deploys |
| `Jwt:Issuer` / `Jwt:Audience` | `logiflow` / `logiflow-api` | token validation parameters |
| `Jwt:AccessTokenMinutes` / `Jwt:RefreshTokenDays` | 15 / 7 | token lifetimes |
| `DemoData:Enabled` | off | opt-in bulk demo dataset for local UI testing |

Environments used by the code:

- **Development** — migrations applied + `SeedData` (4 role users) + optional `DemoData` on
  startup; DeveloperExceptionPage.
- **Testing** — set by the test factory; startup **skips** migrations and dev seeding (the factory
  seeds itself).
- **Production** — no seeding; migrations still applied at startup (v1 single-node choice).

## 5. Ports

- `launchSettings.json` starts the API at `http://localhost:5041` (profile `http`).
- The frontend's Vite dev proxy targets **`http://localhost:5199`**. When running both locally, run
  the API with `ASPNETCORE_URLS=http://localhost:5199 dotnet run --project LogiFlow.Api`, or point
  the proxy at 5041 — the proxy simply forwards `/api/*`.
- Docker: `docker-compose.yml` at the repo root runs both services; the frontend container is
  published on `8080:80`.

## 6. Contract-first (ADR-004) — the backend's half

1. `contracts/v1-openapi.yaml` (multi-file under `contracts/v1/`, ADR-008) is the source of truth:
   paths, schemas, status codes and **`x-roles`** per operation.
2. Endpoint files state *"implementation of the /X paths in contracts/v1-openapi.yaml"* and mirror
   `x-roles` with `RequireRoles(...)`.
3. Response shapes are explicit DTO records (`WarehouseDto`, `ShipmentDto`, ...) matching the
   contract schemas — the **frontend compiles against generated types**, so a mismatch is a
   cross-repo bug.
4. Error bodies follow `Docs/ProjectTechGuidence/05-api-contract-standards.md` (ProblemDetails,
   `errors` map for 400s, paging envelope).
5. The MSW mocks in `src/frontend/src/mocks/handlers.ts` model the same contract so frontend tests
   run without this API.
