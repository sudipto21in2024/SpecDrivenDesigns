---
ticket: LOGI-0005
arm: frontend
status: locked
created: 2026-09-21T07:31:59.705Z
depends_on_plans: LOGI-0005-architect, LOGI-0005-backend
---

## 1. Objective
LOGI-0005 frontend (PRD F3, spec approved, backend sealed with dotnet 42/42): regenerate the typed client for `/drivers` and build `features/drivers/*` mirroring the vehicles feature (paged list with full-name search + status filter, create/edit dialog with enum select defaulting Active, optional user-link field, 409 duplicate-license surfacing, role-gated actions), MSW handlers, and a vitest suite for AC-1..AC-9. The UI model carries **no createdAt** (the approved schema defines none) and PUT always sends the current `userId` (omitted/null clears the link).

RECOVERY CONTEXT (respected by this plan): an earlier inline execution of this arm was interrupted. Its output is already in the working tree but was never planned, locked, committed or micro-logged: typed-client regen (`api/schema.d.ts`, `api/client.ts`), `features/auth/permissions.ts`, `mocks/handlers.ts`, `test/renderApp.tsx`, `App.tsx` and `features/drivers/{schema,hooks,DriversPage}`. `DriverFormDialog.tsx` had been written to a stray `C/Sudipto/...` path (bad redirect) and was relocated by step 1; the stray `C/` tree and root `nul` artifact were deleted. This plan therefore AUDITS that work against contract+spec (steps 2-3) instead of rewriting it, and supplies the genuinely missing pieces: the Drivers-tab role gate (step 4), the vitest suite (step 5) and the seal (step 6).

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/schema.d.ts` | regenerate | `npm run generate:api` from the contract — Driver paths + DriverRequest/DriverResponse — AC-1..AC-8 | 0 (regen) |
| `src/frontend/src/api/client.ts` | modify | `Driver`/`DriverInput`/`DriverStatus` types + list/get/create/update/delete methods — AC-1..AC-8 | ~35 |
| `src/frontend/src/features/auth/permissions.ts` | modify | viewDrivers/editDrivers/deleteDrivers capabilities (Driver role excluded, spec §2) — AC-9 | ~10 |
| `src/frontend/src/features/drivers/schema.ts` | create | Zod form schema (fullName 1..200, licenseNumber 1..40, optional phone, status enum default Active, optional positive-int userId) + toDriverInput — AC-2..AC-6 | ~50 |
| `src/frontend/src/features/drivers/hooks.ts` | create | React-query hooks (paged q/status list + create/update/delete invalidation) — AC-1..AC-8 | ~55 |
| `src/frontend/src/features/drivers/DriverFormDialog.tsx` | create | Create/edit dialog (RHF + Zod, status select, user-link field, 409 to field error, other to Alert) — AC-2..AC-6 | ~170 |
| `src/frontend/src/features/drivers/DriversPage.tsx` | create | List table (no createdAt column), q + status filters, pagination, role-gated New/Edit/Delete — AC-1..AC-8 | ~260 |
| `src/frontend/src/features/drivers/DriversPage.test.tsx` | create | Vitest suite exercising AC-1..AC-9 through the UI — AC-1..AC-9 | ~180 |
| `src/frontend/src/mocks/handlers.ts` | modify | driversDb + seedDriver/resetDriversDb + /drivers MSW handlers (401/403 matrix incl. Driver-role 403, 400 validation, licence 409, userId 400/409, 404s) — AC-1..AC-9 | ~180 |
| `src/frontend/src/test/renderApp.tsx` | modify | resetMocks also clears the driver store | ~3 |
| `src/frontend/src/App.tsx` | modify | Drivers tab rendered only when the role can viewDrivers; page switch wiring — AC-9 (spec §2) | ~12 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0005-drivers-crud.md` | full | AC-1..AC-9 source of truth, §2 role matrix, §5 out-of-scope |
| `contracts/v1-openapi.yaml` | /drivers + /drivers/{id} + Driver* schemas | Request/response fields, x-roles per operation, paging envelope |
| `memory/journal/LOGI-0005.md` | backend-arm | Link semantics (400 nonexistent / 409 linked-elsewhere, PUT null OR omitted clears), no createdAt, list id asc |
| `src/frontend/src/features/vehicles/VehiclesPage.tsx` | full | Page idiom (filters, table, role-gated actions) |
| `src/frontend/src/features/vehicles/VehicleFormDialog.tsx` | full | Dialog idiom (RHF + Zod, ApiError fieldErrors mapping) |
| `src/frontend/src/features/vehicles/hooks.ts` | full | Query-key/invalidation idiom |
| `src/frontend/src/features/vehicles/schema.ts` | full | Zod schema idiom |
| `src/frontend/src/features/vehicles/VehiclesPage.test.tsx` | full | Vitest harness idiom (renderAppAs, resetMocks, seed helpers) |
| `src/frontend/src/features/auth/permissions.ts` | full | Capability convention to extend |
| `src/frontend/src/mocks/handlers.ts` | full | MSW idiom (authorize matrix, problem helpers, paging) |
| `src/frontend/src/test/renderApp.tsx` | full | Test harness to extend |
| `src/frontend/src/App.tsx` | full | Tabs chrome to gate |
| `Docs/ProjectTechGuidence/07-coding-standards.md` | Frontend section | Strict TS, hooks only, TanStack Query for server state, RHF + Zod mirroring server validation |

