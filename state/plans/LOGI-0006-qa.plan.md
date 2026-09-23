---
ticket: LOGI-0006
arm: qa
status: locked
created: 2026-09-23T04:19:58.084Z
depends_on_plans: LOGI-0006-frontend, LOGI-0006-backend
---

## 1. Objective
LOGI-0006 QA: author `tests/e2e/shipment-status-lifecycle.spec.ts` covering AC-1..AC-8 against the real API +
real SQLite (no MSW, no mocks), plus a shipment fixture helper (creation is LOGI-0007, so rows are seeded
directly per spec §3) and a shared path module so the runner and the config cannot drift on the throwaway DB.
Suite grows 39 → 47 tests; the pushed SHA's CI run is the remote gate.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/support/paths.ts` | create | Single source of truth for the throwaway-DB path (API_PROJECT/E2E_DB_PATH) shared by the Playwright config and the fixture helper — LOGI-0013 was a path-divergence failure; no duplicated path constants | ~15 |
| `tests/e2e/playwright.config.ts` | modify | Import API_PROJECT/E2E_DB_PATH from the support module (behaviour identical: the same absolute path is injected as Database__ConnectionString) | ~8 |
| `tests/e2e/support/shipments.ts` | create | Shipment fixtures + endpoint helpers: seedShipment(originWarehouseId, status) — direct SQLite INSERT through node's built-in sqlite module (creation is LOGI-0007; spec §3 sanctions direct seeding), unique reference code per call, busy_timeout; postTransition/getHistory/driveShipment typed with the client's ShipmentStatus/ShipmentStatusEvent/StatusTransitionRequest — AC-1..AC-8 | ~90 |
| `tests/e2e/shipment-status-lifecycle.spec.ts` | create | AC-1..AC-8 against the real API + real SQLite: forward chain one step at a time + event echo + newest history entry; Cancelled legal from Pending/Assigned and 409 after; Delayed only from InTransit and reversible; illegal jump 409 naming the legal next state and status unchanged; 400 validation (missing/empty/unknown toStatus, 501-char note) with nothing recorded; 404 on both endpoints; append-only paged history oldest→newest with the note echoed verbatim; RBAC matrix (anonymous 401, Viewer 403 POST / 200 GET, Driver 2xx deferral, Admin + Dispatcher 2xx) — AC-1..AC-8 | ~290 |
| `memory/journal/LOGI-0006.md` | modify | qa-arm seal section (what/gates/findings/next) | ~30 |

