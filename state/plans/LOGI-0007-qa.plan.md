---
ticket: LOGI-0007
arm: qa
status: locked
created: 2026-09-24T11:58:42.245Z
depends_on_plans: LOGI-0007-frontend, LOGI-0007-backend
---

## 1. Objective
LOGI-0007 QA: author `tests/e2e/create-shipment.spec.ts` (AC-1..AC-5, AC-10 POST side, AC-11) and
`tests/e2e/shipments-list.spec.ts` (AC-6..AC-9, AC-10 GET side) against the real API + real SQLite
(no MSW, no mocks), plus a Shipments page object for the two UI seams (create through the dialog,
tab / New-button gating). Base suite is 47 green today; the pushed SHA's CI run is the remote gate.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/support/shipments.ts` | modify | Add the LOGI-0007 request helpers (`createShipment`, `listShipments` — typed results, `token: null` for the 401 cases) and `seedShipmentAt` (direct SQLite INSERT pinning `reference_code`/`sla_due_at`/`status`, so AC-8 nulls-last and the AC-9 BR-2 window never depend on the wall clock). LOGI-0006 exports stay byte-compatible | ~85 |
| `tests/e2e/pages/shipments.page.ts` | create | Page object for the Shipments tab: `goto(role)` (login + tab), tab-visibility probe, filter controls (q/status/priority/origin/slaRisk/sort), create dialog, row lookup by reference, pagination — accessible selectors only, no raw CSS (AC-1, AC-7, AC-9, AC-10) | ~120 |
| `tests/e2e/create-shipment.spec.ts` | create | AC-1 (201 shape + exactly one initial audit row + list visibility, plus the UI create seam), AC-2 (BR-1 48h/12h from the server instant; client `createdAt`/`slaDueAt` ignored), AC-3 (omitted → Standard + 48h; unknown priority 400 `errors.priority`), AC-4 (weightKg/destinationAddress/unknown originWarehouseId 400s, nothing written), AC-5 (concurrent creates → distinct `^SHP-[0-9]{6}$`; client referenceCode never trusted), AC-10 POST (401 anon, 403 Viewer + Driver), AC-11 (created row drives the LOGI-0006 transition + history) | ~300 |
| `tests/e2e/shipments-list.spec.ts` | create | AC-6 (envelope + defaults + paging 400s), AC-7 (AND filters, q contains/case-insensitive, unknown enum → 400), AC-8 (default -createdAt, slaDueAt asc/desc, id tiebreak, nulls-last, unknown sort → 400), AC-9 (BR-2 read-time boundary incl. Delivered/Cancelled/null ineligible; slaRisk true/false complement), AC-10 GET (401 anon, 403 Driver, 200 Viewer/Admin/Dispatcher) + the UI list seam (filters, at-risk chip, Driver has no tab) | ~300 |
| `memory/journal/LOGI-0007.md` | modify | qa-arm seal section (what/gates/findings/next) | ~30 |
| `specs/features/LOGI-0007-create-shipment.md` | modify | Ticket-close chore (not AC work): front matter `spec_approved` → `done` once the last arm is sealed — mirrors the LOGI-0005/LOGI-0006 closes; the qa boundary allows specs (deny is src + contracts) | 1 |

