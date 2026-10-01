---
ticket: LOGI-0011
arm: qa
status: done
created: 2026-10-01T16:12:44.101Z
depends_on_plans:
  - LOGI-0011-architect
  - LOGI-0011-backend
  - LOGI-0011-frontend
---

## 1. Objective
LOGI-0011 qa arm: Playwright e2e for GET /planning-board (AC-1..AC-9) against the real API and real SQLite, plus the board tab UI surface (tab-board, kanban columns, kanban/list switch, filter bar, capacity bar incl. no-vehicle, unassigned lane, load-more) and the Driver 403 / Viewer read-only role split.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/support/planning-board.ts` | create | AC-1..AC-9 — the endpoint helper returning status+body in one call (the existing route-shipments helper idiom), a seedBoardShipment fixture writing status/route_id/sla_due_at/priority directly (the six-status and 312-card truncation scenarios cannot be assembled through the BR-7 chain at reasonable cost), and a vehicle-on-route reuse wrapper | ~220 |
| `tests/e2e/planning-board.spec.ts` | create | AC-1/2/3/4/5/8/9 on the API — six columns in the fixed order incl. empty ones, untruncated totalCount vs truncated cards, each card in exactly one column matching its own status, list-vs-kanban card-for-card agreement, composable filters with the echoed `appliedFilters` (nulls for unsupplied), route capacity identical to `GET /routes/{id}/shipments` and null (not 0) with no vehicle, the unassigned lane and routeId not implying null, the keyed 400s, and the determinism/id-tiebreak check | ~380 |
| `tests/e2e/planning-board-authz.spec.ts` | create | AC-6/AC-7 against real JWTs — anonymous 401, Driver 403 ProblemDetails, Viewer 200 with a body identical to Admin's, write verbs 405 on both paths, and the read-only proof | ~140 |
| `tests/e2e/pages/planning-board.page.ts` | create | AC-1..AC-7 — page object for the board tab and its testids (`tab-board`, `board-column-<Status>`, `board-column-count-<Status>`, `board-column-empty-<Status>`, `board-card-<id>`, `board-load-more-<Status>`, `board-list`, `board-list-row-<id>`, `filter-*`, `view-kanban`, `view-list`, `unassigned-lane`, `board-route-<id>`, `board-error`), so no spec carries a raw selector | ~180 |
| `tests/e2e/planning-board-ui.spec.ts` | create | AC-1/2/3/5/7/8 — the board tab end-to-end: switch to Board as Dispatcher, read the seeded columns, toggle kanban/list over ONE response, apply a filter and see the counts move, the unassigned lane count, load-more on a truncated column, the capacity bar incl. "no vehicle assigned", and the Driver having no `tab-board` | ~230 |
| `state/plans/LOGI-0011-qa.plan.md` | modify (ticks) | step bookkeeping | via CLI |
| `memory/journal/LOGI-0011.md` | modify (tracker seal only) | qa-arm journal section | via CLI |
| `specs/features/LOGI-0011-planning-board.md` | modify | ticket-close chore only: front matter → `done` once the last arm seals | 1 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0011-planning-board.md` | full | AC-1..AC-10 and §7 O1-O4 — the exact assertion set |
| `contracts/v1-openapi.yaml` | planning-board slice | the 8 query params, the response codes, `RouteCapacityView` null semantics — via `node tools/contract/index.mjs show --resource planning`, not a file read |
| `tests/e2e/support/route-shipments.ts` | 1-140 | the status+body idiom, `driverScopedWindow`, the direct-SQLite seeding convention |
| `tests/e2e/support/shipments.ts` | full | `seedShipmentAt` / `getShipment` / `listShipments` and the EF timestamp layout |
| `tests/e2e/support/routes.ts` | full | `seedRoute` / `createRoute` / `ensureDriverLinkedToUser` |
| `tests/e2e/support/api.ts` | full | `signIn`, `SEED_USERS`, `authHeaders`, `seedVehicle` |
| `tests/e2e/route-shipments-authz.spec.ts` | full | the authz-matrix shape this ticket's matrix must match |
| `tests/e2e/pages/routes.page.ts` | full | the page-object conventions (goto per role, no raw selectors in specs) |
| `src/frontend/src/features/planning/PlanningBoardPage.tsx` | full | the exact `data-testid` set and the UI-only behaviours the UI spec drives |
| `tests/e2e/playwright.config.ts` | full | single-worker / `fullyParallel: false` constraint the direct-SQL fixtures rely on |

