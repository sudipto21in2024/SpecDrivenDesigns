---
ticket: LOGI-0007
arm: frontend
status: locked
created: 2026-09-23T12:57:40.765Z
depends_on_plans: LOGI-0007-architect, LOGI-0007-backend
---

## 1. Objective
F5 create + F8 list/search UI: typed-client regen, shipments feature (paged list with AND filters/sort/at-risk badge + create dialog), MSW mirror of GET/POST /shipments, role gating, vitest AC coverage.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/schema.d.ts` | regenerate | `npm run generate:api` — ShipmentRequest/ShipmentResponse + GET/POST /shipments (AC-1, AC-6) | 0 (regen) |
| `src/frontend/src/api/client.ts` | modify | `Shipment`/`ShipmentInput`/`ShipmentPriority`/`ShipmentSort` aliases + `api.listShipments(params)` + `api.createShipment(input)` (AC-1, AC-6..AC-9) | ~45 |
| `src/frontend/src/features/auth/permissions.ts` | modify | `viewShipments` (Admin/Dispatcher/Viewer, Driver excluded) + `createShipments` (Admin/Dispatcher) (AC-10) | ~10 |
| `src/frontend/src/features/shipments/schema.ts` | create | Zod create schema: originWarehouseId positive int, destinationAddress 1..500, weightKg >0, priority enum default Standard, optional lat/lng; `toShipmentInput` (AC-1..AC-4) | ~45 |
| `src/frontend/src/features/shipments/hooks.ts` | create | `shipmentKeys` + `useShipments(page,pageSize,filters,sort)` + `useCreateShipment` with list invalidation (AC-1, AC-6..AC-9) | ~55 |
| `src/frontend/src/features/shipments/ShipmentFormDialog.tsx` | create | Create dialog: RHF+Zod, warehouse select from `useWarehouses`, priority default Standard, 400 field errors (weightKg/destinationAddress/originWarehouseId/priority) to fields, other errors to Alert, success snackbar with SHP-###### (AC-1..AC-4, AC-10) | ~180 |
| `src/frontend/src/features/shipments/ShipmentsPage.tsx` | create | Paged table (referenceCode, status, priority, origin, destination, weightKg, slaDueAt + at-risk chip, createdAt), AND filters (q/status/priority/originWarehouseId/slaRisk), sort select (4 values), pagination, role-gated New shipment; no edit/cancel/detail (LOGI-0008) (AC-6..AC-10) | ~300 |
| `src/frontend/src/features/shipments/ShipmentsPage.test.tsx` | create | Vitest suite through the UI: AC-1, AC-3, AC-4, AC-6..AC-10 | ~220 |
| `src/frontend/src/mocks/handlers.ts` | modify | Extend `MockShipment` to the full ShipmentResponse shape + 6-digit code pad + reference-code counter reset; GET /shipments (401; Driver 403 read; AND filters; 4 sorts nulls-last + id tiebreak, default -createdAt; read-time BR-2 atRisk; 400 page/pageSize/enum/sort/slaRisk) and POST /shipments (401; Viewer+Driver 403; 400 errors.weightKg/destinationAddress/originWarehouseId/priority; priority default Standard; unique SHP-+6 digits; server-owned status Pending/createdAt/slaDueAt; initial history row fromStatus null); LOGI-0006 transition/history handlers untouched (AC-1..AC-4, AC-6..AC-10) | ~200 |
| `src/frontend/src/App.tsx` | modify | `'shipments'` tab + `<ShipmentsPage />` gated by `viewShipments` (Driver sees no tab, AC-10); existing testids/aria-label unchanged | ~12 |
| `memory/journal/LOGI-0007.md` | modify | frontend-arm section (written by `tracker seal`) | ~5 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0007-create-shipment.md` | 40-235 | AC-1..AC-11 (acceptance contract), §5 out-of-scope, §7 safe defaults |
| contract:shipments (x-roles, params, responses, schemas) | slice | ShipmentRequest/ShipmentResponse, GET params (page/pageSize/status/priority/originWarehouseId/slaRisk/q/sort), x-roles (GET Admin/Dispatcher/Viewer, POST Admin/Dispatcher), Paged envelope — resolve via `node tools/contract/index.mjs show --resource shipments [--fields ...]`; slice-first rule: never read the raw contract file or the generated type file whole |
| `memory/journal/LOGI-0007.md` | tail (`tracker journal-tail --lines 30`) | backend seal findings: two-save transaction, Kind=Utc normalization, SHP- max(id)+1 + bounded retry, field-keyed 400s |
| `Docs/business-rules/BR-sla-rules.md` | 14-46, 83-92 | BR-1 offsets (Standard +48h / Express +12h, default Standard, fail-loud) + BR-2 at-risk predicate + whole-second note — the mock's slaDueAt/atRisk oracle |
| `src/frontend/src/api/client.ts` | 1-60, 120-245 | Paged/ApiError.fieldErrors idioms, existing list/create methods, LOGI-0006 shipment transition/history methods (keep) |
| `src/frontend/src/features/auth/permissions.ts` | full | capability-table pattern and names already shipped |
| `src/frontend/src/features/vehicles/schema.ts` | full | Zod form schema idiom |
| `src/frontend/src/features/vehicles/hooks.ts` | full | query keys + paged useQuery + create invalidation idiom |
| `src/frontend/src/features/vehicles/VehicleFormDialog.tsx` | 1-120 | dialog idiom: RHF+Zod, fieldErrors → setError, non-field error → Alert |
| `src/frontend/src/features/vehicles/VehiclesPage.tsx` | full | table + filters + pagination + role-gated actions idiom |
| `src/frontend/src/features/drivers/DriversPage.tsx` | 1-140 | q/filter/pagination wiring precedent (filtersChanged/search) |
| `src/frontend/src/features/warehouses/hooks.ts` | full | `useWarehouses` for the origin-warehouse select |
| `src/frontend/src/mocks/handlers.ts` | 1-60, 60-140, 640-740 | authorize/problem/nextId helpers, shipment store + seed, LOGI-0006 transition/history handlers |
| `src/frontend/src/test/renderApp.tsx` | full | resetMocks wiring + seedSession for role-matrix tests |
| `src/frontend/src/App.tsx` | 98-147 | tab wiring — Tab must stay a direct child of Tabs |

