# 06 — Data Fetching: TanStack React Query

React Query owns all **server state**: caching, deduping, refetching, and cache invalidation.
Understanding it is 80% of understanding the data flow in this app.

## 1. The setup

```tsx
// App.tsx (module scope)
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
// ...
<QueryClientProvider client={queryClient}> ... </QueryClientProvider>
```

- `retry: 1` — one automatic retry on failure (no hammering the API).
- `refetchOnWindowFocus: false` — switching windows doesn't trigger a refetch storm.
- Every component under the provider can call `useQuery`/`useMutation`/`useQueryClient`.

## 2. The core idea: queryKey = cache address

```ts
// src/features/warehouses/hooks.ts
export const warehouseKeys = {
  all: ['warehouses'] as const,
  list: (page, pageSize, q) => ['warehouses', 'list', { page, pageSize, q }] as const,
};

export function useWarehouses(page: number, pageSize: number, q: string) {
  return useQuery({
    queryKey: warehouseKeys.list(page, pageSize, q),   // ← WHAT to cache
    queryFn: () => api.listWarehouses(page, pageSize, q || undefined),  // ← HOW to fetch
  });
}
```

- The **key is structural**: change any argument → different key → different cache entry →
  React Query fetches; return to a previous key → instant cache hit (no request).
- Keys are **hierarchical arrays**: `['warehouses', 'list', {...}]` nests under `['warehouses']`.
  `invalidateQueries({ queryKey: warehouseKeys.all })` matches *every* warehouses query at once.
- Keys are shared constants (`warehouseKeys`, `shipmentKeys`, `routeKeys`, `dashboardKeys`,
  `planningBoardKeys`) exported from each feature's `hooks.ts`.

## 3. Reading: what a `useQuery` returns

```tsx
const { data, isPending, isError, error, refetch } = useWarehouses(page + 1, rowsPerPage, q);
```

- `data` — `Paged<Warehouse> | undefined` (undefined until first success).
- `isPending` — first load in flight → pages render `<LinearProgress>` instead of the table.
- `isError` / `error` — failed → pages render an `<Alert>` + retry (`refetch`).
- Render pattern used on every page:

  ```tsx
  {isPending ? <LinearProgress /> : isError ? <Alert.../> : <Table>...data.items.map...</Table>}
  ```

### Options used in this codebase

| Option | Where | Why |
|---|---|---|
| `enabled` | `useShipment(id, open)`, `useRoute`, `useRouteShipments` | fetch only when a dialog/panel actually opens → list pages issue no per-row reads |
| `placeholderData: (previous) => previous` | dashboard, planning board, routes, route-shipments | keep previous data on screen while a new filter/page loads — avoids "empty = cleared" flicker |

## 4. Writing: mutations + invalidation

```ts
// src/features/warehouses/hooks.ts
function useInvalidateWarehouses() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
}

export function useCreateWarehouse() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({
    mutationFn: (input: WarehouseInput) => api.createWarehouse(input),
    onSuccess: () => invalidate(),     // mark caches stale → active queries refetch
  });
}
```

Lifecycle on the page:

```text
dialog submit → mutateAsync(input)
  ├─ pending  → button disabled (isSubmitting / mutation.isPending)
  ├─ success  → onSuccess: invalidate(['warehouses']) → useWarehouses refetches →
  │             new row appears → dialog closes → snackbar "Warehouse created"
  └─ failure  → mutateAsync THROWS (ApiError) → caught in the dialog → field errors / Alert
               (no invalidation on failure — server state didn't change)
```

**`mutateAsync` vs `mutate`:** pages use `mutateAsync` + `await` so they can sequence UI updates
(close dialog, show snackbar) and catch errors; the hook's `onSuccess` still runs.

### Cross-feature invalidation

One action can change two read models — then **both** trees are invalidated:

```ts
// src/features/routes/hooks.ts — assigning a shipment changes route capacity AND the shipment
function useInvalidateRouteShipments() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: routeKeys.all });
    void queryClient.invalidateQueries({ queryKey: shipmentKeys.all });
  };
}
```

Rule of thumb in this repo: invalidate the **smallest tree that contains every stale read**
(prefix match), not the whole cache.

## 5. Deliberately read-only features

`dashboard/hooks.ts` and `planning/hooks.ts` export **only** `useQuery` — there are no mutation
hooks:

- The planning board is read-only in v1: a drag would be a second BR-7 (status transition)
  entry point and a drop-on-route a second BR-5 (capacity) one; both live on their own surfaces.
- The dashboard shows projections computed server-side at one captured instant (`generatedAt`);
  persisting a count would violate the "single source of truth" rule (BR-2).
- Their drill-downs hand off to the shipments list instead of mutating anything (doc 07).

## 6. Common patterns & gotchas

- **Params drive the key.** `useShipments(params)` builds the key from the full param object, so
  every filter/page/sort combination is its own cached read (`shipmentKeys.list(params)`).
- **Don't duplicate server state in `useState`.** Filters are *state*; the rows are *cache*. The
  projection happens during render (doc 02 §3).
- **Page-size mismatch:** MUI `TablePagination` is 0-based; the API is 1-based — every page does
  `page + 1` when calling the hook (`useWarehouses(page + 1, ...)`).
- **Invalidate ≠ refetch-all:** only matching keys refetch; other features' caches stay warm.
- **Mutations are not auto-retried** — a failed write surfaces immediately to the user.
- Testing implication: `renderAppAs` renders a fresh `<App/>` and `resetMocks()` clears the mock
  DBs and token store before each test, so each test starts from a clean, deterministic state.