## 4. Steps (each with verify gate)
- [x] 1. **M1 — fixtures + API/authz specs.** Write `support/planning-board.ts` (the endpoint helper returning status+body; `seedBoardShipment` writing status/route_id/sla_due_at/priority directly so a six-status board and a 312-card truncation column are direct rather than assembled through the BR-7 chain; a vehicle-on-route reuse helper for the capacity-parity case), then `planning-board.spec.ts` (AC-1 columns-in-order, never omitted, each card once in its own status, untruncated totalCount; AC-2 list vs kanban card-for-card; AC-3 filter composition + the null-echoed `appliedFilters`; AC-4 route capacity numerically identical to `GET /routes/{id}/shipments` and null-not-zero with no vehicle; AC-5 the unassigned lane and routeId not implying null; AC-8 the keyed 400s and 50-of-312 truncation; AC-9 two identical requests stable in column and card order) and `planning-board-authz.spec.ts` (AC-6 real-JWT matrix; AC-7 the 405s on write verbs for both planning-board paths). → verify: `cd tests/e2e && npx playwright test planning-board.spec.ts planning-board-authz.spec.ts` green.

- [x] 2. **M2 — page object + UI spec.** Write `pages/planning-board.page.ts` (gotoBoard per role, column/card/load-more/list/filter/route/lane accessors — no raw selectors in specs) and `planning-board-ui.spec.ts` (AC-1 the seeded columns render with their untruncated counts; AC-2 kanban↔list over one response; AC-3 a filter narrows the counts; AC-5 the unassigned lane count; AC-8 load-more extends a truncated column; AC-4 the capacity bar incl. the explicit no-vehicle state; AC-6/AC-7 a Driver sees no `tab-board` and a Viewer sees the read-only board). → verify: `cd tests/e2e && npx playwright test planning-board-ui.spec.ts` green.

- [x] 3. **M3 — full-suite regression + seal.** Run the whole e2e suite, then `tracker seal --ticket LOGI-0011 --arm qa`, tick every step, one `tracker log --type STEP_DONE` per verified step, one atomic arm commit (tests + journal + spec close + tracker state), `tracker handoff --ticket LOGI-0011 --from qa --to done`, and `tracker active` / `tracker progress --ticket LOGI-0011`. → verify: the suite summary shows every pre-existing spec still passing, 0 failed, 0 flaky; `git status --short` shows only §2 manifest paths; HANDOFF + PLAN_DONE events recorded.

## 5. Risks / open questions
- **The MSW mock is not evidence.** The frontend arm's mock is the only board data source in the unit tests; every assertion here must come from the real API + real SQLite, or AC-4's single-source-of-truth claim proves nothing.
- **AC-2's "list projection" is the UI flattening the columns.** The board returns columns; the flat list is the UI's view over the same response. If the contract or the API disagrees, record it — do not widen this arm to patch `src/**`.
- **The board is org-wide, so fixtures pollute every other spec.** Columns are assertions over the whole board, so a seeded card is visible to other specs. Scope assertions with a filter (status + routeId + a per-run `q` on a seeded reference code) wherever possible, and never assert a global totalCount without a filter.
- **Shared seed users / the linked driver row.** `ensureDriverLinkedToUser` is suite-shared; reuse it and leave it linked as the route specs do.
- **Truncation fixtures are expensive.** A 312-card column means 312 rows; seed them once in a `test.describe.serial` block that owns its assertions rather than per test.
- **No src/contract edits.** A defect uncovered here is recorded and fixed in its own arm; this manifest must not stretch.

## 6. Exit gates
- `cd tests/e2e && npx playwright test` green, 0 failed, 0 flaky, with no pre-existing spec modified to accommodate LOGI-0011.
- AC-1..AC-9 each covered by at least one test whose title carries a `// LOGI-0011 AC-n` marker; no test asserts a status the real API does not return.
- Every UI spec drives the board through `pages/planning-board.page.ts` — no raw CSS selectors in spec files.
- `git status --short` shows only §2 manifest paths (plus tracker-derived state); one atomic commit for the arm.
