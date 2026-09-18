# ADR-001: Target .NET 9.0 minimal APIs

- **Status:** Accepted
- **Deciders:** Architect (inline)
- **Date:** 2026-09-18
- **Tech story:** LOGI-0000 — repo scaffolding

## Context
`Docs/ProjectTechGuidence/02-tech-stack-and-structure.md` states ASP.NET Core 8 / C# 12, but
the only SDK installed in this environment is .NET 9.0.304. Building against net8.0 would
require an additional SDK install; the architecture (Minimal APIs, Clean/Onion layering,
MediatR, EF Core) is functionally identical between 8 and 9.

## Decision
We will target **net9.0** with **Minimal APIs** (ASP.NET Core 9). EF Core 9,
`Microsoft.Extensions.Identity.EntityFrameworkCore` 9, `Microsoft.AspNetCore.Authentication.JwtBearer` 9.

## Consequences
- Positive: matches the installed SDK; one `dotnet build` works.
- Neutral: pack docs say "8"; we record the deviation here. Behavior is equivalent for v1.
- Risk: if the production target is pinned to 8, switch the TFM + package versions in one ADR
  (PostgreSQL migration ADR-005 can absorb it).

## Alternatives considered
- Install .NET 8 SDK: adds environment setup friction; not chosen for v1.

## References
- `02-tech-stack-and-structure.md` §Stack
- `13-HLD.md` §4.2 (Api layer)
