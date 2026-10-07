# E2E Knowledge Base — Playwright (`tests/e2e/`)

A set of documents explaining the **end-to-end suite**: how it boots the real stack, how it
seeding, what patterns the specs follow, and how to run/debug it. This is the browser-level
complement to the frontend unit tests and the backend API tests.

## Where things live

- E2E project root: `c:\Sudipto\SpecDrivenDesigns\tests\e2e` (standalone npm project, its own
  `node_modules`, its own `playwright.config.ts`).
- Specs: `tests/e2e/*.spec.ts` (25 files, **167 tests**).
- Page objects: `tests/e2e/pages/*.ts` (login, warehouses, vehicles, drivers, shipments,
  routes, planning-board, dashboard).
- Shared test helpers: `tests/e2e/support/*.ts` (auth/API seeds, shipment/route fixtures, custom
  locators, DB helpers).
- API launcher + DB lifecycle: `tests/e2e/start-api.mjs`, `tests/e2e/global-setup.ts`,
  `tests/e2e/support/paths.ts`.
- Designer screenshots (no assertions): `tests/e2e/capture-design-parity.mjs`.

## Reading order

| # | Document | What it answers |
|---|---|---|
| 01 | [01-tech-stack.md](01-tech-stack.md) | Playwright version, the two webServers, E2E project isolation, how the suite boots |
| 02 | [02-test-organization.md](02-test-organization.md) | Spec structure, page objects, support helpers, naming conventions, assertions |
| 03 | [03-api-and-db-lifecycle.md](03-api-and-db-lifecycle.md) | Throwaway SQLite, WAL + busy timeout, global-setup reset, LOGI-0013 pitfalls |
| 04 | [04-test-design-patterns.md](04-test-design-patterns.md) | App-level vs API-level helpers, seeding, unique data per run, retry safety, page objects |
| 05 | [05-shared-state-and-parallelism.md](05-shared-state-and-parallelism.md) | Why `workers: 1` + `fullyParallel: false`, shared drivers.user_id link, API-idle assumption |
| 06 | [06-running-and-debugging.md](06-running-and-debugging.md) | Commands, list/reporters, traces, codegen, UI mode, CI |
| 07 | [07-design-parity-tools.md](07-design-parity-tools.md) | `capture-design-parity.mjs` screenshots against the Docker stack |
| 08 | [08-end-to-end-flows.md](08-end-to-end-flows.md) | Traced walkthroughs: login, warehouse CRUD, shipment lifecycle, route assign race, authz |
| 09 | [09-cheat-sheet.md](09-cheat-sheet.md) | "Where do I change X" + reading path + how this suite relates to frontend/backend tests |

## The 60-second version

1. The suite never mocks: it boots the **real ASP.NET Core API** (a **throwaway SQLite** DB, per-run
   deleted before the API starts) plus the **production frontend build** (nginx preview on :5173),
   joined by the Vite dev proxy (`playwright.config.ts` `webServer`).
2. Specs talk to the **real API over HTTP** (`request`): login, create rows, read assertions, and
   UI via the real browser.
3. Fixture helpers seed rows **directly into SQLite** (`node:sqlite`) while the API is idle, because
   the API has no create-endpoint for some rows (AC-8 `sla_due_at = NULL`, planned windows) — WAL +
   busy timeout make that safe.
4. The suite is **single-worker and fully-parallel-off**: one shared database and a 1:1 `drivers.user_id`
   link across files, so a fixture must never race another spec's API call.
5. Every name/plate/licence is unique per **run** (`runId` + `seq`), so CI retries can never
   re-collide, and every spec signs in through the real `/auth/login` endpoint.

## Quick directory map

```text
tests/e2e/
├── playwright.config.ts      # workers:1, two webServers (API on 5199, preview on 5173), globalSetup
├── start-api.mjs             # wrapper that removes the stale DB, starts the API, kills it on exit
├── global-setup.ts           # resets the DB to empty BEFORE the run (via API only — LOGI-0013)
├── support/
│   ├── api.ts                # signIn, seedWarehouse, seedDriver, seedVehicle, authHeaders
│   ├── shipments.ts          # createShipment/listShipments + direct-sqlite seedShipment/seedShipmentAt
│   ├── routes.ts             # route CRUD + uniqueRef/routeName/window helpers
│   ├── route-shipments.ts, planning-board.ts, dashboard.ts, drivers.ts
│   └── paths.ts              # API_PROJECT, E2E_DB_PATH, API base URL (single source of truth)
├── pages/                    # page objects (selectors out of specs)
│   ├── login.page.ts, warehouses.page.ts, vehicles.page.ts, drivers.page.ts,
│   ├── shipments.page.ts, routes.page.ts, planning-board.page.ts, dashboard.page.ts
├── *.spec.ts                 # 25 spec files, 167 tests (LOGI-0001..0013)
└── capture-design-parity.mjs  # design-parity screenshots against live Docker stack
```
