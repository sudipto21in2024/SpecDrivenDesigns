---
ticket: LOGI-0012
arm: qa
status: done
created: 2026-10-02T07:16:00.000Z
depends_on_plans:
  - state/plans/LOGI-0012-architect.plan.md
  - state/plans/LOGI-0012-backend.plan.md
  - state/plans/LOGI-0012-frontend.plan.md
---

## 1. Objective

LOGI-0012 qa arm: prove the operations dashboard end-to-end against the **real API and the real
SQLite file** — not against the MSW mock the frontend suite uses. Three spec families, matching the
LOGI-0011 precedent:

- `dashboard.spec.ts` — the endpoint contract: the six untruncated counts, the BR-2 at-risk page and
  its envelope, one-instant consistency (AC-3), the utilization snapshots (AC-4/AC-5), validation and
  determinism (AC-8), and the non-regression sweep (AC-9).
- `dashboard-authz.spec.ts` — the role matrix on the API (AC-7) and the read-only-ness of the surface:
  POST/PUT/DELETE must be 405, never a silent 404 or a write.
- `dashboard-ui.spec.ts` — the manager landing page through the real browser: the six tiles render
  (zero tiles included), the at-risk list agrees with its tile, the pager steps, the utilization panels
  show the buckets, a Driver has no Dashboard tab, and every tile drills into an existing list endpoint.

The dashboard is org-wide, so **every** assertion must be scoped by a filter this arm owns (a route id
or the per-run reference-code tag) — an unfiltered dashboard also contains rows seeded by every other
spec in the suite. That constraint is what forces the fixtures to seed `status`/`sla_due_at` directly
into SQLite rather than walking a BR-7 transition chain.

## 2. Touched files (WRITE manifest — the scope boundary)

| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/support/dashboard.ts` | create | AC-1..AC-8 — `getDashboard`/`sendDashboardVerb` in the established status+body idiom, `seedDashboardShipment` writing `status`/`sla_due_at`/`route_id` straight into the throwaway SQLite file, a per-run tag so no assertion sees another spec's rows, and the response accessors (`statusCountOf`, `atRiskTotal`, bucket readers) that fail loudly rather than returning `undefined` | ~230 |
| `tests/e2e/pages/dashboard.page.ts` | create | AC-1..AC-8 — a `DashboardPage` object: the tab, the six tiles + at-risk tile, the at-risk rows and pager, the two utilization panels and their buckets, the filter controls, and the drill-down `href`s. `data-testid`/roles only, no raw CSS | ~200 |
| `tests/e2e/dashboard.spec.ts` | create | AC-1..AC-5, AC-8, AC-9 — the endpoint contract against the real API | ~380 |
| `tests/e2e/dashboard-authz.spec.ts` | create | AC-7 — the role matrix, the 401 bearer challenge, and the read-only surface (405 on every write verb) | ~150 |
| `tests/e2e/dashboard-ui.spec.ts` | create | AC-1..AC-8 — the manager landing page in a real browser | ~330 |
| `state/plans/LOGI-0012-qa.plan.md` | modify (via CLI) | qa-arm milestones and checks | via CLI |
| `memory/journal/LOGI-0012.md` | modify (tracker seal only) | qa-arm journal section | via CLI |

No pre-existing spec, page object or support module is edited. If a fix turns out to be needed in one
of them, that is a finding to record in the journal, not a silent edit inside this arm's scope.

## 3. Required files (READ-ONLY scope)

| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0012-operations-dashboard.md` | §4, §5, §7 | AC-1..AC-9, out-of-scope, and the O1-O4 decisions the backend and frontend already implemented against |
| `state/plans/LOGI-0012-backend.plan.md` | §5 | the handler's three governing rules, so a spec cannot assert a different one |
| `state/plans/LOGI-0012-frontend.plan.md` | §5 | the UI-side risks (null percent, untruncated counts, zero buckets) the UI spec must re-prove for real |
| `memory/journal/LOGI-0012.md` | architect + backend + frontend sections | the findings the earlier arms recorded, incl. the corrected parameter names |
| `tests/e2e/support/planning-board.ts` | 1-233 | the fixture idiom to mirror: direct SQLite writes, `efTimestamp`, the per-run tag, the outcome type |
| `tests/e2e/pages/planning-board.page.ts` | 1-164 | the page-object conventions: testid-only selectors, `pick()` for MUI selects, read-only accessors only |
| `tests/e2e/planning-board.spec.ts` | whole | how the API spec scopes itself to its own rows |
| `tests/e2e/planning-board-authz.spec.ts` | 1-60 | the role-matrix shape and the 401 bearer-challenge assertion |
| `tests/e2e/support/api.ts` | 1-120 | `signIn`, `authHeaders`, `seedWarehouse`, `seedVehicle`, `seedDriver`, `API` |
| `tests/e2e/support/shipments.ts` | outcome + list helpers | the `GET /shipments` reader AC-6/AC-9 compare the dashboard against |
| `tests/e2e/pages/login.page.ts` | whole | `signInAs` used by the UI page object |
## 4. Milestones (vertical slices)

