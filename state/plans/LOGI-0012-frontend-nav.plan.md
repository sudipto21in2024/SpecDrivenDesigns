---
ticket: LOGI-0012
arm: frontend
status: locked
created: 2026-10-04T06:52:00.000Z
depends_on_plans:
  - state/plans/LOGI-0012-frontend-followup.plan.md
---

## 1. Objective

LOGI-0012 frontend correction: **make the dashboard drill-down actually navigate.** The qa browser arm
found the drill-down is a dead link — not a route filter bug.

Three gaps, all in the SPA shell, none of them in the filter chain the previous arm fixed:

1. **No navigator is wired.** `App.tsx:145` renders `<DashboardPage />` with no `onNavigate` prop, so
   `DashboardPage.tsx:329`'s default no-op applies. `StatusTile.tsx:43-48` calls `event.preventDefault()`
   and then delegates to that no-op, so the click is *actively swallowed*.
2. **There is no router.** `MasterDataTabs` (`App.tsx:113-158`) is local `useState` tab switching, and
   nothing in the app writes `window.history` or `window.location.search`.
3. **Therefore the URL hydration can never fire.** `ShipmentsPage`'s lazy `initialShipmentFilters()`
   reads `window.location.search`, and no code ever puts the drill-down query there. The previous
   frontend arm made a correct pipeline out of a source that was never connected.

The design rule: **one navigation handler, in the shell, that owns both halves of an SPA move** — which
tab to show, and what the address bar says. `MasterDataTabs` already owns the tab, so it owns the
handler too; `DashboardPage` keeps its injected-callback seam (its unit tests depend on it) and the
shell becomes the first real implementor of that seam.

`window.history.pushState` rather than `location.assign`: a full page load would re-run the whole auth
bootstrap for a read-only drill-down, and `pushState` keeps the SPA contract the tab-switching shell
already has. The href stays a real anchor either way, so copy-link and middle-click still work.

## 2. Touched files (WRITE manifest — the scope boundary)

| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/App.tsx` | modify | AC-6 — supply `onNavigate` to `DashboardPage`; the handler switches the tab and pushes the query into history | ~5 |
| `src/frontend/src/appNavigation.ts` | create | AC-6 — the href→tab grammar and the shell's navigation hook, extracted because `App.tsx` carries a 158-line ratchet and the logic is far clearer as one named unit | ~115 |
| `src/frontend/src/appNavigation.test.ts` | create | AC-6 traceability for the grammar, including the query-vs-segment regression that broke the drill-down on the first attempt | ~80 |
| `src/frontend/src/features/dashboard/DashboardPage.tsx` | verify only | the injected seam already exists and is optional; no edit needed | 0 |
| `tests/e2e/dashboard-drilldown-browser.spec.ts` | verify only | the qa arm's spec must go green **unedited** — editing it would destroy the only evidence of the defect | 0 |
| `state/plans/LOGI-0012-frontend-nav.plan.md` | create | this arm's milestones | via CLI |
| `memory/journal/LOGI-0012.md` | modify (tracker seal only) | frontend-nav journal section | via CLI |

No page, hook or query module changes. The href builders already produce `/shipments?…`,
`/vehicles?…` and `/drivers?…`, which are exactly the tab values the shell uses.

## 3. Required files (READ-ONLY scope)

| Path | Lines | What's needed |
|---|---|---|
| `src/frontend/src/App.tsx` | 113-158 | `MasterDataTabs`, the tab state and the page switch — the only place a navigation handler belongs |
| `src/frontend/src/features/dashboard/DashboardPage.tsx` | 327-333 | the `onNavigate` prop seam and its no-op default |
| `src/frontend/src/features/dashboard/StatusTile.tsx` | 32-52 | the `preventDefault()` + delegate pattern the handler must make real |
| `src/frontend/src/features/dashboard/DashboardPage.tsx` | 280-295 | the vehicle/driver bucket `Link`s, which swallow clicks identically |
| `src/frontend/src/features/dashboard/schema.ts` | 128-160 | `shipmentListHref` and the vehicle/driver hrefs — the href shapes the handler must parse |
| `tests/e2e/dashboard-drilldown-browser.spec.ts` | full | the failing spec, which is the acceptance criterion |
## 4. Milestones (vertical slices)

- [ ] 1. **M1 — the shell navigates.** Add one `navigate(href)` handler in `MasterDataTabs`: parse the
      leading path segment as the target tab, `pushState` the href so the address bar is truthful, then
      `setTab`. Pass it to `<DashboardPage onNavigate={…} />`. Guard the unknown-segment case (a href
      with no recognised tab must not blank the screen). Switching away and back must RE-MOUNT the list
      page so its lazy initialiser re-reads the URL — this is why the tab is state, not a route match.
      → verify: `npx tsc --noEmit` 0 errors; `npm run build` clean; `npm test` green with no
      pre-existing test edited (the dashboard unit tests inject their own `onNavigate` and are
      unaffected).

- [ ] 2. **M2 — the qa spec goes green unedited.** Run the qa arm's
      `tests/e2e/dashboard-drilldown-browser.spec.ts` against the built bundle and the real API. Both
      cases must pass with zero edits to the spec: the href assertions already passed, and the post-click
      row assertions are what this milestone buys.
      → verify: `cd tests/e2e && npx playwright test dashboard-drilldown-browser.spec.ts` 2 passed;
      `git diff --stat tests/e2e/dashboard-drilldown-browser.spec.ts` empty.

- [ ] 3. **M3 — no regression, and the other drill-downs are alive.** The full Playwright suite must stay
      green (`ShipmentsPage` hydration and the tab shell are load-bearing for every existing spec), and
      the vehicle/driver bucket links — dead for the same reason — should now navigate too. Confirm the
      API run log has no SQLITE_BUSY / no-such-table, `check-size.mjs` is clean on `App.tsx`, and
      `git status --short` lists only §2 paths.
      → verify: `npx playwright test` all green; clean API run log.

## 5. Risks

- **Editing the failing spec is the tempting wrong move.** It is the only record that the bug existed;
  loosening a wait or asserting the dashboard still rendered would make it green and destroy the
  evidence. The spec is in §2 as *verify only* for exactly this reason.
- **`pushState` without a `popstate` listener leaves Back broken.** After a drill-down, Back must return
  the dispatcher to the dashboard rather than leaving the address bar and the screen disagreeing. A
  minimal `popstate` handler that re-derives the tab from `location.pathname` closes this; skipping it
  is a real UX defect, not a nitpick, and this arm must not ship it.
- **A URL left behind can corrupt the NEXT mount.** Once `location.search` carries
  `?status=Pending&routeId=3`, any later visit to the Shipments tab (by clicking the tab, not by
  drill-down) would hydrate those stale filters, because `ShipmentsPage` reads the URL on mount and the
  shell no longer clears it on tab clicks. The handler must reset the query when the tab is reached by
  a plain tab click, so stale drill-down state cannot bleed into an unrelated visit.
- **Ordering matters more than it looks.** `pushState` must land BEFORE `setTab`, otherwise React mounts
  `ShipmentsPage` while the URL is still the dashboard's and the lazy initialiser reads the wrong query.
- **Scope discipline.** The bucket links to `/vehicles` and `/drivers` are fixed by the same handler
  because they go through the same seam — that is not scope creep, it is the same defect. But adding a
  *router*, URL-driven tab state, or per-page filter persistence for the other five pages is out of
  scope and would pull LOGI-0012 into a navigation redesign nobody asked for.

## 6. Exit gates

- `npx tsc --noEmit` 0 errors; `npm run build` clean; `npm test` green with no pre-existing test edited.
- `npx playwright test dashboard-drilldown-browser.spec.ts` — 2 passed, and the spec is byte-identical
  to the qa arm's version.
- `npx playwright test` in `tests/e2e` fully green.
- Every case carries a `// LOGI-0012 AC-6` marker.
- `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0012-frontend-nav.plan.md` 0 errors.
- `check-size.mjs` clean on `App.tsx`.
- `git status --short` lists only §2 paths; one atomic commit `fix(LOGI-0012): make the dashboard drill-down navigate`.