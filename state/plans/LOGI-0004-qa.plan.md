---
ticket: LOGI-0004
arm: qa
status: done
created: 2026-09-20T07:34:43.126Z
depends_on_plans: LOGI-0004-architect, LOGI-0004-backend, LOGI-0004-frontend
---

## 1. Objective
LOGI-0004 QA (PRD F2): author Playwright E2E spec `tests/e2e/vehicles.spec.ts` covering AC-1..AC-9 against the live API+SPA (real auth via /auth/login, unique per-run data), plus a `VehiclesPage` page object mirroring `WarehousesPage`, and wire the e2e db reset + seed helpers to vehicles. RBAC exercised through real role sign-ins (same auth path as the warehouse E2E suite).

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/pages/vehicles.page.ts` | create | Page object: goto, list table, openCreate/edit, submit, delete, search, filters, toast, fieldError | ~110 |
| `tests/e2e/support/api.ts` | modify | Add `seedVehicle` helper + vehicles reset | ~25 |
| `tests/e2e/global-setup.ts` | modify | Reset vehicles table (collect ids, delete each) | ~20 |
| `tests/e2e/vehicles.spec.ts` | create | AC-1..AC-9 E2E: create list filter edit delete + 409 + 404 + RBAC(401/403) | ~200 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0004-vehicles-crud.md` | full | AC-1..AC-9 source of truth |
| `contracts/v1-openapi.yaml` | 315-419 | /vehicles contract (roles, 409, 404, paged envelope) |
| `tests/e2e/warehouses.spec.ts` | full | E2E idiom: beforeEach signIn Admin, seed(), findRow, expectToast, fieldError |
| `tests/e2e/pages/warehouses.page.ts` | full | Page-object idiom (goto, openCreate/openEdit, submit, deleteRow, row, search) |
| `tests/e2e/pages/login.page.ts` | full | signInAs(role) idiom |
| `tests/e2e/support/api.ts` | full | signIn/authHeaders/seedWarehouse idiom to extend |
| `tests/e2e/global-setup.ts` | full | DB reset idiom to extend |
| `src/frontend/src/features/vehicles/VehiclesPage.tsx` | full | data-testids used by selectors |
| `src/frontend/src/features/vehicles/VehicleFormDialog.tsx` | full | field labels + enum selects |

## 4. Steps (each with verify gate)
- [x] 1. Page object `vehicles.page.ts`: goto(role), list table, openCreate/openEdit, submitCreate/saveEdit, deleteRow, search(plate), status/type filter selects, expectToast, fieldError, row(plate) to verify: data-testids match VehiclesPage.tsx
- [x] 2. API helper + reset: seedVehicle(request, token, plate) in api.ts; global-setup resets vehicles table to verify: typecheck `npx tsc -p ../../tsconfig.json --noEmit` if available
- [x] 3. Spec `vehicles.spec.ts` AC-1..AC-9: create+persist, empty plate 400, duplicate plate 409 (UI + API), bad type 400, capacity <=0 400, omitted status to Available, list filters+pagination, edit+delete+404s, RBAC (anon 401, Viewer POST 403, Dispatcher DELETE 403) to verify: `npx playwright test --project=chromium vehicles.spec.ts` passes (or documented CI-only if no browser)
- [x] 4. Seal: journal qa-arm section; commit manifest-exact; handoff qa to done to verify: only Section-2 files + journal changed

## 5. Risks / open questions
- Playwright browser binaries may not install in this env to verify live. to verify: `npx playwright install chromium` if missing; if install is blocked, commit the spec (mirroring warehouse structure) and record as CI-only verification gate.
- E2E DB is throwaway SQLite reset per global-setup; vehicle seed uses unique per-run plate prefix.

## 6. Exit gates
- `vehicles.spec.ts` compiles; `global-setup` resets vehicles table.
- All AC-1..AC-9 assertions present; RBAC via real role sign-ins (anon 401, Viewer 403 on write, Dispatcher 403 on delete).
- No source / backend / frontend / contract file touched (qa boundary only).