- [x] 1. **M1 — fixtures + endpoint specs (AC-1..AC-5, AC-8).** Write `support/dashboard.ts` and
      `dashboard.spec.ts`: the six counts in lifecycle order with zero entries present and untruncated
      numbers over a route-scoped window (AC-1); the at-risk set including a Delivered/Cancelled row
      and a no-`sla_due_at` row that are never at risk while a Delayed one is, ordered by `slaDueAt`
      then id, with the standard envelope and negative-when-overdue `minutesToDue` (AC-2);
      `atRiskTotalCount` equal to the carried page's `totalCount` with every carried row itself at risk
      and one `generatedAt` governing the response (AC-3); vehicle buckets with `inUseCapacityKg`
      summing only InRoute and a Maintenance vehicle excluded (AC-4); driver buckets with a Suspended
      driver excluded (AC-5); and the 400 keyed-errors map, the default page size of 20, the
      byte-comparability of two identical reads, and the read-only storage check (AC-8).
      → verify: `npx playwright test dashboard.spec.ts` green against the real API.

- [x] 2. **M2 — authz + UI specs (AC-6, AC-7, AC-9).** Write `pages/dashboard.page.ts`,
      `dashboard-authz.spec.ts` and `dashboard-ui.spec.ts`: anonymous 401 with a bearer challenge,
      Driver 403, Viewer/Dispatcher/Admin 200 with an identical body, and POST/PUT/DELETE 405 (AC-7);
      the manager landing page rendering six tiles with zeros, a tile and its list agreeing (AC-6), the
      pager stepping across pages, both utilization panels with their buckets and the em-dash
      null-percent case, every tile/bucket `href` resolving to an existing list endpoint with the
      equivalent filter, the Driver having no Dashboard tab, and the shipments/planning-board/vehicles/
      drivers surfaces unchanged (AC-9).
      → verify: `npx playwright test dashboard-ui.spec.ts dashboard-authz.spec.ts` green.

- [x] 3. **M3 — full-suite verification + seal.** Re-run the complete Playwright suite so the AC-9
      non-regression sweep is proven against every pre-existing spec (LOGI-0006..0011), confirm no
      pre-existing spec was edited and no pre-existing test is now failing, seal the journal with the
      qa-arm section, HANDOFF qa→orchestrator recording the arm outcome and any findings, and update
      active state.
      → verify: full `npx playwright test` green with the same pass count as before plus the new specs;
      `git status --short` shows only §2 manifest paths; one atomic commit
      `test(LOGI-0012): add operations dashboard end-to-end coverage`.

## 5. Risks / open questions

- **The dashboard is org-wide, so an unfiltered assertion is meaningless (load-bearing).** Every other
  spec seeds shipments into the same throwaway database, so an unscoped count or at-risk total would
  assert on other specs' rows and fail intermittently depending on run order. Every test therefore
  scopes by its own route id or its per-run tag first. This is the single most likely source of a
  flaky suite and must not be traded away for convenience.
- **AC-3 is the criterion most likely to fail in a way that looks like a UI bug.** The tile count and
  the page total come from one server instant; the UI spec must assert they are equal while the page
  is on screen, and the API spec must assert `atRiskTotalCount === atRiskShipments.totalCount`
  directly. A UI that rendered `items.length` would pass a "list is non-empty" check and fail this.
- **A null percentage is not zero (AC-4/AC-5).** With an empty fleet the API returns
  `capacityUtilizationPercent: null`, and the UI renders an em dash. The UI spec must assert the em
  dash AND assert the absence of `0%`, because rendering the null as `0%` is the specific wrong
  behaviour AC-4 forbids.
- **Read-only means 405, not 404 (AC-7/AC-8).** The write-verb probe must distinguish "the verb is not
  allowed here" from "no such endpoint", so it asserts 405 and inspects the `Allow` header — exactly
  as the planning-board authz spec does.
- **Direct SQLite seeding must not fight the API.** Fixtures write while the API is idle
  (`workers: 1`, `fullyParallel: false`) with WAL plus a busy timeout, the same guarantee
  `support/planning-board.ts` documents. If a run reports `SQLITE_BUSY` or "database is locked", the
  fixture (not an assertion) is what is wrong.
- **BR-2 needs real instants.** A row only lands inside the 2h window if `sla_due_at` is written in
  EF's `yyyy-MM-dd HH:mm:ss.fffffff` UTC layout relative to *now*, so the seeder shares `efTimestamp`
  and the specs compute due dates from the current clock rather than hard-coding them.
- **AC-9 is a sweep, not a spot check.** The dashboard adds no behaviour to the other endpoints, so the
  only honest proof is the whole existing suite still passing — which is why M3 runs it rather than
  trusting the new specs alone.

## 6. Exit gates

- `npx playwright test` in `tests/e2e` passes the full suite: every pre-existing LOGI-0006..0011 spec
  still green, plus the three new dashboard specs.
- Every AC-1..AC-9 is covered by at least one test carrying a `// LOGI-0012 AC-n` comment.
- No pre-existing spec, page object or support module is edited; `git diff --name-only` over `tests/`
  lists only new files.
- No test asserts a 400/401/403/405 the real API does not actually produce — each is proven against
  the running server, not against the mock.
- `git status --short` shows only §2 manifest paths (plus tracker-derived state); one atomic commit
  for the arm.
| `tests/e2e/playwright.config.ts` | whole | `workers: 1`, the web/API projects, and the global setup that seeds the DB |