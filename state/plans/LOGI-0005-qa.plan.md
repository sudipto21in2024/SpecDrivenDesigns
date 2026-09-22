---
ticket: LOGI-0005
arm: qa
status: done
created: 2026-09-21T08:01:47.092Z
depends_on_plans: LOGI-0005-frontend
---

## 1. Objective
LOGI-0005 QA (PRD F3): author `tests/e2e/drivers.spec.ts` covering AC-1..AC-9 against the live API+SPA
(real `/auth/login`, unique per-run data, throwaway DB), plus a `DriversPage` page object mirroring
`VehiclesPage` and the two `support/api.ts` helpers it needs (seeded-user id + seedDriver). Suite grows
30 → 39 tests; CI run on the pushed SHA is the remote gate.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/pages/drivers.page.ts` | create | Page object: goto(role), list table, openCreate/openEdit, submit/save, deleteRow, search, status filter, toast, fieldError, row/rowById — AC-1..AC-9 | ~120 |
| `tests/e2e/support/api.ts` | modify | signIn returns the full TokenResponse (seeded user id for the link tests) + seedDriver helper (no other helper touched) — AC-1, AC-5, AC-6, AC-7 | ~30 |
| `tests/e2e/drivers.spec.ts` | create | AC-1..AC-9 against the real API/SPA: create, validation, licence 409 (POST+PUT), status default/enum, user link (201/400/409/cleared), paged+filtered list, get/update/delete + 404s, RBAC matrix incl. Driver-role 403 on reads — AC-1..AC-9 | ~270 |
| `memory/journal/LOGI-0005.md` | modify | qa-arm seal section (gates, evidence, findings) | ~30 |

Seal artifacts written by the tracker + memory protocol (no other file may change):
| Path | Action | Why |
|---|---|---|
| `state/plans/LOGI-0005-qa.plan.md` | modify | status draft → validated → locked → done + per-step checkboxes |
| `state/events.jsonl` | modify | PLAN_*/TASK_STARTED/STEP_DONE/MICRO/HANDOFF events (tracker CLI only) |
| `state/handoffs.jsonl` | modify | `tracker handoff --from qa --to done` record |
| `state/tasks.json` | modify | derived snapshot rebuilt by the tracker |
| `memory/active.md` | modify | session end: position + next action |
| `memory/progress.md` | modify | LOGI-0005 row: qa ✅ |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0005-drivers-crud.md` | full | AC-1..AC-9 source of truth + §2 roles + §5 out-of-scope |
| `contracts/v1-openapi.yaml` | 459-568 | `/drivers` + `/drivers/{id}`: x-roles per operation, q/status params, 400/401/403/404/409 declarations, DriverResponse (no createdAt) |
| `tests/e2e/vehicles.spec.ts` | full | E2E idiom to mirror: beforeEach signIn Admin, seed(), filterByStatus, RBAC matrix incl. role-scoped UI affordances |
| `tests/e2e/pages/vehicles.page.ts` | full | Page-object idiom (goto/role, openCreate/openEdit, pick(), row regex, expectToast, fieldError) |
| `tests/e2e/pages/login.page.ts` | full | `signInAs(role)` + `current-role` wait |
| `tests/e2e/support/api.ts` | full | signIn/authHeaders/seedVehicle idiom to extend |
| `tests/e2e/global-setup.ts` | 30-40 | Proof the drivers reset already exists (LOGI-0013) — no change needed here |
| `tests/e2e/playwright.config.ts` | 19-53 | testDir, retries, webServer stack, timeout/actionTimeout budgets |
| `src/frontend/src/features/drivers/DriversPage.tsx` | full | testids/labels: tab via App.tsx, `new-driver`, `driver-row-<id>`, search aria-label, `#driver-status-label` filter, Edit/Delete aria-labels, toasts, snackbar |
| `src/frontend/src/features/drivers/DriverFormDialog.tsx` | full | Field aria-labels (Driver full name/license number/phone/status/user id), `driver-submit`/`driver-cancel`, and how a 409 with **no** `errors` map is surfaced (dialog-level alert, not a field error) |
| `src/frontend/src/api/client.ts` | 11-53, 197-224 | `Driver`/`DriverInput`/`TokenResponse`/`AuthUser` types + `ApiError.fieldErrors` (types the new helpers) |
| `src/frontend/src/App.tsx` | 110-130 | Drivers tab rendered only when the role can `viewDrivers` (Driver role has no tab) |
| `Docs/ProjectTechGuidence/06-testing-strategy-playwright.md` | 19-32 | Playwright conventions (page objects, API sign-in, AC-level assertions) |

