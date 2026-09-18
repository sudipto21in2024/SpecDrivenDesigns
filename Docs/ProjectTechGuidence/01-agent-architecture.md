# Agent Architecture

## Design principles

- **Single responsibility per agent.** Each agent owns one stage of the SDLC and one type of
  artifact. No agent writes code *and* defines requirements *and* approves its own PR.
- **File-based contracts, not chat memory.** Agents hand off work via files in the repo
  (`/specs`, `/contracts`, `/docs/adr`), never via ephemeral conversation only. Anything an
  agent needs to remember must be written down.
- **Orchestrator is the only agent allowed to change agent-to-agent routing.** Worker agents
  never invoke each other directly — they finish their artifact, update ticket status, and the
  Orchestrator dispatches the next agent.
- **Every agent can be replayed.** Given the same input spec + repo state, an agent's output
  should be reproducible. Non-determinism (e.g. creative naming) is fine; behavior/logic is not.

## Agent roster

### 1. Orchestrator Agent
- **Input:** ticket backlog (`/specs/backlog/*.md`), current repo/CI state
- **Output:** ticket state transitions, agent dispatch decisions, escalations to human
- **Responsibilities:** owns the state machine in `03-spec-driven-workflow.md`; enforces gates
  (no code without approved spec, no merge without green Playwright suite); resolves agent
  conflicts; never writes product code itself.

### 2. Spec/Product Agent
- **Input:** feature request, domain doc, existing specs
- **Output:** `/specs/features/<id>-<slug>.md` following `09-sample-feature-spec.md` template
- **Responsibilities:** clarifies scope, writes acceptance criteria in Gherkin-style
  Given/When/Then, defines out-of-scope explicitly, flags open questions for humans instead of
  guessing on ambiguous business rules (e.g. tax rules, SLA penalty math).

### 3. Architect Agent
- **Input:** approved feature spec
- **Output:** `/contracts/<id>-openapi.yaml` (or diff), `/docs/adr/<n>-<slug>.md` for any
  non-trivial decision, DB migration plan (references `04-database-schema.md`)
- **Responsibilities:** turns the spec into an API contract *before* any implementation agent
  touches code (API-first). Decides sync vs async, pagination, error shapes per
  `05-api-contract-standards.md`. Does not implement.

### 4. Backend Agent (ASP.NET Core)
- **Input:** approved OpenAPI contract + DB migration plan
- **Output:** controllers/minimal APIs, services, EF Core migrations, unit tests
- **Responsibilities:** implements exactly what the contract says — no undocumented endpoints,
  no schema drift. Writes xUnit tests alongside code (TDD where feasible). Runs `dotnet build`
  and `dotnet test` before marking done.

### 5. Frontend Agent (React)
- **Input:** approved OpenAPI contract, feature spec (for UX acceptance criteria), design tokens
- **Output:** components/pages, API client (generated from OpenAPI), unit tests (Vitest/RTL)
- **Responsibilities:** consumes the contract, never invents endpoints. Builds against a mock
  server generated from the same OpenAPI file so it can proceed in parallel with the Backend Agent.

### 6. Database Agent
- **Input:** DB migration plan from Architect Agent
- **Output:** EF Core migration files, seed data scripts, updated `04-database-schema.md`
- **Responsibilities:** owns schema evolution, indexing, and referential integrity. Reviews any
  migration the Backend Agent proposes before it's applied.

### 7. QA/Test Agent (Playwright)
- **Input:** approved feature spec (acceptance criteria), running app (backend + frontend)
- **Output:** `/tests/e2e/<feature>.spec.ts`, test report
- **Responsibilities:** translates Given/When/Then acceptance criteria into Playwright specs.
  Writes tests against acceptance criteria, not against the implementation, to catch spec
  deviations. Owns `06-testing-strategy-playwright.md` conventions.

### 8. Code Review Agent
- **Input:** PR diff, coding standards, contract, spec
- **Output:** review comments, approve/request-changes decision, `/docs/reviews/<pr>.md`
- **Responsibilities:** independent from the agent that wrote the code (never self-review).
  Checks standards compliance (`07-coding-standards.md`), contract fidelity, test coverage, and
  security basics (input validation, authz checks, no secrets committed).

### 9. DevOps/CI Agent
- **Input:** merged PRs
- **Output:** CI pipeline config, build artifacts, deployment scripts
- **Responsibilities:** keeps `dotnet build`, `npm run build`, `npm run test`, and
  `npx playwright test` green on every PR; manages environment config and SQLite file lifecycle
  for CI (fresh DB per run via migrations + seed).

### 10. Documentation Agent
- **Input:** merged features
- **Output:** updated `/docs/user-guide/*.md`, changelog entries
- **Responsibilities:** keeps user-facing and developer-facing docs in sync with what actually
  shipped, not what was originally specced.

## Explicit boundaries (what agents must NOT do)

- Backend/Frontend agents must not modify `/contracts/*.yaml` — only the Architect Agent does.
- No agent merges its own PR — only Orchestrator, gated on Code Review Agent approval + green CI.
- Spec/Architect agents must not write implementation code.
- QA Agent must not fix failing tests by weakening assertions — a failing test either means a
  spec violation (send back to Backend/Frontend) or a spec ambiguity (send back to Spec Agent).
