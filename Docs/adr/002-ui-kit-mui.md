# ADR-002: UI Kit — Material UI v5

- **Status:** Accepted
- **Deciders:** Architect (inline)
- **Date:** 2026-09-18
- **Tech story:** LOGI-0000 — repo scaffolding

## Context
`02` requires picking MUI or Ant Design and recording the choice. The PRD personas (dispatcher on
tablets, manager dashboards, enterprise tables/forms) need a mature data-grid and form suite.

## Decision
We will use **Material UI v5 (MUI)** with the **MUI X Data Grid** component for tables, and
**@emotion/styled** (MUI default) styling. No Ant Design.

## Consequences
- Positive: MUI X DataGrid covers enterprise tables (sorting, pagination, filtering) out of the
  box; matches the HLD component table (`13-HLD.md` §4.1).
- Neutral: adds bundle size; mitigated by code-splitting per `vercel-react-best-practices` rules.
- Accessibility: MUI is WCAG 2.1 AA compliant by default (matches PRD §6 NFR).

## Alternatives considered
- Ant Design: comparable, but MUI chosen for closer alignment with the HLD component map and
  existing team familiarity signals.

## References
- `02-tech-stack-and-structure.md` §Stack
- `12-PRD.md` §3 (modules need data grids)
- `07-coding-standards.md` §Frontend (strict TS, no any)
