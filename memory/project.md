# Project — LogiFlow

Logistics management web application (warehouse-to-delivery operations). Spec-driven,
multi-agent delivery; every unit of work is a ticket in `specs/features/` moving through
the state machine in `Docs/ProjectTechGuidence/03-spec-driven-workflow.md`.

| Layer | Technology |
|---|---|
| Frontend | React 18 / Vite / TypeScript / MUI v5 |
| Backend | ASP.NET Core 9 Minimal APIs, CQRS (MediatR), FluentValidation, Mapster |
| Database | SQLite v1 (PostgreSQL path: ADR-005) |
| E2E | Playwright (POM pattern, API-driven DB reset) |
| Contract | OpenAPI 3.1 — `contracts/v1-openapi.yaml` is the single source of truth |

v1 scope: warehouses, vehicles, drivers, shipments (CRUD + lifecycle), manual route
assignment, planning board, dashboard, RBAC. Out of scope: route optimization, real-time
GPS, 3rd-party carriers, billing, multi-tenancy, native mobile.