## 4. Steps (each with verify gate)
- [x] 1. `tests/e2e/support/api.ts` (additive only): `signIn` returns the full `TokenResponse`
  (`accessToken`, `refreshToken`, `user` — the seeded id the link tests need, mirroring
  `DriverEndpointsTests.SeededUserIdAsync`); add `seedDriver(request, accessToken, fullName,
  licenseNumber, overrides = {})` → POST `/api/v1/drivers`, expect 201, return the id. Untouched:
  `authHeaders`, `seedWarehouse`, `seedVehicle`, `SEED_USERS`. → verify:
  `cd tests/e2e && npx playwright test` → **30 passed, 0 failed** (the shared helper change must not
  regress auth/warehouses/vehicles).
- [x] 2. `tests/e2e/pages/drivers.page.ts` + `tests/e2e/drivers.spec.ts` AC-1..AC-4:
  page object (`goto(role)` → sign in + click `tab-drivers` + heading `Drivers`; fullName/license/phone/
  status/userId inputs; `#driver-status-label` filter; openCreate/openEdit; submit/save via `driver-submit`;
  `driver-cancel`; deleteRow via `Delete driver <name>` + `confirm-delete`; search via `Search drivers`;
  `row(name)` regex + `rowById(id)`; expectToast; fieldError) and the first four ACs — AC-1 create via the
  UI **as Dispatcher** (spec §2/AC-1) then confirm persistence through the API; AC-2 empty fullName →
  client-side "Full name is required" *and* API 400 `errors.fullName` with the row count unchanged;
  AC-3 duplicate licence → 409 on POST (UI alert + API) and on PUT of another driver (the other driver
  keeps its licence, count unchanged); AC-4 omitted status → `Active`, bad status → 400 `errors.status`.
  → verify: `cd tests/e2e && npx playwright test drivers.spec.ts` → **4 passed**. All seeds use the
  shared prefix (`e2e${Date.now().toString(36)}`) plus a **per-test** `Date.now()` suffix so a CI retry
  (`retries: 1`) can never re-collide on the UNIQUE `license_number` index.
