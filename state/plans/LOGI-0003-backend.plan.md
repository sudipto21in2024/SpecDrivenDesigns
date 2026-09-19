---
ticket: LOGI-0003
arm: backend
status: draft
created: 2026-09-19T17:00:04.854Z
depends_on_plans:
---

## 1. Objective
JWT + role middleware per LOGI-0003 AC-1..4

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Api/Middleware/RoleAuthMiddleware.cs` | create | AC-2 RBAC | ~80 |
| `src/backend/LogiFlow.Api/Program.cs` | modify | AC-1 register middleware | ~10 |
| `src/backend/LogiFlow.Api.Tests/AuthTests.cs` | create | unit gates | ~120 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0003-auth-roles.md` | full | ACs |
| `src/backend/LogiFlow.Api/Program.cs` | L1-60 | middleware registration point |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | full | DI patterns to mirror |

## 4. Steps (each with verify gate)
- [ ] 1. Add Identity + JWT DI → verify: `dotnet build` green
- [ ] 2. RoleAuthMiddleware + registration → verify: fake request 401/403
- [ ] 3. Tests → verify: `dotnet test` green

## 5. Risks / open questions

## 6. Exit gates
