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

## PR requirements (checked by Code Review Agent)

1. Diff matches the approved contract/spec — no scope creep.
2. Tests included and passing, coverage gates met (`06-testing-strategy-playwright.md`).
3. No linter/formatter violations.
4. No new dependency added without a one-line justification in the PR description.
5. DB migrations, if any, reviewed against `04-database-schema.md` conventions.