Seal artifacts written by the tracker + memory protocol (no other file may change):
| `state/plans/LOGI-0006-qa.plan.md` | modify | status draft → validated → locked → done + per-step checkboxes |
| `state/events.jsonl` | modify | PLAN_*/TASK_STARTED/STEP_DONE/MICRO/HANDOFF events (tracker CLI only) |
| `state/handoffs.jsonl` | modify | tracker handoff --from qa --to done record |
| `state/tasks.json` | modify | derived snapshot rebuilt by the tracker |
| `memory/active.md` | modify | session end: position + next action |
| `memory/progress.md` | modify | LOGI-0006 row: qa ✅ |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0006-shipment-status-lifecycle.md` | full | AC-1..AC-8 source of truth, §2 role matrix, §3 preconditions ("tests seed directly until 0007 lands"), §5 out-of-scope, §8 timestamps |
| `contracts/v1-openapi.yaml` | 194-235, 600-670 | StatusTransitionRequest/ShipmentStatusEvent schemas + both shipment paths: x-roles, declared status codes, 409 Conflict wording. NOTE: tools/contract RESOURCES still lacks a shipments entry (journal follow-up) — read only these ranges (grep/sed), never the whole file |
| `memory/journal/LOGI-0006.md` | slices | Architect/backend/frontend sealed findings + checkpoint answers (Delayed→Cancelled illegal, 409 not 422, Driver x-roles now with scoping deferred) — via tracker journal-tail |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/20260922095953_LOGI-0006_AddShipmentStatusHistory.cs` | full | Exact table + column names/types for the seed INSERT (shipments, shipment_status_history) |
| `src/backend/LogiFlow.Domain/ShipmentStatus.cs` | full | BR-7 legal-next-state map + the 6-value status set the spec's assertions mirror |
| `src/backend/LogiFlow.Api.Tests/ShipmentEndpointsTests.cs` | 1-260 | Seeding idiom + exact response shapes (page/pageSize/totalPages/totalCount/items; ProblemDetails title/status + the errors map keys toStatus/note) — the API-level behaviour this spec re-proves end-to-end |
| `tests/e2e/support/api.ts` | full | signIn/authHeaders/seedWarehouse (origin FK fixture) + SEED_USERS idiom to extend |
| `tests/e2e/drivers.spec.ts` | full | E2E idiom: one describe per AC with // AC-n comments, RBAC-matrix shape, per-run unique data |
| `tests/e2e/global-setup.ts` | full | Why shipments need no API reset (no DELETE endpoint; start-api.mjs gives a fresh DB per run) |
| `tests/e2e/playwright.config.ts` | full | testDir/retries/timeout/webServer env (E2E_DB_PATH, Database__ConnectionString) |
| `tests/e2e/start-api.mjs` | full | Proof the DB file is removed before the API starts (so seeding needs no cleanup step) |
| `.github/workflows/ci.yml` | 55-108 | e2e job: Node 22, npm ci --prefix tests/e2e, failure artifacts (API log + db) |
| `src/frontend/src/api/client.ts` | 17-26, 225-250 | ShipmentStatus/ShipmentStatusEvent/StatusTransitionRequest + Paged<T> and the transition/history method signatures (types only; never read the generated schema.d.ts) |

## 4. Steps (each with verify gate)
- [x] 1. Ground truth before touching the suite: `dotnet build src/backend/LogiFlow.sln -c Release` (start-api.mjs
  runs the API with --no-build) → baseline `cd tests/e2e && npx playwright test` (39 passed expected) → spike the
  seed path by hand: with API + preview up, seedWarehouse through the API, INSERT one shipments row with node's
  built-in sqlite module, then POST a transition and GET the history through curl
  → verify: baseline 39 passed / 0 failed; spike POST → 200 with fromStatus Pending, toStatus Assigned and
  changedByUserId > 0; GET status-history → 200 totalCount 1; not a single row written for the rejected probe
- [ ] 2. Extract `tests/e2e/support/paths.ts` (API_PROJECT + E2E_DB_PATH) and have `tests/e2e/playwright.config.ts`
  import it instead of re-declaring the constants → verify: `npx playwright test --list` still lists 39 tests;
  `node -e` importing the module prints the identical absolute DB path the config injected before
- [ ] 3. Create `tests/e2e/support/shipments.ts` + the spec's AC-1 case (seed Pending, drive
  Pending→Assigned→InTransit→Delivered one step at a time, assert the event echo, the newest history entry and
  that a further illegal step is not needed here) → verify: `npx playwright test shipment-status-lifecycle.spec.ts`
  → 1 passed
- [ ] 4. Add the state-machine cases AC-2..AC-5 (Cancelled from Pending + Assigned, 409 from
  InTransit/Delivered and Cancelled-terminal; Delayed only from InTransit + reversible with 409 from
  Pending/Assigned/Delivered; illegal jump 409 whose detail names the legal next state with the status unchanged
  and totalCount 0; 400 errors map for missing/empty/unknown toStatus and a 501-char note, nothing recorded)
  → verify: the spec file passes 5/5
- [ ] 5. Add AC-6..AC-8 (404 on both endpoints for an unknown id; append-only paged history ordered oldest→newest
  with the note echoed verbatim, page/pageSize/totalPages/totalCount, and a rejected attempt appearing nowhere;
  RBAC: anonymous 401 on both, Viewer 403 on POST + 200 on history, Driver 2xx, Admin + Dispatcher 2xx)
  → verify: the spec file passes 8/8
