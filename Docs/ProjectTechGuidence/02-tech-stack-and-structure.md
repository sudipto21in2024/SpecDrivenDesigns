# Tech Stack & Repository Structure

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Not CRA. State: TanStack Query for server state, Zustand for local UI state |
| UI Kit | MUI or Ant Design (pick one, record as ADR) | Enterprise tables, forms, data grids |
| Backend | ASP.NET Core 8 (Minimal APIs or Controllers, pick one, record as ADR) | C# 12 |
| ORM | EF Core 8 | Code-first migrations |
| Database | SQLite | File-based, fine for v1 single-node; document upgrade path to PostgreSQL in ADR |
| API contract | OpenAPI 3.1, authored by Architect Agent, source of truth | Frontend client generated via `openapi-typescript` or NSwag |
| Auth | ASP.NET Core Identity + JWT | Roles: Admin, Dispatcher, Driver, Viewer |
| Testing (unit) | xUnit (.NET), Vitest + React Testing Library (React) | |
| Testing (E2E) | Playwright (TypeScript) | Runs against a docker-composed backend+frontend+seeded SQLite |
| CI | GitHub Actions (or Azure DevOps if enterprise-preferred) | |
| Ticketing/specs | File-based specs in-repo (see `08-ticketing-jira-analysis.md`) | Optional Jira sync later |

## Repository layout

```
logiflow/
├── specs/
│   ├── backlog/                 # not-yet-approved feature specs
│   ├── features/                # approved specs, one per feature
│   └── templates/
├── contracts/
│   └── v1-openapi.yaml          # single source of truth for API shape
├── docs/
│   ├── adr/                     # architecture decision records
│   ├── reviews/                 # code review agent output
│   └── user-guide/
├── src/
│   ├── backend/
│   │   ├── LogiFlow.Api/
│   │   ├── LogiFlow.Application/
│   │   ├── LogiFlow.Domain/
│   │   ├── LogiFlow.Infrastructure/     # EF Core, SQLite, migrations
│   │   └── LogiFlow.Api.Tests/
│   └── frontend/
│       ├── src/
│       │   ├── api/               # generated client from OpenAPI
│       │   ├── features/          # one folder per domain feature
│       │   ├── components/
│       │   └── store/
│       └── tests/
├── tests/
│   └── e2e/                       # Playwright specs
├── .github/workflows/
└── README.md
```

## Backend layering (Clean/Onion architecture)

- **Domain** — entities, value objects, domain events. No dependencies on EF/ASP.NET.
- **Application** — use cases (CQRS-style commands/queries via MediatR), validation (FluentValidation).
- **Infrastructure** — EF Core DbContext, SQLite provider, repository implementations.
- **Api** — controllers/minimal API endpoints, DTOs, mapping (Mapster or manual), auth middleware.

Agents must respect this layering: the Backend Agent does not put business logic in controllers,
and does not let Infrastructure leak into Domain.

## Environment & local dev

- `dotnet run --project src/backend/LogiFlow.Api` — API on `https://localhost:5001`
- `npm run dev` in `src/frontend` — Vite dev server proxying `/api` to the backend
- SQLite file: `src/backend/LogiFlow.Api/logiflow.db`, recreated via `dotnet ef database update`
- Seed data script: `src/backend/LogiFlow.Infrastructure/Seed/SeedData.cs`, run automatically in
  `Development` and `Test` environments only.

## Non-functional baseline (applies to every feature)

- All list endpoints paginated (default page size 25, max 100).
- All write endpoints validate input server-side regardless of frontend validation.
- All timestamps stored UTC, displayed in user's local time in the frontend.
- Structured logging (Serilog) with correlation IDs on the backend.
- No secrets in repo — use `.env` / user-secrets, referenced in `07-coding-standards.md`.