## 4. Steps (each with verify gate)
- [x] 1. Recovery hygiene: relocate `DriverFormDialog.tsx` out of the stray `C/Sudipto/...` path into `src/frontend/src/features/drivers/`, delete the `C/` tree and the root `nul` artifact → verify: `git status --short` lists only §2 paths under `src/frontend/` (plus state files)
- [x] 2. Typed client + capabilities + mocks audit: `npm run generate:api` in src/frontend reproduces `api/schema.d.ts` with ZERO diff (proves the regen came from the contract, not by hand); the driver types + 5 CRUD methods exist in `api/client.ts`; `permissions.ts` exposes viewDrivers/editDrivers/deleteDrivers; `mocks/handlers.ts` serves `/drivers` with the contract x-roles matrix (Driver role 403 even on reads) → verify: regen diff empty; `npx tsc --noEmit` clean
- [x] 3. Feature UI audit: `features/drivers/{schema,hooks,DriversPage,DriverFormDialog}` match the spec — status enum + Active default (AC-4), duplicate licence to licenseNumber field error (AC-3), userId 400/409 field errors and PUT sends the current userId so the link is preserved/cleared (AC-5/AC-6), table has NO createdAt column and order is id asc (NFR), role-gated New/Edit/Delete (AC-9) → verify: `npx tsc --noEmit` clean; grep shows no createdAt in `features/drivers/`
- [x] 4. Chrome: `App.tsx` renders the Drivers tab (and page) only when `can(role, 'viewDrivers')` — the Driver persona must not see master data (spec §2 / AC-9) while Admin/Dispatcher/Viewer keep today's behaviour; renderApp resetMocks clears the driver store → verify: `npm test` existing warehouse/auth/vehicle suites still green
- [ ] 5. Vitest suite `DriversPage.test.tsx` covering AC-1 (create + success snackbar), AC-2 (fullName required), AC-3 (409 duplicate licence as field error), AC-4 (status defaults Active + three enum options), AC-5/AC-6 (user link echoed, invalid userId 400, clear-on-edit), AC-7 (paged list + status filter/search), AC-8 (edit + delete via confirmation), AC-9 (Viewer read-only, Dispatcher no delete, Driver role sees no Drivers tab) → verify: `npm test` full suite green; `npx tsc --noEmit` clean; `npm run build` succeeds
- [ ] 6. Seal: journal frontend-arm section; commit manifest-exact; plan status done; tracker handoff frontend to qa; update `memory/active.md` + `memory/progress.md` → verify: `git status --short` clean except state/memory artifacts; all §4 steps ticked

## 5. Risks / open questions
- **Pre-existing uncommitted work:** steps 2-3 treat it as audited input, so every claim is re-verified by a gate (regen no-diff, tsc, full suite) rather than trusted. If a file contradicts the contract/spec it is corrected inside §2 scope only.
- **Drivers-tab gating is a UX decision:** the API (and the MSW mirror) 403s regardless, so hiding the tab is affordance hygiene, not enforcement; it keeps the Driver persona out of master data per spec §2. There is no router — single-page Tabs, same as LOGI-0004.
- **MUI Select + jsdom:** status-filter/select interaction can be brittle under userEvent; if the popup proves unstable in jsdom, AC-4 is asserted via the rendered option list + the status default on a created row instead of a synthetic select change (the enum stays enforced server-side and by the e2e arm).
- **PUT link preservation:** the dialog re-seeds `userId` from the row, so an unrelated edit cannot silently unlink; clearing the field sends no userId, which the contract defines as "clear the link" (matches the backend arm note).
- `generate:api` regenerates the whole file: should openapi-typescript emit unrelated hunks, keep only the Driver* changes and report it (none expected — the committed schema already matches the current contract).
- Stale detached worktree `.kilo/worktrees/lime-spirit` (at `2433dc8`, an old LOGI-0005 architect state) is NOT part of this arm's scope; it is only flagged here so it is not mistaken for live state.

## 6. Exit gates
- `npx tsc --noEmit` clean in `src/frontend`; `npm test` full suite green (warehouse + auth + vehicle + driver suites); `npm run build` succeeds.
- `npm run generate:api` leaves `api/schema.d.ts` byte-identical (the contract stays the single source of truth).
- Duplicate licence in the UI to 409 on the licenseNumber field; invalid userId to 400 on the userId field; no silent failures.
- Viewer sees the list only; Dispatcher sees New/Edit but no Delete; the Driver role sees no Drivers tab — the server/mocks 403 regardless.
- No backend, contract or `tests/e2e` file touched (arm boundary); only §2 paths + journal/state/memory committed.

