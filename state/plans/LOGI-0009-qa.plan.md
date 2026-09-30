---
ticket: LOGI-0009
arm: qa
status: locked
created: 2026-09-29T15:08:12.446Z
depends_on_plans: LOGI-0009-backend, LOGI-0009-frontend
---

## 1. Objective
LOGI-0009 QA: prove create/assign/list/detail routes (AC-1..AC-10) end-to-end against the real API + throwaway SQLite (no MSW): field-keyed 400s, FK 404s, BR-3/BR-4 overlap 409s, Planned-only PATCH 409, BR-6 RBAC matrix, AC-8 delete-when-referenced 409s, plus the Routes UI seam via a page object. Remote CI is async, never polled.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/support/routes.ts` | create | Route API helpers (`createRoute`/`getRoute`/`listRoutes`/`patchRoute`, tolerant 2xx/4xx bodies) + `seedRoute` via `node:sqlite` for status/window shapes the API cannot mint (AC-4, AC-5 InProgress half, AC-6) | ~150 |
| `tests/e2e/routes-create.spec.ts` | create | AC-1 create happy path + no shipment write, AC-2 unassigned→assign→unassign, AC-3 field-keyed 400s, AC-4 FK/unknown-id 404s, AC-5 overlap 409s + boundary/terminal non-conflicts, AC-6 Planned-only 409, AC-10 server-owned fields | ~180 |
| `tests/e2e/routes-list.spec.ts` | create | AC-9 envelope, AND filters (q/status/vehicleId/driverId), q = name contains, default sort -createdAt, unknown status 400 | ~90 |
| `tests/e2e/routes-authz.spec.ts` | create | AC-7 real-JWT matrix (anon 401, Viewer 200/403, Driver own-routes-only + 403 on another driver's detail, Admin/Dispatcher 2xx, nothing written on reject) + AC-8 delete-when-referenced 409 for vehicles and drivers | ~150 |
| `tests/e2e/pages/routes.page.ts` | create | Page object: sign-in → Routes tab, New/Edit drivers for both dialogs, MUI Select picks, filters, rows, snackbar/field-error probes (LOGI-0009 UI seam) | ~150 |
| `tests/e2e/routes-ui.spec.ts` | create | UI seam: create through the dialog, client-side validation, edit assign/unassign, overlap 409 Alert on screen, status filter + search + reset, role gating for Viewer/Driver | ~120 |
| `tests/e2e/global-setup.ts` | modify | Reset `routes` before vehicles/drivers — a leftover route now makes the existing vehicle/driver deletes answer 409 (no DELETE /routes endpoint exists by design, so the reset writes the row delete directly) | ~20 |
| `tests/e2e/playwright.config.ts` | modify | Pin `workers: 1`: the suite shares one SQLite file (direct fixtures) and the 1:1 `drivers.user_id` link, so parallel files can 409 each other — the assumption `support/shipments.ts` already documents | ~7 |
| `specs/features/LOGI-0009-create-route.md` | modify | Downstream-artifact traceability + front-matter status → done on seal | ~4 |
| `memory/journal/LOGI-0009.md` | modify | Sealed via `tracker seal` (CLI-owned, never hand-edited) | ~10 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0009-create-route.md` | §4 AC-1..AC-10, §5-§7 | source of truth for every assertion + deferrals |
| `tests/e2e/support/shipments.ts` | 55-140 | `node:sqlite` fixture idiom (busy_timeout, EF DateTime layout) to mirror |
| `tests/e2e/support/api.ts` | full | `signIn`/`authHeaders`/`seedVehicle`/`seedDriver` idioms |
| `tests/e2e/global-setup.ts` | 30-40 | reset order comment ("routes must be deleted first") |
| `tests/e2e/pages/vehicles.page.ts` | full | page-object idiom (MUI Select pick, dialog drivers) |
| `tests/e2e/vehicles.spec.ts` | 150-210 | RBAC-matrix test idiom (401/403 + UI affordance mirror) |
| `tests/e2e/shipment-ui.spec.ts` | full | thin UI-seam spec idiom |
| `tests/e2e/playwright.config.ts` | full | throwaway DB + preview server wiring, no CI polling |
| `src/frontend/src/features/routes/RoutesPage.tsx` | 140-340 | testids/labels the page object drives |
| `src/frontend/src/features/routes/RouteFormDialog.tsx` | 106-206 | create-dialog labels + `route-submit` testid |
| `src/frontend/src/features/routes/EditRouteDialog.tsx` | 139-252 | edit-dialog labels + `route-save` testid |
| `src/backend/LogiFlow.Application/Features/Routes/RouteQueries.cs` | 58-106 | Driver own-routes scoping + filter semantics |
| `src/backend/LogiFlow.Infrastructure/Persistence/Configurations/RouteConfiguration.cs` | full | `routes` table/column names for the SQLite fixture |
| `src/backend/LogiFlow.Api/Endpoints/RouteEndpoints.cs` | full | route/verb + role annotations the matrix asserts |

