# ADR-004: Frontend API client + mock server

- **Status:** Accepted
- **Deciders:** Architect (inline) + Frontend subagent
- **Date:** 2026-09-18
- **Tech story:** LOGI-0000 — repo scaffolding

## Context
`05-api-contract-standards.md` §contract-first requires the frontend to consume
`contracts/v1-openapi.yaml` as the source of truth and build against a mock while the backend
implements in parallel.

## Decision
We will generate a typed client with **`openapi-typescript`** + a thin `fetch` wrapper in
`src/api/`, and mock with **MSW**, where the mock handlers are derived from the same OpenAPI spec
so UI work is decoupled from backend completion.

## Consequences
- Positive: single spec drives both typing and mock; no endpoint invention by Frontend Agent.
- Neutral: regeneration step needed whenever the contract changes (CI warns on drift).
- Risk: MSW must stay in sync with contract edits; regenerate per ticket.

## Alternatives considered
- Hand-written axios client: drifts from contract; rejected (`05` §contract-first).

## References
- `05-api-contract-standards.md` §contract-first workflow
- `13-HLD.md` §4.1 (`api/` generated client)