## 4. Steps (each with verify gate)
- [ ] 1. Regenerate typed client: `npm run generate:api` in `src/frontend`; keep only shipment hunks if unrelated drift appears (report any) → verify: `git diff --stat src/frontend/src/api/schema.d.ts` shipment-additions only; `npx tsc --noEmit` clean
- [ ] 2. Client seam `api/client.ts`: `Shipment`/`ShipmentInput`/`ShipmentPriority`/`ShipmentSort` schema aliases + `api.listShipments({page,pageSize,status,priority,originWarehouseId,slaRisk,q,sort}): Promise<Paged<Shipment>>` (serialize only supplied filters) + `api.createShipment(input): Promise<Shipment>` (POST 201 read-back); LOGI-0006 transition/history methods untouched → verify: `npx tsc --noEmit` clean
- [ ] 3. Permissions `permissions.ts`: `viewShipments` = Admin/Dispatcher/Viewer (Driver excluded — AC-10/§7 deferral) + `createShipments` = Admin/Dispatcher (AC-10) → verify: `npx tsc --noEmit` clean; `npm test` green
- [ ] 4. Mock seam `mocks/handlers.ts`: extend `MockShipment` to the full ShipmentResponse shape (originWarehouseId, destinationAddress, destinationLat/Lng, weightKg, priority, slaDueAt, routeId:null, createdAt, updatedAt) with `seedShipment` defaults so LOGI-0006 call sites keep compiling; `padStart(6)` reference-code pad + per-store code counter reset in `resetShipmentsDb`; GET /shipments handler (401 anon; Driver 403 read; AND filters q/status/priority/originWarehouseId/slaRisk; sorts createdAt|-createdAt|slaDueAt|-slaDueAt default -createdAt, slaDueAt nulls-last + id tiebreak; read-time BR-2 atRisk with whole-second truncation; 400 page&lt;1 / pageSize&lt;1|&gt;100 / unknown enum / unknown sort / bad slaRisk) and POST /shipments handler (401; Viewer+Driver 403; 400 errors.weightKg|destinationAddress|originWarehouseId|priority; omitted priority→Standard; unique `SHP-`+6-digit max(id)+1; server-owned status Pending/createdAt/slaDueAt per BR-1; initial history row fromStatus null, changedAt=createdAt) → verify: `npx tsc --noEmit` clean; `npm test` full suite green (LOGI-0006 transition/history paths unaffected)
- [ ] 5. Feature data layer: `features/shipments/schema.ts` (zod create schema + `toShipmentInput`) + `features/shipments/hooks.ts` (`shipmentKeys`, `useShipments` paged query, `useCreateShipment` invalidating the list) → verify: `npx tsc --noEmit` clean
- [ ] 6. UI: `ShipmentFormDialog.tsx` (warehouse select via `useWarehouses`, priority select default Standard, optional lat/lng, fieldErrors→setError incl. originWarehouseId/priority, other→Alert, snackbar with returned SHP-######) + `ShipmentsPage.tsx` (table with at-risk chip and null-slaDueAt '—', AND filter controls incl. slaRisk, sort select, pagination over the paged envelope, role-gated New via `can(role,'createShipments')`, row click inert — LOGI-0008) → verify: `npx tsc --noEmit` clean
- [ ] 7. Chrome `App.tsx`: add `'shipments'` to the tab union, `<Tab value="shipments" data-testid="tab-shipments" />` gated by `viewShipments`, `<ShipmentsPage />` in the switch; existing testids + aria-label untouched → verify: `npx tsc --noEmit` clean; `npm test` green
- [ ] 8. Vitest suite `ShipmentsPage.test.tsx`: AC-1 create happy path (201 row appears + snackbar SHP-######), AC-3 priority defaults Standard + unknown-priority 400 field error, AC-4 weightKg/destinationAddress/originWarehouseId 400 field errors, AC-6 paged envelope + pagination, AC-7 AND filters + q contains/case-insensitive, AC-8 sort incl. slaDueAt nulls-last, AC-9 at-risk chip + slaRisk true/false filter, AC-10 role matrix (Viewer: no New button + POST 403 surfaced; Driver: no Shipments tab; Admin/Dispatcher: create) → verify: `npm test` full suite green; `npx tsc --noEmit` clean; `npm run build` succeeds
- [ ] 9. Seal + handoff: `tracker seal` frontend section (what/gates/findings/next); manifest-exact commit (§2 files + journal/state/memory); `tracker handoff --ticket LOGI-0007 --from frontend --to qa`; `tracker active`/`tracker progress` → verify: all §4 steps ticked, HANDOFF recorded, `git status --short` clean except state/memory artifacts

## 5. Risks / open questions
- **Mock back-compat:** `MockShipment` gains required fields — `seedShipment` supplies defaults so LOGI-0006 transition/history call sites and `resetShipmentsDb` callers keep compiling (gate: full suite green at step 4).
- **Code-pad fix:** the existing `padStart(5)` violates `^SHP-[0-9]{6}$`; corrected to 6 inside §2 scope (grepped: no test hard-codes the 5-digit form; e2e uses the real API).
- **`renderApp.tsx` expected unchanged** (LOGI-0006 already wired `resetShipmentsDb`); if a gate proves a change is needed → PLAN_DEVIATION + re-validate, never a silent edit.
- **MUI Select under jsdom** (LOGI-0005 lesson): if popup interaction is brittle, assert enums via rendered option lists + row outcomes; mock/server stay authoritative.
- **App.tsx keeps existing testids/aria-label:** the tab only adds elements, so `tests/e2e/**` selectors (outside this arm) keep matching.
- **Mock slaDueAt/atRisk oracle:** must mirror BR-1/BR-2 exactly (whole-second truncation, read-time only, null slaDueAt ⇒ atRisk false + sorts last) or the suite encodes a wrong expectation.
- **No detail/edit/cancel UI** (LOGI-0008) and **no Driver scoping** (LOGI-0009/0010): row click inert; Driver sees no tab while the mock 403s regardless.
- **`generate:api` regenerates the whole schema:** keep only shipment hunks if unrelated churn appears (none expected — backend seal verified contract parity) and report it.
- **Planner scratch:** `graphify update ./src` (CLI 0.6.0) wrote untracked `src/graphify-out/` — deleted before execution so `git status` stays manifest-exact; rebuild with `graphify update ./src` if a successor needs the graph.

## 6. Exit gates
- `npx tsc --noEmit` clean; `npm test` full suite green; `npm run build` succeeds (in `src/frontend`).
- `npm run generate:api` leaves `api/schema.d.ts` byte-identical (the contract stays the single source of truth).
- Mock proves AC-6..AC-10: page/pageSize 400s, AND filters, 4 sorts with nulls-last, read-time atRisk complement (slaRisk true/false), Driver GET 403, Viewer/Driver POST 403, field-keyed 400s.
- Gating: Driver sees no Shipments tab; Viewer sees no New button; Admin/Dispatcher create — UI affordance only; server/mocks remain the authority.
- Arm boundary: no backend, contract or `tests/e2e/**` file touched; only §2 paths + journal/state/memory committed; no stray artifacts (`src/graphify-out/`, `nul`) left behind.
