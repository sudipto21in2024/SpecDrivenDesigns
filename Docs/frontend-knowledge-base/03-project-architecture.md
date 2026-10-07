# 03 — Project Architecture

How the frontend is laid out, what the App shell composes, and the anatomy of a feature.

## 1. Folder layout (`src/frontend/src/`)

```text
src/
├── main.tsx            # bootstrap: optional MSW → createRoot(<App/>) into div#root
├── App.tsx             # provider stack + header + tab shell (the "router")
├── appNavigation.ts    # tab↔URL grammar: TabKey, tabForHref, navigateTo, useTabNavigation
├── theme.ts            # MUI createTheme (palette, typography, default button variant)
├── index.css           # global styles imported by main.tsx
│
├── api/                # everything that talks to the backend
│   ├── schema.d.ts     # ⚠ GENERATED from contracts/v1-openapi.yaml (npm run generate:api)
│   ├── client.ts       # typed fetch wrapper: request(), ApiError, api.* endpoint methods
│   └── tokenStore.ts   # localStorage-backed access/refresh token persistence
│
├── components/         # shared presentational bits
│   └── icons.tsx       # SVG icon components (EditIcon, DeleteIcon, SearchIcon, ...)
│
├── features/           # ⭐ one folder per business feature (feature-first organization)
│   ├── auth/           # AuthContext, AuthGate, LoginPage, permissions
│   ├── warehouses/     # Page + hooks + schema + FormDialog (+ test)
│   ├── vehicles/
│   ├── drivers/
│   ├── shipments/      # + filter URL parsing, edit/cancel dialogs
│   ├── routes/         # + RouteShipmentsPanel (assign/unassign)
│   ├── planning/       # read-only kanban board + BoardCard
│   └── dashboard/      # read-only ops dashboard + StatusTile
│
├── mocks/              # MSW in-memory API
│   ├── handlers.ts     # 2200+ lines: endpoints, seed data, role rules, resets
│   └── browser.ts      # setupWorker for browser mock mode
│
└── test/               # test infrastructure
    ├── setup.ts        # jest-dom matchers + MSW server for Vitest
    └── renderApp.tsx   # renderAppAs(role) / renderAnonymousApp / resetMocks
```

### Feature-first, not layer-first

Code is grouped by **business feature** first, by technical layer second. A vertical slice for
"warehouses" lives entirely in `features/warehouses/`:

| File | Layer | Responsibility |
|---|---|---|
| `WarehousesPage.tsx` | View | page: table, filters, dialogs orchestration, snackbars |
| `WarehouseFormDialog.tsx` | View | create/edit dialog with RHF + Zod form |
| `hooks.ts` | Data | React Query `useQuery`/`useMutation` hooks + query keys |
| `schema.ts` | Validation/View-model | Zod form schema, option lists, pure helpers |
| `WarehousesPage.test.tsx` | Test | co-located integration test |

Cross-cutting concerns live at the root: `api/` (all HTTP), `auth/` (session + permissions),
`components/` (shared UI), `mocks/` (fake API), `test/` (harness).

## 2. The App shell (`src/App.tsx`)

`App.tsx` is intentionally thin — a **158-line size ratchet** is enforced (mentioned in
`appNavigation.ts` comments), so anything non-trivial is extracted. Its provider stack, outermost
first:

