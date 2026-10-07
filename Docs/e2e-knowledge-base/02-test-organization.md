# 02 — Test Organization

The suite's layout, the three layers that compose a test, and the conventions that keep 167 tests
retry-safe.

## 1. Directory layout

```text
tests/e2e/
├── *.spec.ts                 # 25 spec files (see §2): one describe() per ticket/feature
├── pages/                    # page objects: real selectors, real waits, no assertions-on-actions
│   ├── login.page.ts         # login screen
│   ├── warehouses.page.ts, vehicles.page.ts, drivers.page.ts
│   ├── shipments.page.ts, routes.page.ts, planning-board.page.ts, dashboard.page.ts
├── support/
│   ├── api.ts                # signIn, seedWarehouse/Driver/Vehicle, authHeaders (API-level helpers)
│   ├── shipments.ts          # createShipment/listShipments + direct-sqlite fixtures
│   ├── routes.ts             # route CRUD helpers + uniqueRef/routeName/window
│   ├── route-shipments.ts, planning-board.ts, dashboard.ts, drivers.ts
│   ├── paths.ts              # E2E_DB_PATH, API_PROJECT, API base URL (single source of truth)
└── *.mjs                     # capture-design-parity.mjs (non-test helper)
```

## 2. Spec anatomy (example: `ShipmentsList.spec.ts`)

```ts
import { expect, test, type APIRequestContext } from '@playwright/test';   // static imports only
import { ShipmentsPage } from './pages/shipments.page';
import { seedWarehouse, signIn } from './support/api';
import { createShipment, listShipments, seedShipmentAt } from './support/shipments';

/** Run tag: keeps this suite's data unique when a CI retry re-runs the whole file. */
const runTag = `e2e${Date.now().toString(36)}`;
let sequence = 0;

test.describe('LOGI-0007 shipment list & search', () => {
  let adminToken: string;
  let dispatcherToken: string;

  test.beforeEach(async ({ request }) => {                    // per-test session
    adminToken = (await signIn(request, 'Admin')).accessToken;
    dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;
  });

  async function freshWarehouse(request: APIRequestContext): Promise<number> {
    return seedWarehouse(request, adminToken, `${runTag} WH ${sequence++}`);   // fresh scope per test
  }

  async function createRow(request: APIRequestContext, warehouseId: number, overrides: object = {}): Promise<{ id: number; referenceCode: string }> {
    const created = await createShipment(request, dispatcherToken, { originWarehouseId: warehouseId, destinationAddress: `${runTag} destination`, weightKg: 100, ...overrides });
    expect(created.status, 'the fixture create must succeed').toBe(201);   // API-level assertions in helpers
    return { id: Number(created.body.id), referenceCode: String(created.body.referenceCode) };
  }

  test('AC-6 — paged envelope with defaults, totalCount over all matches, 400 on bad paging', async ({ request }) => {
    const warehouseId = await freshWarehouse(request);
    for (let index = 0; index < 27; index++) await createRow(request, warehouseId, { destinationAddress: `${runTag} paged ${index}` });
    const first = await listShipments(request, adminToken, { originWarehouseId: warehouseId });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 25, totalCount: 27, totalPages: 2 });
    expect(first.body.items?.length).toBe(25);
    // ... more assertions
  });
});
```

Structural rules:

- **Static imports only** for Playwright (`expect`, `test`, `APIRequestContext`) — the test
  function/hook API is stable across the whole suite.
- **One `test.describe` per ticket/feature** (e.g. 'LOGI-0007 shipment list & search'), with
  `test.beforeEach` establishing the authentication tokens — auth is never part of a test body.
- **API-level helpers live in `support/`**, so a spec never issues HTTP directly and can never
  drift into a different endpoint than the helper covers.
- **`expect(asyncFn)` style is avoided** in favor of explicit await + `expect(x).toBe(y)` — the
  spec reads like a linear story: arrange (via the API), act, assert.

## 3. Page objects (the UI half)