- [x] 3. `tests/e2e/drivers.spec.ts` AC-5..AC-7: AC-5 link to a real seeded user id (resolved off the
  login response; first id not yet linked, so a retry cannot inherit the previous attempt's link) → 201
  echoes `userId`, GET `/{id}` carries it, UI row shows the User ID cell; AC-6 nonexistent userId
  (999999) → 400 `errors.userId` with no row, a taken userId → 409 on POST *and* PUT (self excluded),
  PUT with `userId: null` → 200 with `userId: null` (link cleared); AC-7 30 prefixed drivers (statuses
  cycled Active/OffDuty/Suspended) → `?q=<prefix>&page=2&pageSize=10` returns exactly 10 items,
  `page=2`, `pageSize=10`, `totalCount=30`, `totalPages=3`, ids ascending and disjoint from page 1;
  `status=Suspended` narrows to 10; `status=Nope` → 400; UI: search by prefix + `filterByStatus`
  narrows the visible rows. → verify: `npx playwright test drivers.spec.ts` → **7 passed**.
- [x] 4. `tests/e2e/drivers.spec.ts` AC-8..AC-9: AC-8 UI round-trip (search → openEdit → status/phone
  change → toast `Driver updated` → row cell updated → deleteRow → toast `Driver deleted` → row gone)
  plus API 404s on GET/PUT/DELETE `/drivers/999999` (`title: Resource not found`); AC-9 full role
  matrix — anonymous 401 (`www-authenticate: Bearer`) on all five operations; Viewer GET list + GET
  `/{id}` 200 but POST/PUT/DELETE 403 with the row count unchanged; **Driver role 403 on reads**
  (list + `/{id}`; master data is not a driver-persona surface) and on writes; Dispatcher GET 2xx +
  POST 201 + PUT 200 + DELETE 403; Admin DELETE 204 → GET 404; UI affordances per role (Driver has **no**
  `tab-drivers`, Viewer has no `new-driver`/Edit/Delete, Dispatcher has `new-driver` but no Delete).
  → verify: `npx playwright test drivers.spec.ts` → **9 passed**.
- [x] 5. Full-suite regression on the target build → verify: `cd tests/e2e && npx playwright test` →
  **39 passed, 0 failed, 0 flaky**; the run's Serilog log shows no `no such table` lines.
- [x] 6. Seal: append the qa-arm section to `memory/journal/LOGI-0005.md` (gates + evidence, the
  409-without-`errors` UI finding, retry-safety decision), tick the steps, `tracker log STEP_DONE` per
  step, commit §2-exact with a per-step commit trail, `tracker handoff --ticket LOGI-0005 --from qa
  --to done --summary "memory/journal/LOGI-0005.md#qa-arm" --gates "..."`, update `memory/active.md` +
  `memory/progress.md`, push and watch CI. → verify: `git status --short` shows only §2 files;
  `tracker handoff` + `node tools/tracker/index.mjs history --ticket LOGI-0005` show the record;
  the pushed SHA's CI run has `build-and-test` + `e2e` green.

## 5. Risks / open questions
- **UI 409 presentation differs from vehicles.** The API's 409 (`ExceptionHandlingMiddleware` →
  `ConflictException`) carries **no `errors` map**, so `DriverFormDialog` shows it as a dialog-level
  `role="alert"`, not as a field error (vehicles synthesizes a client-side field error instead).
  Assertions therefore use `getByText(/already exists/i)`, which matches wherever the message renders —
  the QA arm asserts observed behaviour and must **not** change the frontend (qa boundary forbids it).
- **Retry safety (CI `retries: 1`).** Every test's data is generated per execution (unique suffix) and
  every count assertion is prefix-scoped, so a retry cannot see the previous attempt's rows and cannot
  collide on `license_number`.
- **Shared throwaway DB.** Stale local API/preview servers on :5199/:5173 are reused
  (`reuseExistingServer: !CI`), so kill leftovers before a local run to make the run start from a fresh
  DB (`start-api.mjs` prepares it).
- **Seeded-user ids are not stable numbers** across databases: they are read from the login response
  (the spec's "user id 7" is illustrative, same position as `DriverEndpointsTests`).
- AC-7 seeds 30 rows per execution (~30 fast API calls) — acceptable; UI assertions stay on small
  prefixes so the growing page size never matters.
- Out of scope (spec §5, unchanged): route assignment/BR-4, driver self-service F12/F13, soft delete,
  status lifecycle, role=Driver requirement on the link, delete-when-referenced 409 (LOGI-0009).

## 6. Exit gates
- `tests/e2e/drivers.spec.ts` covers AC-1..AC-9 with ticket-linked comments (`// AC-n`), asserting
  AC-level outcomes against the real API + SPA (no MSW, no mocks).
- Local `npx playwright test` in `tests/e2e` → 39 passed, 0 failed, 0 flaky.
- AC-9 matrix proven from the contract: anonymous 401; Viewer read-only (403 on writes); Driver role
  403 on **reads**; Dispatcher create/update 2xx + delete 403; Admin delete 204 → 404.
- No file outside §2 changed (qa boundary: no `src/**`, no `contracts/**`, no harness/config changes).
- Journal records gates + evidence; handoff qa→done recorded; pushed SHA green in CI.
