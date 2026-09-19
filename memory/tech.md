# Tech Context

## Commands
| Task | Command |
|---|---|
| Backend build/test | `dotnet build src/backend/LogiFlow.sln` · `dotnet test src/backend/LogiFlow.Api.Tests` |
| Frontend | `npm --prefix src/frontend run build` · `... run test` · `... run generate:api` |
| E2E | `npx --prefix tests/e2e playwright test` (needs API on :5199) |
| Contract lint | spectral (see `.github/workflows/ci.yml`) |
| State store | `node tools/tracker/index.mjs <cmd>` |

## Environments
- API dev port 5199; E2E uses throwaway SQLite (`e2e-logiflow.db`) + `vite preview`.
- Shell is Git Bash on Windows (use POSIX syntax in commands).

## Constraints
- SDK 9.0.304; Node >= 18 (tracker CLI uses `node:util` parseArgs).
- Contracts are OpenAPI-first: no undocumented endpoints, CI fails on drift.