Seal artifacts written by the tracker + memory protocol (no other file may change):
| `state/plans/LOGI-0007-qa.plan.md` | modify | status draft → validated → locked → done + per-step checkboxes |
| `state/events.jsonl` | modify | PLAN_*/TASK_STARTED/STEP_DONE/MICRO/HANDOFF events (tracker CLI only) |
| `state/handoffs.jsonl` | modify | tracker handoff --from qa --to done record |
| `state/tasks.json` | modify | derived snapshot rebuilt by the tracker |
| `memory/active.md` | modify | session end: position + next action |
| `memory/progress.md` | modify | LOGI-0007 row: qa ✅ |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0007-create-shipment.md` | full | AC-1..AC-11 source of truth + §2 role matrix + §3 preconditions + §7 applied defaults (q scope, unknown enum → 400, Driver excluded, empty priority, unknown originWarehouseId, `SHP-` + 6 digits) + §8 whole-second precision |
| `Docs/business-rules/BR-sla-rules.md` | 1-80 | BR-1 offset table + rule 1.2/1.4/1.7 and BR-2 window/margin rules behind AC-2/AC-3/AC-9 |
| contract:shipments (x-roles) | slice | per-operation role matrix (GET: Admin/Dispatcher/Viewer; POST: Admin/Dispatcher; transitions: A/D/Driver; history: all four) — resolve with `node tools/contract/index.mjs show --resource shipments --fields x-roles` |
| contract:shipments (params, responses) | slice | GET /shipments filter/sort/paging names + declared status codes (200/400/401/403; POST 201/400/401/403) |
| contract:shipments (schemas) | slice | ShipmentRequest (server-owned fields) + ShipmentResponse shapes the assertions bind to |
| `tests/e2e/support/shipments.ts` | full | the LOGI-0006 helpers (seedShipment/postTransition/getHistory/driveShipment) this arm extends and must not regress |
| `tests/e2e/support/api.ts` | 1-90 | API base URL, signIn/authHeaders, seedWarehouse (the origin FK the fixtures need) |
| `tests/e2e/support/paths.ts` | full | E2E_DB_PATH for the pinned-instant fixture rows |
| `tests/e2e/pages/login.page.ts` | full | sign-in page object the new page object reuses (signInAs) |
| `tests/e2e/pages/drivers.page.ts` | full | page-object conventions (login → tab → accessible selectors, toast helper) |
| `tests/e2e/warehouses.spec.ts` | full | spec structure + API-level 401/404 assertion patterns |
| `tests/e2e/global-setup.ts` | full | what the reset deletes (warehouses/vehicles/drivers only) — so every new assertion must be scoped to its own fresh origin warehouse |
| `tests/e2e/playwright.config.ts` | full | baseURL, webServers, reuseExistingServer, retries (retry-safe fixtures) |
| `src/frontend/src/features/shipments/ShipmentsPage.tsx` | 100-320 | labels/aria-labels/testids the page object drives (read-only; qa may not edit src) |
| `src/frontend/src/features/shipments/ShipmentFormDialog.tsx` | 100-210 | dialog labels + the shipment-submit testid |
| `src/frontend/src/App.tsx` | 118-130 | tab-shipments testid + viewShipments gating for the AC-10 UI seam |
| `src/frontend/src/api/client.ts` | 20-40, 250-280 | Shipment/ShipmentInput/ShipmentPriority/ShipmentSort/ListShipmentsParams types the helpers import |

## 4. Steps (each with verify gate)
- [x] 1. Extend `tests/e2e/support/shipments.ts` (LOGI-0007 seam): typed `createShipment(request, token|null, body)` and `listShipments(request, token|null, query)` returning `{ status, body }` (a `ShipmentResponse`/`Paged<Shipment>` on 2xx, ProblemDetails fields on 4xx), plus `seedShipmentAt(request, token, { status, slaDueAt, referenceCode })` — the direct-SQLite variant that pins `sla_due_at` (past / inside the 2h BR-2 window / null) and the status while still creating the origin warehouse through the API. LOGI-0006 exports unchanged → verify: `npx playwright test --list` compiles the support module and still lists the 8 LOGI-0006 tests
- [x] 2. Create `tests/e2e/pages/shipments.page.ts` (page object: `goto(role)` login + `tab-shipments`, `expectTabVisible/expectTabHidden`, `search`, `filterByStatus/Priority/Origin/SlaRisk`, `sortBy`, `openCreate`, `fillCreate`, `submitCreate`, `rowByReference`, `atRiskCell`, pagination next/previous) → verify: `npx playwright test --list` lists the new module without errors
- [x] 3. `tests/e2e/create-shipment.spec.ts` — AC-1: POST as Dispatcher → 201 with SHP-###### / Pending / echoed fields / ISO8601 UTC instants / BR-1 due date; exactly one initial audit row (fromStatus null, toStatus Pending, changedByUserId = caller, changedAt = createdAt) via the LOGI-0006 history endpoint; the row is in `GET /shipments`; then the same creation through the UI dialog (snackbar `SHP-…` + row visible) → verify: `cd tests/e2e && npx playwright test create-shipment.spec.ts` green for the AC-1 tests
- [x] 4. Append AC-2 and AC-3 to `tests/e2e/create-shipment.spec.ts`: BR-1 offsets (`slaDueAt - createdAt` = 48h Standard / 12h Express, whole seconds, no business-hours skipping) and rule 1.2 (client-supplied `createdAt`/`slaDueAt`/`status`/`referenceCode` in the body never influence the stored row); omitted/`null` priority → Standard + 48h; `"Overnight"` → 400 `errors.priority` naming Standard and Express with no row written → verify: same spec run green
- [x] 5. Append AC-4 and AC-5: 400 `errors.weightKg` (missing, 0, negative), 400 `errors.destinationAddress` (missing, whitespace-only), 400 `errors.originWarehouseId` for a non-existent warehouse — each with the list count for that origin unchanged and no history row; AC-5: 6 concurrent creates against one fresh warehouse → all 2xx, 6 distinct codes matching `^SHP-[0-9]{6}$`, and a client-supplied `referenceCode` is never echoed (the server-generated one wins) → verify: same spec run green
- [x] 6. Append AC-10 (POST side) and AC-11: anonymous 401 on POST and GET; Viewer 403 with ProblemDetails title/status; Driver 403; Dispatcher 201; then create → `POST /shipments/{id}/status-transitions {toStatus: Assigned}` 200, history = [Pending(fromStatus null, creator, changedAt = createdAt), Assigned], and the list shows status Assigned for that id → verify: `npx playwright test create-shipment.spec.ts` → all AC-1..AC-5/AC-10/AC-11 tests green
- [x] 7. `tests/e2e/shipments-list.spec.ts` — AC-6 and AC-7: envelope `{items,page,pageSize,totalCount,totalPages}` with defaults 1/25 and `totalCount` counted over all matches (not the page); `page=0`, `pageSize=0`, `pageSize=101` → 400; AND combination (status + priority + originWarehouseId + q + slaRisk) with each filter individually narrowing the result and `totalCount` consistent; `q` matches referenceCode and destinationAddress, contains + case-insensitive; unknown status/priority/slaRisk values → 400 → verify: `cd tests/e2e && npx playwright test shipments-list.spec.ts` green for AC-6/AC-7
- [ ] 8. Append AC-8 and AC-9: default order -createdAt; `sort=slaDueAt`/`-slaDueAt` ascending/descending with id tiebreaks (no duplicate or skipped row across pages); rows with `slaDueAt = null` last in both directions; unknown sort → 400; BR-2 read-time projection over fixture rows pinned inside/outside the 2h window (ineligible when Delivered/Cancelled, false when slaDueAt is null), `slaRisk=true` = exactly the at-risk rows and `slaRisk=false` = exactly the complement with consistent `totalCount` → verify: same spec run green
- [ ] 9. Append AC-10 (GET side) + UI list seam: anonymous 401, Driver 403, Viewer/Admin/Dispatcher 200; UI as Admin — tab visible, seeded row rendered with the at-risk chip and a working status/q filter; UI as Driver — no `tab-shipments` → verify: `npx playwright test shipments-list.spec.ts` green
- [ ] 10. Full-suite regression on the same build: `cd tests/e2e && npx playwright test` → 47 existing + the new tests passed, 0 failed, 0 flaky; `src/backend/LogiFlow.Api/Logs/logiflow-<date>.txt` shows no `SQLITE_BUSY` / `database is locked` / `no such table` lines → verify: the suite's summary line + the log grep
- [ ] 11. Seal + handoff: `tracker seal --ticket LOGI-0007 --arm qa` (what/gates/findings/next), tick every step, one STEP_DONE per verified step, manifest-exact commits (tests + journal + spec close + state/memory), spec front matter → `done`, `tracker handoff --ticket LOGI-0007 --from qa --to done --summary "memory/journal/LOGI-0007.md#qa-arm" --gates "..."`, `tracker active`/`tracker progress --ticket LOGI-0007`, push and watch CI → verify: `git status --short` shows only §2 files; HANDOFF + PLAN_DONE events recorded; the pushed SHA's CI run is green (build-and-test + e2e)

## 5. Risks / open questions
- **The reset does not touch shipments.** `global-setup.ts` deletes warehouses/vehicles/drivers only, and
  a warehouse delete can fail once a shipment references it, so a *re-run* against a leftover stack (the
  webServers are reused locally) can fail in setup. Mitigation: kill anything on :5199/:5173 before the run so
  `start-api.mjs` prepares a fresh throwaway DB (same note as the LOGI-0006 qa plan). All new assertions are
  additionally scoped to a freshly seeded origin warehouse, so leftovers can never inflate a count.
- **Clock-dependent AC-9 boundary.** The inclusive `now >= slaDueAt - 2h` boundary cannot be timed exactly over
  HTTP, so the e2e rows use safe margins (`now` + ~90 min ⇒ at risk; `now` + ~26 h ⇒ safe; `now` - 1 h ⇒ past
  due and still at risk). The exact-instant boundary is already proven by the backend `SlaPolicy` unit tests
  (BR-2 cut-off); this arm proves the projection is read-time, status-aware and complement-consistent.
- **AC-5 concurrency.** Six parallel POSTs are generated from `max(id)+1` with a bounded retry (contract: 409
  on exhaustion). Under SQLite's single writer a 409 here is a **real** finding, not a flake, so it is asserted
  as a failure rather than retried. `retries` is 0 locally and 1 in CI; every fixture value is unique per run,
  so a retry can never observe the previous attempt's rows.
- **Fixture reference codes.** `seedShipmentAt` rows use a unique non-`SHP-\d{6}` tag, exactly like the LOGI-0006
  fixtures, so the `^SHP-[0-9]{6}$` assertions are scoped to the API-created rows of the test's own warehouse.
  No existing helper is renamed or re-typed (`seedShipment` keeps its signature) — the LOGI-0006 spec must stay
  green untouched.
- **UI seam scope.** The two UI-level assertions (create through the dialog, tab gating) are deliberately thin:
  the fine-grained UI matrix already lives in the frontend arm's vitest suite (`ShipmentsPage.test.tsx`), and
  the e2e value is the unmocked stack. No `src/**` file may change (qa boundary) — if the UI cannot be driven
  with accessible selectors, the seam is dropped and journalled rather than "fixed" in src.
- **Stray artifacts.** Never write `nul` (cmd-style `2>nul` redirection in a POSIX shell creates a file at the
  repo root — it has appeared twice); check `git status --short` before every commit.
- **Tooling:** the contract slicer now has a `shipments` resource (architect arm), so §3 needs no whole-file
  contract read.

## 6. Exit gates
- AC-1..AC-11 each proven end-to-end against the real API + real SQLite (no MSW, no mocks), every test carrying a
  `// AC-n` traceability comment.
- Local `npx playwright test` in tests/e2e → base 47 + new tests passed, 0 failed, 0 flaky.
- AC-10 matrix proven with real JWTs: anonymous 401, Viewer 403 on POST / 200 on GET, Driver 403 on both
  (documented LOGI-0009/0010 deferral), Admin + Dispatcher 2xx.
- No file outside §2 changed (qa boundary: no `src/**`, no `contracts/**`); the LOGI-0006 spec still passes
  unmodified.
- Journal records gates + evidence; handoff qa→done recorded; spec front matter `done`; pushed SHA green in CI.
