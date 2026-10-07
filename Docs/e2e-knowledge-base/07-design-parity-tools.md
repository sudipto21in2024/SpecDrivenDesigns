# 07 — Design-Parity Capture Tool (`capture-design-parity.mjs`)

A non-test script that screenshots the app against the running Docker stack, so UI screenshots
show real seeded rows instead of empty states.

## 1. What it is (and is not)

- **It is NOT a test.** It asserts nothing and writes PNGs to
  `test-results/design-parity/` — a daily-layout snapshot, not a pass/fail signal.
- It drives the **already-running Docker stack**: nginx on :8080 with the demo dataset seeded,
  i.e. the production-like state (seeded warehouses/vehicles/drivers/routes/shipments), not the
  throwaway E2E DB.

## 2. Running it

```bash
# ensure the stack is up first (from the repo root)
docker compose up -d
# then capture
cd tests/e2e
node capture-design-parity.mjs
# views are written to test-results/design-parity/{vehicles,warehouses,drivers,routes,
#                                                shipments,dashboard,planning-board}.png
```

## 3. What it captures and why

```ts
const PAGES = [
  { name: 'vehicles', path: '/vehicles' },
  { name: 'warehouses', path: '/warehouses' },
  { name: 'drivers', path: '/drivers' },
  { name: 'routes', path: '/routes' },
  { name: 'shipments', path: '/shipments' },
  { name: 'dashboard', path: '/' },
  { name: 'planning-board', path: '/planning' },
];
```

For each page it:

1. renders at 1440×1000,
2. scrolls to reveal content below the fold (paginated grids, the long status chips list),
3. snapshots the viewport.

The purpose is **visual regression hygiene**: designers and reviewers compare screenshots of the
real UI against the repo's mockups/earlier screenshots, and a layout change (MUI theme, grid
width, chip sizing, pagination) shows up visibly rather than only in a test dump.

## 4. Interaction with the rest of the suite

- `capture-design-parity.mjs` is independent of `playwright test`: it uses Playwright's
  **library API** (`chromium.launch()`, `context.newPage()`), not the test runner. It can run
  anytime the stack is up.
- It ships inside the E2E project for two reasons: Playwright is already a pinned dependency
  there, and it uses the same `tests/e2e/support` conventions if any later design-parity run
  needs auth (currently it logs in as Admin with the well-known dev credentials).
- When screenshots change (theme, grid, pagination) update this script's `PAGES` list rather
  than the tests, and commit the new PNGs to the design-parity repository.

## 5. Guardrails

- Never ship a screenshot of an empty state as "the product" — empty states are snapshots of
  missing data, and they drift every release.
- The `BASE_URL` env override exists so the script can point at anything (local preview, a
  staging URL, a PR preview), as long as it serves the LogiFlow UI with the same selectors.
