# Coding Standards

## General

- No secrets in the repo. Backend: `dotnet user-secrets` locally, environment variables in CI/prod.
  Frontend: `.env.local`, never committed (`.gitignore` enforced).
- Every public method/endpoint has XML doc (C#) or JSDoc (TS) if its purpose isn't obvious from
  the name.
- No commented-out code merged. No `TODO` without a linked ticket id.
- Commit messages: `<TICKET-ID>: <imperative summary>` e.g. `LOGI-0007: add shipment creation endpoint`.

## Backend (C# / ASP.NET Core)

- Nullable reference types enabled project-wide.
- CQRS via MediatR: one command/query + handler per use case in `Application/`.
- Validation via FluentValidation, run automatically through a MediatR pipeline behavior — no
  manual `if (x == null)` scattered in handlers.
- Domain entities are not anemic where it matters: state-transition logic (e.g.
  `Shipment.TransitionTo(status)`) lives on the entity, validating legal transitions, not in a
  controller or a generic "UpdateStatus" service.
- Repositories return domain entities, not EF Core-tracked entities leaking into `Application`.
- Async all the way — no `.Result` / `.Wait()` blocking calls.
- Logging via `ILogger<T>`, structured (no string concatenation of variables into log messages).
- `dotnet format` must pass with no diffs before a PR is opened.

## Frontend (React / TypeScript)

- Strict TypeScript (`strict: true`), no `any` without a `// eslint-disable-next-line` + reason.
- Functional components + hooks only. No class components.
- Server state via TanStack Query (no manual `useEffect` + `fetch` + `useState` data-fetching).
- Forms via React Hook Form + a schema validator (Zod) mirroring backend FluentValidation rules
  where practical, so client and server reject the same invalid input.
- One feature = one folder under `src/features/<feature>/` containing components, hooks, and
  types local to that feature; shared UI lives in `src/components/`.
- `eslint` + `prettier` must pass with no errors before a PR is opened.
- Accessibility: forms have labels, interactive elements are keyboard-navigable, color is never
  the only status indicator (pair status badges with text/icon).

## File-size governance — code files (RIGID, LOGI-0015)

- **No code file may exceed 150 lines.** When a file would cross 150 lines, split or
  modularize it first (extract submodule / per-resource file / helper module), then add code.
- **Scope:** `.cs`, `.ts`/`.tsx`, `.mjs`/`.cjs`, and the contract authorship fragments
  (`contracts/v1/**/*.yaml`). Applies from file creation onward, in every arm and every step.
- **Out of scope by design:** Markdown (docs, specs, plans, journals — prose is not
  modularized by line count) and JSON (project-management, `state/`, telemetry/logs).
- **Other exemptions:** generated artifacts (`contracts/v1-openapi.yaml`,
  `src/frontend/src/api/schema.d.ts`), EF Core `Migrations/**`, lockfiles, minified assets,
  binaries/DBs/logs, `test-results/`, `graphify-out/`.
- Enforcement: `node tools/contract/check-size.mjs` (CI `File-size gate`, repo-wide);
  `--staged` for the local pre-commit check; `--files a,b` for an arm's touched set.
- **Grandfathered legacy files** live in `tools/contract/size-baseline.json` as a
  *shrink-only ratchet*: the recorded line count is the ceiling, so any growth above it
  fails the gate (`--update-baseline` re-records, only as part of a modularization arm).
- Sizing counts physical lines (`wc -l` semantics, blank lines included).

## PR requirements (checked by Code Review Agent)

1. Diff matches the approved contract/spec — no scope creep.
2. Tests included and passing, coverage gates met (`06-testing-strategy-playwright.md`).
3. No linter/formatter violations.
4. No new dependency added without a one-line justification in the PR description.
5. DB migrations, if any, reviewed against `04-database-schema.md` conventions.
