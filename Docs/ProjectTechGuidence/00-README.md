# LogiFlow — Autonomous Multi-Agent Software Delivery Spec Pack

**Project codename:** LogiFlow (Logistics Management & Planning Platform)
**Stack:** React (frontend) · ASP.NET Core (backend API) · SQLite (database) · Playwright (E2E tests)
**Delivery model:** Spec-driven, multi-agent, orchestrated in Kilo Code

This folder is the complete brief a Kilo Code multi-agent swarm needs to build LogiFlow end-to-end
with minimal human intervention. Every file here is a contract the agents read, follow, and update.

## How to use this pack

1. Load all files in this folder into Kilo Code as **project-level context / rules**.
2. Point the **Orchestrator Agent** at `10-orchestration-kilocode-config.md` first — it defines
   agent roles, routing, and the state machine every ticket moves through.
3. Feature work starts from `09-sample-feature-spec.md` as a template — the Spec Agent generates
   one of these per feature before any code is written.
4. Nothing gets implemented without: a spec → an API contract → a DB migration (if needed) → tests
   written first → implementation → Playwright E2E → review → merge. See `03-spec-driven-workflow.md`.

## File index

| File | Purpose |
|---|---|
| `01-agent-architecture.md` | Agent roster, responsibilities, inputs/outputs, boundaries |
| `02-tech-stack-and-structure.md` | Stack choices, repo layout, environment setup |
| `03-spec-driven-workflow.md` | The end-to-end SDLC state machine agents follow |
| `04-database-schema.md` | SQLite schema for the logistics domain (v1) |
| `05-api-contract-standards.md` | REST conventions, OpenAPI-first process, error format |
| `06-testing-strategy-playwright.md` | Test pyramid, Playwright conventions, coverage gates |
| `07-coding-standards.md` | C#/.NET and React/TypeScript style & quality rules |
| `08-ticketing-jira-analysis.md` | Jira free-tier + MCP cost/feasibility analysis and recommendation |
| `09-sample-feature-spec.md` | Template + one worked example (Shipment Creation) |
| `10-orchestration-kilocode-config.md` | Agent handoff protocol, state machine, guardrails |
| `11-BRD.md` | Business Requirements Document — objectives, scope, business rules |
| `12-PRD.md` | Product Requirements Document — personas, features, flows, NFRs |
| `13-HLD.md` | High-Level Design — architecture, components, diagrams, data flow, deployment |

## Domain in one paragraph

LogiFlow manages **warehouses, vehicles, drivers, shipments, and routes**. Dispatchers create
shipments, the system plans/assigns routes and vehicles, drivers execute and update status from
a mobile-friendly view, and managers get dashboards on SLA, utilization, and delays. v1 scope is
deliberately narrow (see `03-spec-driven-workflow.md` §Scope Guardrails) — agents must not silently
expand scope; new capabilities require a new spec.
