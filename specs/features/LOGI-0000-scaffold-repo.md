---
id: LOGI-0000
title: Repository scaffolding
status: draft
owner_agent: orchestrator
created: 2026-09-18
depends_on: []
---

## 1. Summary
As an **orchestrator**, I want a buildable repo with the LogiFlow solution, CI skeleton, contract stub, and ADRs so that every downstream feature ticket has a verified toolchain and a single source of truth for the API to code against.

## 2. Actors & roles
Bootstrap-only; no product roles. Owner: Orchestrator + Architect + DevOps (inline).

## 3. Preconditions
- `dotnet 9.0` SDK, Node 22, npm 11 available (confirmed).

## 4. Acceptance criteria (Given/When/Then)

**AC-1 — Backend builds**
```
Given the repo is scaffolded
When `dotnet build src/backend/LogiFlow.sln` runs in CI
Then it exits 0 and produces no compile errors
```

**AC-2 — Test project green**
```
Given LogiFlow.Api.Tests exists
When `dotnet test src/backend/LogiFlow.sln` runs
Then it exits 0 (0 tests is acceptable for the scaffold)
```

**AC-3 — Frontend builds**
```
Given src/frontend is scaffolded
When `npm --prefix src/frontend run build` runs
Then it exits 0 producing a dist/ bundle
```

**AC-4 — Health endpoint**
```
Given the API is running
When GET /api/v1/health is called (unauthenticated)
Then it returns 200 with {status:"ok", service:"LogiFlow"}
```

**AC-5 — OpenAPI stub + lint**
```
Given contracts/v1-openapi.yaml exists with security schemes + ProblemDetails
When `npx @stoplight/spectral lint contracts/v1-openapi.yaml` runs
Then it exits 0
```

**AC-6 — ADRs present**
```
Given docs/adr/000-template.md + 001..006 exist
When the Architect reviews them
Then each records a Context/Decision/Consequences block
```

## 5. Out of scope
- No domain entities, no real endpoints beyond health, no Playwright E2E, no seed data yet.

## 6. Data touched
- None (no tables yet). SQLite file path reserved: `src/backend/LogiFlow.Api/logiflow.db` (gitignored).

## 7. Open questions
- None for scaffold.

## 8. Non-functional
- CI must be green after this ticket; toolchain versions pinned in CI and ADRs.

---

## Downstream artifacts
- `src/backend/LogiFlow.sln` + 5 projects (Domain, Application, Infrastructure, Api, Api.Tests)
- `src/frontend/` (Vite + React-TS)
- `contracts/v1-openapi.yaml` (stub)
- `docs/adr/000-template.md`, `001`–`006`
- `.github/workflows/ci.yml`
- `src/backend/LogiFlow.Api/Program.cs` (health endpoint)
- `.gitignore`
