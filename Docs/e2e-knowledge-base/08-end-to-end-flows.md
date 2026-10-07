# 08 — End-to-End Flows (traced walkthroughs)

Key scenarios as they actually execute in the browser, mapping to the files involved. These are
the "what's actually on the screen during a test" versions of the backend docs.

## 1. An anonymous visit → sign in → warehouse CRUD

```text
spec: test('AC-1: creates a warehouse and shows it in the list')
  1. page.goto('/')  → login page (expect heading 'Sign in to LogiFlow')
  2. LoginPage.gotoAnonymous() — clears localStorage, reloads (localStorage is per-origin and
     survives navigation; a stale token would boot the next test signed in)
  3. fill('Email'), fill('Password'), click('#sign-in')  → real /auth/login (200)
  4. expect(getByTestId('current-role')).toHaveText('Admin')  ← role chip after login
  5. click('New Warehouse') → dialog → fill name/address → click 'Create' → 201 response
     → table row appears (API-backed rendering, no hydration delay for the table)
  6. UI assertions: rows, pagination, search, 404 for missing — each driven by real API calls
```

- Gating is real: unauthenticated requests get `401 application/problem+json`; role-gated writes
  (delete) are 403. The frontend's `can()` hides buttons, the API re-checks.
- The role chip (`data-testid="current-role"`) is the smoke test for the whole auth flow.

## 2. Shipment lifecycle (status machine, BR-7)

```text
shipment-status-lifecycle.spec.ts
  1. create shipment through the real API (Pending)  → 201
  2. transition to Assigned/InTransit/Delivered/Delayed via the real status-transition endpoint
       → each transition validates BR-7 (Pending→Assigned|Cancelled only, ...)
       → illegal move → 409 + problem.detail naming legal next states
  3. read status history through the real endpoint
  4. UI: row actions change with status (edit/cancel affordances), table re-renders after each
```

- `shipment-cancel.spec.ts` covers the BR-6 rule: cancel is Admin/Dispatcher-only (Viewer/Driver
  click → 403; dispatcher cancels → 200).
- `shipment-edit.spec.ts` covers pending-only edits (409 after a non-Pending transition).

## 3. Route create + assign (BR-3/BR-4/BR-5) with the capacity race

```text
routes-create.spec.ts / route-shipments.spec.ts
  1. seed vehicle + driver (real API), create route via API (Planned) → 201
  2. seed shipment via fixture (PUT into the throwaway DB; cannot be created with the server-owned
     Planned-only status defaults) → row present, unassigned
  3. assign via the real endpoint:
       guard chain — unknown route 404, not Planned 409, unknown shipment 404,
       capacity guard (BR-5) → over-capacity → 409 (rollback contract)
       → success: 200 with routeId/status Assigned; history row appended in the SAME transaction
  4. re-assign to the same route → idempotent 200, no double history row, no double weight
  5. UI: the route's shipment panel lists the assigned shipment; unassign returns it to Pending
```

- This is the logged race: `RouteShipmentAssignTests` forces two concurrent boundary assigns so
  the loser gets a 409 and the DB stays consistent (LOGI-0010 AC-9). The E2E suite can't force that
  race easily (workers:1), but the API tests pin it, and the UI specs verify the result states.

## 4. Authz matrix (role rules at the browser level)

```text
drivers.spec.ts / routes-authz.spec.ts / planning-board-authz.spec.ts / dashboard-authz.spec.ts
  1. sign in as Viewer (alex? no — vera@logiflow.dev)
  2. browser verifies: /drivers not offered, /planning 403 ProblemDetails, /dashboard tab hidden,
     role chip shows Viewer
  3. sign in as Dispatcher: /drivers offered, write affordances absent
  4. sign in as Driver: /drivers tab absent entirely (spec §2 deferral: Driver 403 even on reads)
  5. assertions on what IS rendered (tables, chips) vs NOT rendered (buttons, tabs, menus)
```

Access control here is three-layer: endpoint policy (401/403 as ProblemDetails), UI affordances
(hidden tabs/buttons), and client-side role gating (the tab shell shows only matching tabs).

## 5. Root-cause diagnosis of an E2E failure

These traces are what a failure looks like end to end:

```text
Test: LOGI-0007 AC-6 — paged envelope
  1. beforeEach: signIn as Admin → 200 (real login)
  2. freshWarehouse → seedWarehouse → 201
  3. createRow × 27 → each 201 (fixture create)
  4. listShipments({originWarehouseId}) → 200, body matches {page:1, pageSize:25, totalCount:27}
  5. assert on items.length === 25 → FAIL  (stale data / wrong scope...)
  → Playwright trace: DOM snapshot at assertion, network entry/exit for listShipments,
    console messages, video of the failure. Reading the trace localizes the line.
```

When the trace points to the network layer, check the API/e2e DB (the throwaway file survives a
run and is a full post-mortem: attach it, query the rows left by the run). When it points to the
DOM, check the page object and selectors. When it points to the UI-level helpers, check for a
stale assertion (the DOM changed) or a timing issue (actionTimeout 7s — a slow click isn't a
failure, it's the spinner).

## 6. The "one failure with 24 passing" verdict

The suite is intentionally **deterministic and isolated per run**: shared state is the enemy,
wall-clock is the enemy, leftover state is the enemy. When a test fails, the answer is almost
always (1) shared DB state (run the file alone), (2) a missing/renamed helper, or (3) a real
regression the test was written to catch. The trace + DB dump usually settle it in one pass.
