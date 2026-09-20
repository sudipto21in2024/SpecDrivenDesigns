---
ticket: LOGI-0004
arm: frontend
status: done
created: 2026-09-20T06:08:28.681Z
depends_on_plans: LOGI-0004-architect, LOGI-0004-backend
---

## 1. Objective
LOGI-0004 frontend (PRD F2, spec approved, backend done + 30/30 green): regenerate typed client from the contract for `/vehicles` + build `features/vehicles/*` UI mirroring warehouses (list with q/status/type filters, create/edit forms with enum selects + status default, 409 surfacing, role-gated actions) + MSW handlers + vitest suite. RBAC affordances mirror contract x-roles (read all roles, write Admin/Dispatcher, delete Admin-only).

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/client.ts` | modify | Vehicle types + CRUD methods — AC-1..AC-8 | ~45 |
| `src/frontend/src/api/schema.d.ts` | regenerate | `generate:api` from contract (Vehicle*) | ~0 |
| `src/frontend/src/features/vehicles/schema.ts` | create | Zod form schema (plate/type/capacity/status) | ~40 |
| `src/frontend/src/features/vehicles/hooks.ts` | create | React-query hooks (list q/status/type + CRUD) | ~55 |
| `src/frontend/src/features/vehicles/VehicleFormDialog.tsx` | create | Create/edit dialog (enum selects, 409) | ~150 |
| `src/frontend/src/features/vehicles/VehiclesPage.tsx` | create | List + filters + role-gated actions | ~200 |
| `src/frontend/src/features/vehicles/VehiclesPage.test.tsx` | create | Vitest suite (create/validate/409/filter/roles) | ~180 |
| `src/frontend/src/features/auth/permissions.ts` | modify | view/edit/deleteVehicles capabilities | ~10 |
| `src/frontend/src/mocks/handlers.ts` | modify | vehiclesDb + /vehicles handlers (401/403/409/404) | ~140 |
| `src/frontend/src/test/renderApp.tsx` | modify | resetMocks clears vehicles store | ~3 |
| `src/frontend/src/App.tsx` | modify | Nav between Warehouses + Vehicles | ~40 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0004-vehicles-crud.md` | full | AC-1..AC-9 source of truth |
| `contracts/v1-openapi.yaml` | 122-154, 315-419 | Vehicle schemas + x-roles to mirror |
| `src/frontend/src/api/client.ts` | full | Warehouse methods + ApiError idiom to extend |
| `src/frontend/src/features/warehouses/WarehousesPage.tsx` | full | Page idiom (pagination, search, dialogs) |
| `src/frontend/src/features/warehouses/hooks.ts` | full | Hook idiom (keys, invalidation) |
| `src/frontend/src/features/warehouses/schema.ts` | full | Zod schema idiom |
| `src/frontend/src/features/warehouses/WarehouseFormDialog.tsx` | full | Dialog idiom (RHF+Zod, field/server errors) |
| `src/frontend/src/features/auth/permissions.ts` | full | Capability convention to extend |
| `src/frontend/src/mocks/handlers.ts` | full | MSW idiom (auth, paged list, validate, seed) |
| `src/frontend/src/test/renderApp.tsx` | full | Test harness to extend |
| `src/frontend/src/App.tsx` | full | Chrome to add nav to |

## 4. Steps (each with verify gate)
- [x] 1. Typed client: `npm run generate:api` in src/frontend, add `Vehicle`/`VehicleInput` types + list/get/create/update/delete methods (list takes page/pageSize/q/status/type) → verify: `grep -n Vehicle src/frontend/src/api/schema.d.ts` shows VehicleRequest/Response; `npx tsc --noEmit` passes
- [x] 2. Capabilities + mocks: `viewVehicles`/`editVehicles`/`deleteVehicles` in permissions.ts (same matrix as warehouses); vehiclesDb + seedVehicle/resetVehiclesDb + full /vehicles MSW handlers (paged q/status/type, validate → 400, duplicate plate → 409 Conflict, 404s, same authorize matrix); renderApp resetMocks clears vehicles too → verify: `npm test` existing suites still green
- [x] 3. Feature UI: schema.ts (plate 1..20, type/status enums, capacity > 0 string-coerced), hooks.ts, VehicleFormDialog.tsx (enum selects, status defaults Available, 409 → plateNumber field error, other → Alert), VehiclesPage.tsx (search + status/type filter selects, paged table, role-gated New/Edit/Delete) → verify: `npx tsc --noEmit` passes
- [x] 4. Chrome + tests: App.tsx nav (Tabs Warehouses/Vehicles); VehiclesPage.test.tsx (AC-1 create, AC-2/4/5/6 validation, AC-3 409, AC-7 filters+pagination, AC-8 edit/delete+404 via UI paths, AC-9 Viewer no write buttons + Dispatcher no delete) → verify: `npm test` full suite green
- [x] 5. Seal: journal frontend-arm section; commit manifest-exact; handoff frontend→qa → verify: `git status --short` only §2 + journal

## 5. Risks / open questions
- `generate:api` runs openapi-typescript 7 against the edited contract — if regen diffs unrelated schemas, keep only Vehicle* hunks + review the rest by hand.
- MSW `resetMocks` signature is shared — add `resetVehiclesDb` there without changing existing call sites.
- App nav: keep single QueryClient; tab state local to App (no router — matches current single-page chrome).

## 6. Exit gates
- `npx tsc --noEmit` clean; `npm test` full suite green (warehouse + auth + vehicle suites).
- Duplicate plate in UI → 409 surfaces as plate field error, no silent failure.
- Viewer sees list only (no New/Edit/Delete); Dispatcher sees New/Edit but no Delete; server 403s regardless.
- No backend/contract/test-e2e file touched (arm boundary).
