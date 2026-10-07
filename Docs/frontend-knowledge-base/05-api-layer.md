# 05 — The API Layer (`src/api/`)

Three files, one job: **all HTTP and all API typing flows through here**. No component ever calls
`fetch` directly.

## 1. File map

| File | Role |
|---|---|
| `schema.d.ts` | ⚠ **Generated** types from `contracts/v1-openapi.yaml` (`npm run generate:api`). Never hand-edit. |
| `client.ts` | Type aliases over the schema, `ApiError`, `request()` pipeline, the `api` endpoint object |
| `tokenStore.ts` | localStorage/in-memory token persistence (doc 04 §3) |

## 2. Contract-first typing

`client.ts` line 1: `import type { components, operations } from './schema';` then re-exports
short aliases so feature code never touches the raw schema paths:

```ts
export type Warehouse     = components['schemas']['WarehouseResponse'];
export type WarehouseInput = components['schemas']['WarehouseRequest'];
export type Shipment      = components['schemas']['ShipmentResponse'];
export type ListShipmentsParams =
  NonNullable<operations['listShipments']['parameters']['query']>;
export type Role = AuthUser['role'];           // 'Admin' | 'Dispatcher' | 'Driver' | 'Viewer'
```

Also defined here:

- `Paged<T>` — the standard list envelope
  (`{ items, page, pageSize, totalCount, totalPages }`).
- `ApiError` — a typed `Error` carrying the API's RFC 7807 `ProblemDetails`:

  ```ts
  class ApiError extends Error {
    readonly status: number;                  // 400 / 403 / 404 / 409 ...
    readonly problem: Partial<ProblemDetails>;
    get fieldErrors(): Record<string, string[]> { ... }   // 400 body → form-field mapping
  }
  ```

## 3. The request pipeline

```text
api.listWarehouses(...)              ← feature code calls only these
  └─ request<T>(path, init, retryOn401=true)
       ├─ send():  fetch(path, {headers: {'Content-Type': 'application/json',
       │                              Authorization?: `Bearer ${tokenStore.accessToken}`}})
       ├─ 401 && retryable && !authPath? → single-flight refresh → retry ONCE → else sessionExpired
       ├─ !ok   → throw await toApiError(response)     // JSON body parsed into ProblemDetails
       ├─ 204   → return undefined as T
       └─ ok    → (await response.json()) as T         // ⚠ cast, not validated — types are
                                                       //   trusted because the server implements
                                                       //   the same contract
```

Design rules:

- **Relative paths only** (`/api/v1/...`) — the Vite dev proxy, `vite preview`, MSW and production
  nginx all resolve them differently; the code doesn't care (ADR-004).
- Query params are serialized **only when supplied** (`if (params.status) query.set(...)`) so
  omitted params keep the server's contract defaults rather than being overridden by empties.
- `retryOn401=false` on the recursive call guarantees at most one refresh per request (no
  infinite loop).

## 4. The `api` object — one method per endpoint

```ts
export const api = {
  listWarehouses(page = 1, pageSize = 25, q?: string): Promise<Paged<Warehouse>> { ... },
  createWarehouse(body: WarehouseInput): Promise<Warehouse> { ... },
  login(body: LoginInput): Promise<TokenResponse> { ... },
  me(): Promise<AuthUser> { ... },
  getDashboard(params: GetDashboardParams = {}): Promise<DashboardResponse> { ... },
  // ...warehouses, vehicles, drivers, shipments (+status transitions/history),
  //     routes (+assign/unassign), planning-board, dashboard, auth
};
```

Endpoint inventory by resource:

| Resource | Methods |
|---|---|
| auth | `login`, `me`, `logout` (refresh is internal to `request`) |
| warehouses | `listWarehouses`, `getWarehouse`, `createWarehouse`, `updateWarehouse`, `deleteWarehouse` |
| vehicles | `listVehicles`, `getVehicle`, `createVehicle`, `updateVehicle`, `deleteVehicle` |
| drivers | `listDrivers`, `getDriver`, `createDriver`, `updateDriver`, `deleteDriver` |
| shipments | `listShipments`, `getShipment`, `createShipment`, `updateShipment` (PATCH), `transitionShipmentStatus`, `listShipmentStatusHistory` |
| routes | `listRoutes`, `getRoute`, `createRoute`, `updateRoute` (PATCH), `listRouteShipments`, `assignShipmentToRoute`, `removeShipmentFromRoute` |
| reads | `getPlanningBoard`, `getDashboard` |

Conventions: verbs mirror HTTP (`create`→POST 201, `update`→PUT/PATCH, `delete`→DELETE 204);
PATCH is used where the contract says partial (shipments, routes), PUT where full
(vehicles, drivers, warehouses).

## 5. How feature code consumes it

Feature code **never** imports `fetch` — only hooks do, and only inside `queryFn`/`mutationFn`:

```ts
// src/features/warehouses/hooks.ts
queryFn: () => api.listWarehouses(page, pageSize, q || undefined),
mutationFn: (input: WarehouseInput) => api.createWarehouse(input),
```

Error handling at call sites:

```ts
try {
  await createMutation.mutateAsync(input);
} catch (error) {
  if (error instanceof ApiError) {
    // 400 → error.fieldErrors → RHF setError(field, {type:'server', message})
    // 409 → error.problem.detail → snackbar + refetch (state changed elsewhere)
  }
}
```

The 409 pattern (`conflictMessage` in `ShipmentsPage.tsx`) shows the server's `detail` and
refetches so the table reflects reality instead of a stale affordance.

## 6. Regenerating after a contract change

```bash
cd src/frontend
npm run generate:api     # contracts/v1-openapi.yaml → src/api/schema.d.ts
npm run build            # tsc surfaces every affected call site
```

Types are only compile-time; the MSW handlers (`mocks/handlers.ts`) must be updated in step with
the contract or tests will diverge from production behavior.
