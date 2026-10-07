# 01 — E2E Tech Stack

Playwright as the browser-level acceptance layer for the whole integrated system.

## 1. The stack

| Piece | Version / role | Where |
|---|---|---|
| `@playwright/test` | **1.63.0** (standalone E2E project) | `tests/e2e/node_modules` + `package.json` scripts |
| Backend API | ASP.NET Core 9, started by `start-api.mjs` | `src/backend/LogiFlow.Api` (Release, no-build) on `http://localhost:5199` |
| Frontend | Vite 8 dev server / `vite preview` — **built once**, served from `dist/` on :5173 | `src/frontend` |
| Database | SQLite WAL, **throwaway** E2E DB at `<backend>/e2e-logiflow.db` | `support/paths.ts`, `playwright.config.ts`, `start-api.mjs` |

There is no MSW, no mock API, and no component harness in the E2E suite — the browser drives the
real SPA against the real API, and assertions are made against real HTTP responses and real DOM
state.

## 2. Playwright configuration summary (`playwright.config.ts`)

```ts
testDir: '.', timeout: 30_000, expect.timeout: 7_000
workers: 1, fullyParallel: false, retries: CI ? 1 : 0      // LOGI-0009, LOGI-0013
reporter: CI ? [['list'], ['html']] : [['list']]
use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure', actionTimeout: 7_000 }
webServer: [
  { command: 'node start-api.mjs', url: 'http://localhost:5199/api/v1/health', timeout: 90_000,
    env: { ASPNETCORE_ENVIRONMENT: 'Development', E2E_DB_PATH, Database__ConnectionString },
    reuseExistingServer: !process.env.CI },
  { command: 'npm --prefix ../../src/frontend run build && npm --prefix ../../src/frontend run preview -- --port 5173 --strictPort',
    url: 'http://localhost:5173', timeout: 180_000, reuseExistingServer: !process.env.CI },
]
globalSetup: './global-setup.ts',
```

Key implications:

- **Two web servers, both owned by Playwright.** The API is started before any spec runs; the
  frontend preview is the SPA shell the browser loads.
- `reuseExistingServer: !process.env.CI` — local: restart only if dead; CI: always start fresh.
- `trace: 'retain-on-failure'` — Playwright traces recorded for failed tests (step-by-step
  screenshots + DOM + network), the normal debugging surface.
- `actionTimeout: 7s` — a click/fill can take this long before erroring (tests are mostly
  under a second; the 7s ceiling keeps flakes down).
- `fullyParallel: false` + `workers: 1` (see doc 05) — the single in-file test seriality is the
  spec's own `test.beforeEach` + unique-data idiom; concurrency is the exception, never the rule.

## 3. The launch sequence

```text
npx playwright test                                   (package.json: "test": "playwright test")
  → global-setup.ts runs FIRST (before any spec, before webServer? no — after webServer start):
       1. sign in as Admin + Dispatcher via the API
       2. reset every collection to empty (delete all rows) per run
  → webServer start:
       1. start-api.mjs: remove stale DB files, then `dotnet run --project LogiFlow.Api` with
          Database__ConnectionString = the throwaway file (⇒ e2e-logiflow.db)
       2. frontend preview build + preview server on :5173
  → spec files run in order (testDir: '.', worker 1) — one DB, one browser context
  → test-results/ + playwright-report/ (present if CI: html reporter)
```

Playwright starts webServers **before** `globalSetup`, which is why cleanup lives there: the API
is already up and holding the file open; the reset therefore goes **through the API only** (delete
every row). Deleting the live file directly was the old LOGI-0013 approach and is a documented
anti-pattern — on Linux `unlink` succeeds while SQLite keeps the handle, so writes continue into a
deleted inode, the next physical connection re-creates an empty database, and every request 500s.
Windows locks open files (so CI was the only place it ever broke).

## 4. Environment variables the suite cares about

| Var | Consumption | Purpose |
|---|---|---|
| `E2E_DB_PATH` | `support/paths.ts` → `playwright.config.ts` → `start-api.mjs` (and fixtures) | absolute path of the throwaway SQLite DB; must be absolute so the API's CWD never changes which file it sees |
| `Database__ConnectionString` | `playwright.config.ts` → API webServer env | exactly the value fixtures seed into |
| `ASPNETCORE_ENVIRONMENT` | API webServer env | Development: migrations + SeedData run at startup |
| `CI` | `playwright.config.ts` | enables retries (1), list+html reporters |

The E2E DB file is deliberately **inside the backend project** (`src/backend/e2e-logiflow.db`),
and `support/paths.ts` is the only place that absolute path exists — a second copy of the
constant is exactly how the suite would drift into "the API writes to A while a fixture seeds the API's B".
