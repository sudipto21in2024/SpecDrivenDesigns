---
ticket: LOGI-0003
arm: backend
status: locked
created: 2026-09-19T17:00:04.854Z
depends_on_plans:
---

## 1. Objective
JWT + role-based auth per LOGI-0003 AC-1..12 (Identity + JWT + RBAC middleware, refresh
rotation, ProblemDetails). Implementation already exists uncommitted (predates platform);
this plan reconciles it, so steps verify rather than create.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Api/Program.cs` | modify | AC-1/4/11 auth wiring | ~40 |
| `src/backend/LogiFlow.Api/Endpoints/*.cs` | create/modify | AC-1..9 auth + role enforcement on warehouses | ~350 |
| `src/backend/LogiFlow.Api/Authorization/*.cs` | create | AC-5/6 CurrentUser/policies | ~60 |
| `src/backend/LogiFlow.Api/Middleware/*.cs` | create/modify | AC-2/3/4 ProblemDetails + exceptions | ~180 |
| `src/backend/LogiFlow.Api/LogiFlow.Api.csproj` | modify | Identity packages | ~5 |
| `src/backend/LogiFlow.Application/Abstractions/*.cs` | modify/create | ICurrentUser/ITokenIssuer/IUserCredentials | ~60 |
| `src/backend/LogiFlow.Application/Common/*.cs` | create | AC-2 UnauthorizedException | ~15 |
| `src/backend/LogiFlow.Application/Features/Auth/*.cs` | create | AC-1..9 Login/Refresh/Logout/Me | ~400 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify | DI wiring | ~15 |
| `src/backend/LogiFlow.Application/Class1.cs` | delete | scaffold cleanup | -1 |
| `src/backend/LogiFlow.Domain/AppUser.cs` | create | Identity user | ~30 |
| `src/backend/LogiFlow.Domain/RefreshToken.cs` | create | AC-7 rotation storage | ~30 |
| `src/backend/LogiFlow.Domain/Security/*.cs` | create | role enum (claims source) | ~15 |
| `src/backend/LogiFlow.Domain/LogiFlow.Domain.csproj` | modify | Identity ref | ~3 |
| `src/backend/LogiFlow.Domain/Class1.cs` | delete | scaffold cleanup | -1 |
| `src/backend/LogiFlow.Infrastructure/DependencyInjection.cs` | modify | Identity DbContext registration | ~20 |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | modify | users + refresh_tokens sets | ~20 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/*.cs` | create | AC §6 additive migration | ~250 |
| `src/backend/LogiFlow.Infrastructure/Security/*.cs` | create | AC-1/7/10 JwtTokenService, credentials | ~250 |
| `src/backend/LogiFlow.Infrastructure/Seed/SeedData.cs` | modify | AC-2/§7 seeded users | ~40 |
| `src/backend/LogiFlow.Infrastructure/LogiFlow.Infrastructure.csproj` | modify | Identity EF package | ~3 |
| `src/backend/LogiFlow.Infrastructure/Class1.cs` | delete | scaffold cleanup | -1 |
| `src/backend/Directory.Packages.props` | modify | pin Identity EF 9.0.0 | ~3 |
| `src/backend/LogiFlow.Api.Tests/*.cs` | create/modify | AC-1..10 unit gates | ~400 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0003-auth-roles.md` | full | ACs |
| `Docs/adr/007-auth-model-identity-jwt-rbac.md` | full | recorded decision |
| `contracts/v1-openapi.yaml` | full | auth endpoint contract |
| `src/backend/LogiFlow.Api/Program.cs` | full | middleware/auth registration point |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | full | DI patterns to mirror |

## 4. Steps (each with verify gate)
- [x] 1. Identity + JWT DI, auth endpoints, RBAC enforcement, refresh rotation → verify: `dotnet build` green
- [x] 2. ProblemDetails writer + exception handling, role policies on warehouse endpoints → verify: 401/403 observed
- [x] 3. Tests → verify: `dotnet test` green (20/20 confirmed 2026-09-19)

## 5. Risks / open questions
- The uncommitted tree also contains **out-of-arm** changes (frontend `features/auth/`,
  `api/tokenStore.ts`; `contracts/v1-openapi.yaml`; `tests/e2e/auth.spec.ts`) done before the
  platform existed — to be covered by `LOGI-0003-frontend` and `LOGI-0003-qa` plans.
- Stray runtime artifacts `src/backend/LogiFlow.Api/e2e-logiflow.db-shm/-wal` should be
  gitignored/removed before commit.

## 6. Exit gates
- `dotnet test` green (20/20) — confirmed
- `npm test` green (18/18) — confirmed
- OpenAPI contract lint (spectral) — pending CI run