```tsx
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>   {/* React Query cache access */}
      <ThemeProvider theme={theme}>              {/* MUI theme */}
        <CssBaseline />                          {/* MUI CSS reset */}
        <AuthProvider>                           {/* session state + login/logout */}
          <AuthGate>                             {/* login screen vs. app chrome */}
            <AppHeader />                        {/* role chip, user menu, sign out */}
            <MasterDataTabs />                   {/* tab strip + current page */}
          </AuthGate>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

**Why this order:** `AuthProvider` must wrap `AuthGate` (the gate reads the session); the gate must
wrap the chrome (nothing feature-related mounts while anonymous). `QueryClientProvider` is outermost
so auth code can also use queries if needed; `ThemeProvider` wraps everything that renders MUI.

The module-level `queryClient` is created once with defaults:
`{ queries: { retry: 1, refetchOnWindowFocus: false } }`.

### `AppHeader`

Renders only when `user != null`: title, a role `Chip` (`data-testid="current-role"`), the user's
name (`current-user`), and an account `Menu` with Sign out (`sign-out`). Role is displayed because
it explains what the UI does and does not offer.

### `MasterDataTabs` — the "router"

```tsx
const [tab, setTab] = useState<TabKey>('warehouses');   // ← the entire routing state
...
<Tabs value={tab} onChange={(_, next) => selectTab(next)}>
  <Tab value="warehouses" ... /> <Tab value="vehicles" ... />
  {canViewDrivers && <Tab value="drivers" ... />}        // role-gated tabs
  {canViewShipments && <Tab value="shipments" ... />}
  {canViewRoutes && <Tab value="routes" ... />}
  {canViewBoard && <Tab value="board" ... />}
  {canViewDashboard && <Tab value="dashboard" ... />}
</Tabs>
{tab === 'dashboard' && canViewDashboard ? <DashboardPage onNavigate={navigate} />
 : tab === 'board'    && canViewBoard    ? <PlanningBoardPage />
 : tab === 'warehouses'                  ? <WarehousesPage />
 : tab === 'vehicles'                    ? <VehiclesPage />
 : tab === 'shipments' && canViewShipments ? <ShipmentsPage />
 : tab === 'routes'    && canViewRoutes    ? <RoutesPage />
 : <DriversPage />}
```

Key points:

- **There is no react-router.** One `useState<TabKey>` picks the page; conditional rendering mounts
  exactly one page at a time (unmounted pages hold no state — leaving a tab resets that page).
- Tabs are **role-gated** with `can(role, capability)` (permissions are UX-only; the API 403s
  regardless). The Driver role never sees Drivers/Shipments/Board/Dashboard tabs.
- `selectTab`/`navigate` come from `useTabNavigation` (doc 07) to keep URL and tab in sync.
- Default tab is `warehouses` (the surface every pre-existing test suite renders).

## 3. Shared components (`src/components/`)

`icons.tsx` defines small SVG icon components (`EditIcon`, `DeleteIcon`, `SearchIcon`,
`AccountIcon`, `LogoutIcon`, ...) so icon markup is not repeated. Pages import them:

```tsx
import { DeleteIcon, EditIcon, SearchIcon } from '../../components/icons';
```

## 4. Where a new feature goes (checklist)

1. `src/features/<name>/schema.ts` — Zod form schema, option constants, pure view-model helpers.
2. `src/features/<name>/hooks.ts` — query keys + `useQuery`/`useMutation` wrappers around `api`.
3. `src/features/<name>/<Name>Page.tsx` — table/list + dialogs + snackbar.
4. `src/features/<name>/<Name>FormDialog.tsx` — RHF + Zod dialog.
5. Add endpoint methods + types in `src/api/client.ts` (types come from `schema.d.ts`).
6. Add MSW handlers in `src/mocks/handlers.ts`.
7. Add a `TabKey` + `<Tab>` + conditional render in `App.tsx`/`appNavigation.ts` if it's a section.
8. Add a capability in `src/features/auth/permissions.ts` (mirroring contract `x-roles`).
9. Co-locate `<Name>Page.test.tsx` using `renderAppAs`.

## 5. Design invariants worth respecting

- **`App.tsx` stays small** — put logic in named, testable modules (that's why `appNavigation.ts`
  exists).
- **Server is the authority**: hidden buttons (`can(...)`) are affordance hygiene, never security.
- **Read models are single reads**: Board and Dashboard each issue exactly one request per state;
  no client-side recomputation of server-owned numbers.
- **Contract-first**: never invent an endpoint or DTO not present in `schema.d.ts`.
- **Co-located tests** with `data-testid` hooks instead of CSS-selector coupling.