```ts
// pages/login.page.ts — "the sign-in screen" as a first-class object
export class LoginPage {
  readonly emailInput = () => this.page.getByLabel('Email');
  readonly passwordInput = () => this.page.getByLabel('Password');
  readonly signInButton = () => this.page.getByTestId('sign-in');
  async goto(): Promise<void> { ... }
  async gotoAnonymous(): Promise<void> { ... }
  async signIn(role: SeedRole = 'Admin'): Promise<void> { ... }
  async signInAs(role: SeedRole = 'Admin'): Promise<void> { ... }
}
```

- Locators (`getByLabel`, `getByTestId`, `getByRole`) live here, and selectors are never spelled
  in spec files. `data-testid` attributes are the stable hooks (the MUI testid-is-on-select-root
  gotcha is documented in the frontend knowledge base).
- Page objects also carry **behavior/scoping**: `signInAs` waits for the role chip, `gotoAnonymous`
  clears `localStorage` before booting (localStorage is per-origin and survives navigation —
  without the clear, a previous test's valid token would boot the next test in as signed-in).
- Specs compose page objects and support helpers; they assert on DOM state and on the API
  responses the helpers return.

## 4. Naming conventions

| Area | Convention | Example |
|---|---|---|
| Spec filenames | `<feature>-<ticket>.spec.ts`, one feature per file | `shipments-list.spec.ts`, `route-shipments.spec.ts` |
| Test names | `AC-<n> — <what it proves>` | `'AC-6 — paged envelope...'` |
| Helper names | `camelCase` verbs: `seedWarehouse`, `createShipment`, `listShipments`, `routeName` | — |
| Unique data | `runTag` (date) + `seq` counter per run; `uniqueRef(tag)` for plate/licence | `e2eabc123-RWH-0`, `RTV-e2eabc123-2` |
| Seed roles | `SEED_USERS` + `SEED_PASSWORD` from `support/api.ts` mirror backend `SeedData` | `alex@logiflow.dev` / `logiflow-dev-password` |

## 5. Assertions in this suite

```ts
expect(status).toBe(201);                              // API response
expect(body).toMatchObject({ page: 1, totalCount: 27 }); // partial match (don't assert the whole envelope)
expect(body.items?.length).toBe(25);
expect(new Set(ids).size).toBe(27);                    // paging neither duplicates nor skips
expect(created.status, 'the fixture create must succeed').toBe(201);  // message attached to assertion
expect(response.status(), 'sign-in as X must succeed').toBe(200);    // receiver message
```

- `toMatchObject` is used for the paged envelope: it asserts the subset the test cares about
  without coupling it to fields that are intentionally asserted elsewhere.
- DOM assertions: `expect(page.getByRole('heading', { name: 'Sign in to LogiFlow' })).toBeVisible()`
  — aria role + accessible name, never CSS selectors or brittle class names.
- Strings carry the message when the assertion needs it: `expect(x, 'message').toBe(y)`.

## 6. What the 25 spec files cover (by ticket)

| Ticket | Spec files |
|---|---|
| LOGI-0001 | warehouses.spec.ts (CRUD incl. pagination, search, 404, role-authored deletes) |
| LOGI-0002 | (see ProjectTechGuidence 06-testing-strategy-playwright.md) — pattern conventions |
| LOGI-0003 | auth.spec.ts, plus authz cases in every feature file (anonymous 401, role matrix) |
| LOGI-0004 | vehicles.spec.ts |
| LOGI-0005 | drivers.spec.ts |
| LOGI-0006 | shipment-status-lifecycle.spec.ts |
| LOGI-0007 | shipments-list.spec.ts |
| LOGI-0008 | shipment-edit.spec.ts, shipment-cancel.spec.ts, shipment-ui.spec.ts |
| LOGI-0009 | routes-create.spec.ts, routes-list.spec.ts, routes-ui.spec.ts |
| LOGI-0010 | route-shipments.spec.ts, route-shipments-ui.spec.ts, route-shipments-authz.spec.ts |
| LOGI-0011 | planning-board.spec.ts, planning-board-ui.spec.ts, planning-board-authz.spec.ts |
| LOGI-0012 | dashboard.spec.ts, dashboard-ui.spec.ts (4 dashboard specs incl. authz + drilldowns) |
| (support) | capture-design-parity.mjs (design-parity screenshots) |

UI-only specs target the real browser surface (dialogs, confirmations, form flows) and API-only
specs exercise the contract end to end; the two agree because they read the same API + same DB.

