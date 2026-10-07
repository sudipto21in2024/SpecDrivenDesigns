# 10 — End-to-End Code Flows & Cheat Sheet

Traced walkthroughs that tie every document together. Each trace lists the exact files in order —
read them top to bottom with this as your map.

## 1. Cold start → login screen → authenticated shell

```text
index.html → src/main.tsx
  ├─ (optional) MSW worker if VITE_ENABLE_MOCKS=1
  └─ render <App/>  (StrictMode)
App.tsx provider stack → AuthProvider → AuthGate
AuthContext.tsx:
  status = tokenStore.get() ? 'loading' : 'anonymous'
  effect: setSessionExpiredHandler(clearSession)          ← client.ts 401 hook
  effect: status==='loading' → api.me()                   ← GET /auth/me
AuthGate.tsx:
  loading → spinner ; anonymous → LoginPage.tsx ; authenticated → AppHeader + MasterDataTabs
LoginPage submit → AuthContext.login → api.login POST /auth/login
  → tokenStore.set (BEFORE state flip) → setUser → 'authenticated' → chrome mounts
MasterDataTabs (App.tsx): default tab 'warehouses' → <WarehousesPage/>
```

Key files: `main.tsx`, `App.tsx`, `features/auth/{AuthContext,AuthGate,LoginPage}.tsx`,
`api/{client,tokenStore}.ts`.

## 2. Load a list (Warehouses)

```text
WarehousesPage.tsx  useState: page/rowsPerPage/searchText/q, dialogs, snackbar
  → useWarehouses(page+1, rowsPerPage, q)               hooks.ts
      queryKey ['warehouses','list',{page,pageSize,q}]  → React Query cache lookup
      queryFn  → api.listWarehouses                     client.ts
                    → request() → fetch + Bearer token → Vite proxy → ASP.NET API
  → isPending ? LinearProgress : Table rows from data.items
  → TablePagination (0-based) drives page/rowsPerPage → new key → refetch
  → search form submit: setQ(searchText), setPage(0) → new key → refetch
```

## 3. Create a warehouse (full write path)

```text
click "New Warehouse" → setFormOpen(true), editing=null
WarehouseFormDialog opens → useEffect resets form
user types → RHF state; submit → zodResolver validates
click Create → handleSubmit → valid?
  ├─ invalid → errors.* → TextField helperText (no request sent)
  └─ valid → onSubmit(toWarehouseInput(values))
       → WarehousesPage.handleFormSubmit
           → createMutation.mutateAsync(input)          hooks.ts useCreateWarehouse
               → api.createWarehouse POST /api/v1/warehouses
                   ├─ 201 → onSuccess → invalidate(['warehouses'])
                   │           → useWarehouses refetches → new row renders
                   │     → dialog onClose() → snackbar "Warehouse created"
                   └─ 400/403/… → ApiError thrown
                           → dialog catch → fieldErrors→setError / Alert (dialog stays open)
```

Delete differs slightly: confirmation `Dialog` in the page → `deleteMutation` → snackbar;
failure → error snackbar (no throw escapes).

## 4. Dashboard drill-down → filtered shipments (navigation path)

```text
DashboardPage: ONE getDashboard read → tiles + at-risk table + utilization panels
click tile → onNavigate(shipmentListHref('Pending', filters))     schema.ts builds href
  → App passes navigate from useTabNavigation                     App.tsx
  → navigateTo: tabForHref('/shipments?...') = 'shipments'
       pushState(URL) FIRST, then setTab('shipments')              appNavigation.ts
  → MasterDataTabs mounts <ShipmentsPage/>
  → useState(initialShipmentFilters) reads window.location.search ONCE
       shipmentsFiltersFromSearch: validates enums/ids, drops junk  shipmentsFilterParams.ts
  → useShipments(params) → GET /api/v1/shipments?status=Pending…   (one filtered read)
browser Back → popstate → tabForLocation → setTab('dashboard')
```

## 5. Assign a shipment to a route (cross-feature invalidation)

