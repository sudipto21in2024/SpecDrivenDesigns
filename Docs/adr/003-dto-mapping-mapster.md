# ADR-003: DTO mapping via Mapster

- **Status:** Accepted
- **Deciders:** Backend subagent (on Architect's plan)
- **Date:** 2026-09-18
- **Tech story:** LOGI-0000 — repo scaffolding

## Context
Domain entities must not leak into the Application/API layers. We need projection between EF
entities and DTOs/response models with minimal boilerplate and no runtime reflection cost in the
hot path.

## Decision
We will use **Mapster** (compile-time `Mapster.Generator` where possible). Mappings live in
`Infrastructure/Mapping/` (DB→domain) and `Api/Dto/` (domain→response) as type adaptors,
registered once at startup.

## Consequences
- Positive: near-zero boilerplate; compile-time checks catch mapping drift.
- Neutral: a new dependency — justification: replaces hand-written mappers across 6 CRUD features.
- Risk: keep mappings co-located with the layer that owns the target type to avoid leakage.

## Alternatives considered
- Manual mapping: more verbose, error-prone at scale; rejected for v1 velocity.
- AutoMapper: runtime reflection; heavier; Mapster preferred.

## References
- `07-coding-standards.md` §Backend (repositories return domain entities)
- `13-HLD.md` §4.2 (Api layer: DTOs, mapping)