## 4. Steps (each with verify gate)
- [x] 1. **M1 Logic — routes fixture + API matrix AC-1..AC-10.** Add `support/routes.ts` (typed helpers + `seedRoute` direct-SQLite fixture for non-Planned statuses and pinned windows) and the three API specs (`routes-create`, `routes-list`, `routes-authz`), and make `global-setup.ts` delete `routes` before vehicles/drivers. → verify: `npx playwright test routes-create.spec.ts routes-list.spec.ts routes-authz.spec.ts` green locally.
- [x] 2. **M2 Integration+UI — Routes screen seam.** Add `pages/routes.page.ts` (accessible selectors only) and `routes-ui.spec.ts`: create through the dialog, validation message, assign/unassign via Edit, overlap 409 surfaced in the Alert, status filter/search/reset, Viewer/Driver affordance gating. → verify: `npx playwright test routes-ui.spec.ts` green locally.
- [x] 3. **M3 Arm verification + handoff.** Full local `npx playwright test` green (0 failed, 0 flaky), every test carries `// LOGI-0009 AC-n`, AC-1..AC-10 all mapped, spec → `done`, one atomic commit, `tracker seal` + handoff qa→done. → verify: `git status --short` lists only §2 files.

## 5. Risks / open questions
- Route statuses are server-owned: the API can only mint `Planned`, so AC-5's InProgress half, AC-6 and the terminal-route non-conflict case need a direct SQLite `routes` INSERT (precedent: `support/shipments.ts`). Keep the API as the only writer of everything else and set `busy_timeout` (API is idle — `fullyParallel: false`).
- Generated route ids are not known before a create; fixtures always return ids and specs assert per-id rows so a retry (`retries: 1`) cannot collide.
- Driver scoping keys off `drivers.user_id = current user`: linking the seeded Driver account is 1:1, so the authz spec links it, asserts, and always unlinks again — a run must leave that link as it found it (drivers.spec's AC-5 POST expects 201 whenever it runs). Cross-file parallelism is what made that window unsafe, hence `workers: 1` in the config.
- Killing ports 5199/5173 before a local run forces `start-api.mjs` to start a fresh throwaway DB; `--no-build` means `dotnet build -c Release` must have run.
- The Routes screen names FK columns via `/vehicles`+`/drivers` reads; for a Driver both reads fail (403) and the fallback text `Driver #<id>` / `Vehicle #<id>` is the visible assertion.
- If a UI behaviour proves undrivable on the real stack, drop the assertion and journal it rather than touching `src/**` or `contracts/**` (QA boundary).

## 6. Exit gates
- AC-1..AC-10 each proven end-to-end against the real API + throwaway SQLite (no MSW, no mocks), every test carrying a `// LOGI-0009 AC-n` traceability comment.
- Real-JWT authz matrix: anonymous 401 on all four route ops; Viewer 200 GET / 403 POST+PATCH; Driver 403 POST+PATCH, list scoped to own routes, another driver's detail 403; Admin + Dispatcher 2xx.
- AC-8 proven cross-ticket: DELETE /vehicles/{id} and DELETE /drivers/{id} answer 409 while a route references them, 204 when unreferenced.
- Local `npx playwright test` → base 10 files plus 4 new specs passed, 0 failed, 0 flaky; LOGI-0004/0005/0006/0007/0008 specs still green unmodified.
- Nothing outside §2 changed; journal sealed; handoff qa→done recorded; spec front matter `done`.
