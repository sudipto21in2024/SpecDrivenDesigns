# Patterns & Decisions

Key implementation patterns discovered during work. Append-only; cite file paths.

- CQRS via MediatR: commands/queries in `LogiFlow.Application/Features/<Entity>/`, validation via FluentValidation pipeline behavior (`Behaviors/ValidationBehavior.cs`).
- Errors: RFC 7807 ProblemDetails via `ExceptionHandlingMiddleware`; contract error shapes per `05-api-contract-standards.md`.
- API client on frontend is generated (`npm run generate:api` → `src/api/schema.d.ts`); no hand-written clients. MSW mocks derive from the same OpenAPI file.
- Frontend validation: RHF + Zod mirroring backend rules (see `features/warehouses/schema.ts`).
- E2E: POM in `tests/e2e/pages/`, ticket-id + AC comments 1:1 with spec ACs; DB reset via API in `global-setup.ts`.
- Icons: inline `SvgIcon` (MIT path data) — `@mui/icons-material` deep imports break under Vite (defect found by E2E in LOGI-0001; package removed).
- Agent boundaries: Backend may not touch `contracts/**` or `src/frontend/**`; only Architect edits contracts (`01-agent-architecture.md`).
