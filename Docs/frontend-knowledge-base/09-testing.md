# 09 — Testing (Vitest + MSW + Testing Library)

**162 tests in 11 files, all green as of the current master.** Run with `npm test`
(one-shot) or `npm run test:watch`.

## 1. The stack and how it fits together

| Piece | File | Job |
|---|---|---|
| Vitest config | `vite.config.ts` `test` block | jsdom environment, globals, `setupFiles` |
| Setup | `src/test/setup.ts` | jest-dom matchers + starts MSW **server** for every suite |
| Mock API | `src/mocks/handlers.ts` | in-memory DBs, endpoint handlers, role rules, seed/reset helpers |
| Harness | `src/test/renderApp.tsx` | `renderAppAs(role)`, `renderAnonymousApp`, `resetMocks` |
| Specs | co-located `*.test.ts(x)` | e.g. `WarehousesPage.test.tsx` next to the page |

```ts
// src/test/setup.ts — the whole file
export const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));  // any unmocked call FAILS loudly
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: 'error'` is important: a test can never silently hit the real network or
bypass an unmocked endpoint.

## 2. The harness (`src/test/renderApp.tsx`)

```tsx
export function renderAppAs(role: Role = 'Admin') {
  const { token, user } = seedSession(role);            // mock session registry issues a token
  tokenStore.set({ accessToken: token, refreshToken: `mock-refresh-${user.id}` });
  return render(<App />);                               // the REAL app, nothing stubbed
}
export function renderAnonymousApp() { tokenStore.clear(); return render(<App />); }
export function resetMocks() { /* resets all mock DBs + tokenStore.clear() */ }
```

Design: tests establish a session **exactly as the real SPA does** (token in the real store, user
in the mock session registry). Consequently the `Authorization` header is genuinely sent and MSW's
role rules are genuinely exercised — no component-level stubbing, no shortcut around auth.

Typical spec skeleton:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach } from 'vitest';
import { seedWarehouse } from '../../mocks/handlers';
import { renderAppAs, resetMocks } from '../../test/renderApp';

beforeEach(() => { resetMocks(); });

describe('WarehousesPage (LOGI-0001)', () => {
  it('renders warehouses from the API', async () => {
    seedWarehouse({ name: 'Central DC', address: '12 Industrial Rd' });
    renderAppAs('Admin');
    expect(await screen.findByText('Central DC')).toBeInTheDocument();
  });
});
```

## 3. The MSW mock API (`src/mocks/handlers.ts`, ~2200 lines)

Models the contract, not just happy paths:

- **In-memory stores** (`warehousesDb`, `vehiclesDb`, …) with `reset*Db()`/`seed*()` helpers and a
  shared `nextId` counter.
- **Auth**: `mockUsers` (4 seeded accounts, one per role), `mockPassword`, session registry,
  `login/refresh/logout/me` handlers, real bearer-token validation.
- **Role rules** (`roleRules`, `driverRoleRules`) mirroring contract `x-roles` — including the
  Driver-excluded-from-`/drivers` 403 — so permission tests are real.
- **Semantics**: paging envelope, `ProblemDetails` errors (400 field errors, 403, 404, 409
  capacity/state conflicts), 201/204 behaviors.
- The same handlers run in the browser under `VITE_ENABLE_MOCKS=1` (`mocks/browser.ts`
  `setupWorker`) — dev without a backend uses exactly what tests use.

When you add an endpoint: contract → `client.ts` → **handlers** → tests. Skipping handlers leaves
tests failing on `onUnhandledRequest`.

## 4. Query conventions

- **Async first:** `await screen.findByText(...)` / `findByRole(...)` — never assert before the
  query resolves; React Query renders `isPending` first.
- **Roles and accessible names first:** `findByRole('button', { name: 'New Warehouse' })`,
  `getByLabelText('Warehouse name')` — resilient to markup changes.
- **`data-testid` for non-semantic targets:** `current-role`, `sign-out`, `tab-shipments`,
  `warehouse-row-3`, `board-column-Pending`, `snackbar`, `confirm-delete`. (MUI gotcha documented
  in `DashboardPage.tsx`: the testid must go on the `Select` *root* because its inner input has
  `pointer-events: none`.)
- **Absence assertions:** `expect(screen.queryByText('Warehouses')).not.toBeInTheDocument()` —
  gating tests assert what is NOT rendered (e.g. no write affordances for Viewer/Driver).
- **`userEvent.setup()`** per test, then `await user.click/type` — simulates real events (RHF,
  MUI menus) unlike the lower-level `fireEvent`.
- **Negative request assertions:** "dismissing the cancel confirmation sends no request" — MSW
  handler counters or simply no state change.

## 5. What kinds of tests exist

| Kind | Example | Notes |
|---|---|---|
| Full-app integration (majority) | `Auth.test.tsx`, `WarehousesPage.test.tsx`, `ShipmentsPage.test.tsx` | render whole `<App/>` as a role, drive UI, assert DOM + mock server effects |
| Pure unit (no DOM) | `appNavigation.test.ts`, `shipmentsFilterParams.test.ts` | URL/tab parsing logic extracted specifically to be testable this way |
| Component-scoped | `RouteShipmentsPanel.test.tsx` | panel against seeded route/shipment state |

Tests are named after **acceptance criteria** (`it('AC-11: …')`) — they are executable
specifications traced to tickets (LOGI-0001…LOGI-0012).

## 6. Common patterns

```tsx
// role matrix: same action, different roles
renderAppAs('Viewer');
expect(screen.queryByRole('button', { name: 'New Warehouse' })).not.toBeInTheDocument();

// validation: submit empty → Zod messages appear
await user.click(await screen.findByRole('button', { name: 'Create' }));
expect(await screen.findByText('Name is required')).toBeInTheDocument();

// server error path: bad value → handler answers 400 → field shows server message
// conflict path: handler answers 409 → snackbar shows problem.detail → row refetches
```

## 7. Running & debugging

```bash
cd src/frontend
npm test                 # whole suite
npm run test:watch       # interactive
npx vitest run src/features/warehouses    # one folder
npx vitest run src/features/warehouses/WarehousesPage.test.tsx   # one file
```

Notes:

- Suite takes ~60s (jsdom + many full-app renders) — normal.
- `beforeEach(resetMocks)` at the top of each spec is mandatory; shared `nextId` and stores make
  skipped resets cause cross-test bleed.
- If a test hangs or fails on an unmocked route, the error names the exact path — add a handler.