```text
RoutesPage → open RouteShipmentsPanel → useRouteShipments(id, params, open)
  (enabled: fires only when panel open; placeholderData keeps table steady while paging)
click Assign → api.assignShipmentToRoute POST /routes/{id}/shipments
  ├─ 409 (capacity BR-5 / invalid state) → ApiError.problem.detail → snackbar + refetch
  └─ 200 → onSuccess → invalidate BOTH ['routes'] and ['shipments']
           → route list/capacity + shipment row (routeId, status Assigned) refresh together
Unassign: DELETE …/shipments/{shipmentId} → same dual invalidation (204 → void)
```

Key file: `features/routes/hooks.ts` (`useInvalidateRouteShipments`).

## 6. Session expiry mid-session

```text
any api call → request() → 401
  → ensureRefreshed() single-flight POST /auth/refresh
      ├─ ok → new tokens stored → original request retried ONCE → user never notices
      └─ fail → tokenStore.clear() → onSessionExpired() = AuthContext.clearSession
                 → status 'anonymous' → AuthGate swaps chrome for LoginPage
                                        (all feature components unmount; caches become moot)
```

## 7. Role matrix at a glance

| Capability (examples) | Admin | Dispatcher | Driver | Viewer |
|---|---|---|---|---|
| view master data (warehouses/vehicles) | ✅ | ✅ | ✅ | ✅ |
| edit master data | ✅ | ✅ | ❌ | ❌ |
| delete (anything) | ✅ | ❌ | ❌ | ❌ |
| view drivers | ✅ | ✅ | ❌ | ✅ |
| view shipments | ✅ | ✅ | ❌ | ✅ |
| view routes / route shipments | ✅ | ✅ | ✅ | ✅ |
| create/edit shipments, cancel | ✅ | ✅ | ❌ (cancel) | ❌ |
| transition status (non-cancel) | ✅ | ✅ | ✅ | ❌ |
| planning board / dashboard | ✅ | ✅ | ❌ | ✅ |

Source of truth: `features/auth/permissions.ts` (mirrors contract `x-roles`); enforcement is
server-side — hiding UI is affordance hygiene.

## 8. Cheat sheet: "Where do I change X?"

| I want to… | Touch |
|---|---|
| add/change an API endpoint | `contracts/v1-openapi.yaml` → `npm run generate:api` → `api/client.ts` → `mocks/handlers.ts` |
| change list columns/filters | `features/<f>/<F>Page.tsx` (+ `schema.ts` for options/helpers) |
| change validation rules | `features/<f>/schema.ts` (and backend validator to match) |
| add a tab/section | `appNavigation.ts` (`TabKey`, `TAB_KEYS`) + `App.tsx` (`<Tab>` + conditional) |
| change who sees a button/tab | `features/auth/permissions.ts` (then the API `x-roles`) |
| fix caching/staleness | feature `hooks.ts` (query keys, `invalidateQueries`, `enabled`, `placeholderData`) |
| change drill-down links | the href builder in the *source* feature (`dashboard/schema.ts`) + consumer's URL parsing |
| add a form field | `schema.ts` (Zod + mapper) → dialog `register(...)` → server contract |
| mock a new endpoint in tests/dev | `mocks/handlers.ts` (+ seed/reset helpers) |
| restyle globally | `theme.ts` (MUI palette/typography/component defaults) |
| understand a flow | this document → then the files it lists |

## 9. Suggested reading path for a React newcomer

1. Docs 01–02 (stack + React primer) — then read `main.tsx`, `theme.ts`, `components/icons.tsx`.
2. Doc 03 + `App.tsx` — understand providers and the tab shell.
3. Doc 04 + `features/auth/*` — state machine of sessions.
4. Doc 05 + `api/client.ts` — how a request travels.
5. Doc 06 + `features/warehouses/*` — the canonical CRUD slice (read all four files + test).
6. Docs 07/08 — navigation and forms, using shipments/dashboard as examples.
7. Doc 09 — run `npm test` and open one spec alongside its page.
8. Doc 10 traces — follow two traces in the debugger (VS Code attach to Chrome via Vite) to see
   the renders and requests for real.


