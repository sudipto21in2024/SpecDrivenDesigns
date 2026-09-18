# ADR-005: Database — SQLite v1 with PostgreSQL migration path

- **Status:** Accepted
- **Deciders:** Architect (inline) + Database subagent
- **Date:** 2026-09-18
- **Tech story:** LOGI-0000 — repo scaffolding

## Context
BRD §7 constrains v1 to ~50,000 shipments/year (single org, single node). `02` and `04` specify
SQLite with a documented upgrade path to PostgreSQL.

## Decision
We will use **SQLite** for v1 (file at `src/backend/LogiFlow.Api/logiflow.db`, gitignored,
regenerated via `dotnet ef database update` + Dev/Test-only seed). The PostgreSQL migration path
is **documented only** (this ADR); not implemented. EF Core abstractions keep Domain/Application
DB-agnostic.

## Consequences
- Positive: matches BRD volume assumptions; single-node simplicity; fast local dev + CI.
- Neutral: write-concurrency limits under heavy load (mitigated in §8 Risks + load-test at LOGI-0012).
- Migration path: swap `Sqlite` for `Npgsql` provider + connection string in Infrastructure only.

## Alternatives considered
- Start on PostgreSQL: over-engineering for v1 volume; rejected per BRD §7.

## References
- `11-BRD.md` §7 (assumptions)
- `04-database-schema.md` §Migration conventions
- `13-HLD.md` §8 (deployment), §4.2 (Infrastructure layer)