- [ ] 6. Full-suite regression on the same build → verify: `cd tests/e2e && npx playwright test` → 47 passed,
  0 failed, 0 flaky; the run's Serilog log shows no SQLITE_BUSY and no "no such table" lines
- [ ] 7. Seal: journal qa-arm section (gates + evidence + findings), tick steps, `tracker log STEP_DONE` per step,
  manifest-exact commits, `tracker seal --ticket LOGI-0006 --arm qa`, `tracker handoff --ticket LOGI-0006 --from qa
  --to done --summary "memory/journal/LOGI-0006.md#qa-arm" --gates "..."`, memory active/progress via tracker,
  push and watch CI → verify: `git status --short` shows only §2 files; HANDOFF + PLAN_DONE events recorded;
  the pushed SHA's CI run is green (build-and-test + e2e)

## 5. Risks / open questions
- **Direct-DB seeding is the sanctioned path.** No shipment create endpoint exists until LOGI-0007 (contract
  exposes only the two lifecycle paths), so seedShipment INSERTs a shipments row using node's built-in sqlite
  module — verified flag-free on the local Node 22.18, and CI pins Node 22. It needs Node ≥ 22.5; on an older
  runner the import throws, and the fallback (spawn with the experimental-sqlite flag) is documented here but not
  implemented. No new npm dependency is added.
- **SQLITE_BUSY risk** — the API holds the file open through EF Core's connection pool. The seed connection sets a
  5s busy_timeout and the insert happens while the API is idle (no concurrent write), so a first-try write is
  expected; a busy failure must fail loudly rather than silently skip the fixture.
- **Origin FK** — `shipments.origin_warehouse_id` references `warehouses`, so the fixture seeds a warehouse through
  the real API (unique name) first; no hand-written warehouse rows.
- **No fromStatus=null "Created" entry here.** That initial audit row belongs to LOGI-0007 creation; this arm
  asserts non-null fromStatus and totalCount = number of accepted transitions, matching ShipmentEndpointsTests
  AC-7. Documented interpretation of AC-7's parenthetical (spec §7 ordering answer).
- **No UI assertions.** No shipment screens exist (LOGI-0007/0008), so the spec is API-level e2e over the real
  stack (real JWTs, real SQLite, real ProblemDetails). It must not touch `src/**` — qa boundary.
- **Retry safety** (CI retries: 1) — every reference code and warehouse name is unique per execution and all count
  assertions are scoped to a freshly seeded shipment, so a retry cannot observe the previous attempt's rows.
- **Stale local servers** on :5199/:5173 are reused (`reuseExistingServer: !CI`); kill leftovers so the run starts
  from a fresh throwaway DB (start-api.mjs only prepares it when it actually starts the API).
- **Tooling gap (unchanged, orchestrator follow-up):** `tools/contract/index.mjs` has no shipments resource, so
  §3 uses targeted line ranges instead; the qa boundary forbids touching tools/**.
- **Boundary:** no `src/**`, no `contracts/**`; the only harness change is the path-module extraction (same
  behaviour, single source of truth).

## 6. Exit gates
- AC-1..AC-8 are each proven end-to-end against the real API + SQLite (no MSW, no mocks), every test carrying a
  `// AC-n` traceability comment.
- Local `npx playwright test` in tests/e2e → 47 passed, 0 failed, 0 flaky (39 existing + 8 new).
- AC-8 matrix proven: anonymous 401 on both endpoints; Viewer 403 on transition + 200 on history; Driver 2xx
  (documented LOGI-0009/0010 ownership deferral); Admin and Dispatcher 2xx.
- No file outside §2 changed (qa boundary: no src/**, no contracts/**); harness behaviour unchanged.
- Journal records gates + evidence; handoff qa→done recorded; pushed SHA green in CI.
