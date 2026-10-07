# 02 — React Primer for This Codebase

You do not need to know all of React to read LogiFlow — you need the concepts below. Every example
is taken from (or mirrors) real code in this repository, so reading this alongside the source works
well.

## 1. Components: functions that return JSX

A React component is a function that takes props and returns a description of UI (JSX). React calls
it for you and re-calls it whenever state/props/context change.

```tsx
// src/features/auth/AuthGate.tsx
export default function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <CircularProgress aria-label="Restoring session" />;
  return status === 'authenticated' ? <>{children}</> : <LoginPage />;
}
```

Conventions in this repo:

- **Function components only** — no class components.
- Files are `Something.tsx` (JSX) or `Something.ts` (no JSX).
- `export default function` is the norm for pages/components; helpers are named exports.
- Props are declared inline as a TypeScript type on the destructured parameter
  (`{ children }: { children: ReactNode }`) or via an `interface XxxProps` (see
  `WarehouseFormDialog.tsx`).

## 2. Props: input from the parent

Props are read-only inputs. Data flows **down**, events flow **up** (callbacks as props):

```tsx
// src/features/warehouses/WarehousesPage.tsx — parent owns state, dialog receives data + callbacks
<WarehouseFormDialog
  open={formOpen}                          // data
  warehouse={editing}                      // data (null = create mode)
  onClose={() => setFormOpen(false)}       // event up
  onSubmit={handleFormSubmit}              // event up
/>
```

`children` is a special prop — whatever you nest between the tags. Used by `AuthGate` so the shell
can pass the whole chrome through it.

## 3. State: `useState` — the thing that triggers re-render

```tsx
// src/features/warehouses/WarehousesPage.tsx
const [page, setPage] = useState(0);                    // state + setter
const [formOpen, setFormOpen] = useState(false);
```

- Calling the setter schedules a re-render; the component function runs again with the new value.
- **Never mutate state directly** — always `setX(newValue)` (arrays: spread/copy first).
- State is *local to the component that declares it*. When a child needs it, the parent passes it
  down as a prop (that is why dialogs live next to the page that owns `formOpen`/`editing`).
- Initial value can be a lazy initializer that runs once:
  `const [initial] = useState(initialShipmentFilters);` — the function is passed *by reference*,
  so it runs only on the first render (see `ShipmentsPage.tsx`).

### Derived state: compute during render, don't duplicate

```tsx
// src/features/shipments/ShipmentsPage.tsx
const params = shipmentsParamsFromFilters({ status, priority, ... }, page + 1, rowsPerPage);
```

Filter state is kept as separate `useState`s and *projected* into API params on every render —
there is no second `params` state to keep in sync.

## 4. Effects: `useEffect` — synchronize with the outside world

An effect runs **after** render when its dependency array changes (empty array `[]` = on mount
only):

```tsx
// src/features/auth/AuthContext.tsx (mount-only session restore)
useEffect(() => {
  if (status !== 'loading') return;
  let cancelled = false;
  api.me().then((identity) => { if (!cancelled) { setUser(identity); setStatus('authenticated'); } })
          .catch(() => { if (!cancelled) clearSession(); });
  return () => { cancelled = true; };   // cleanup: ignore results after unmount
}, []);                                  // [] = run once on mount
```

Rules of thumb visible in this codebase:

- **Return a cleanup function** when the effect subscribes (events, timers) or starts async work —
  see the `popstate` subscription in `appNavigation.ts` and the session-expiry handler registration
  in `AuthContext.tsx`.
- **Deps array lists everything the effect reads.** The one intentional omission in the codebase
  carries an `eslint-disable-next-line react-hooks/exhaustive-deps` comment explaining why
  (`AuthContext.tsx`).
- Effects are *not* for rendering — anything derivable from state is computed in render (or
  `useMemo`), not in an effect.

## 5. Context: sharing data without prop-drilling — `useContext`

A *context* is a named value available to any descendant without passing it through every level.
Pattern used here (provider + custom hook), from `AuthContext.tsx`:

```tsx
const AuthContext = createContext<AuthContextValue | null>(null);   // 1. create

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(() => ({ status, user, login, logout }), [...]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;  // 2. provide
}

export function useAuth(): AuthContextValue {   // 3. consume via a safe wrapper
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
```

Consumers: `const { user } = useAuth();` anywhere under the provider (`App.tsx`, every page for
role gating). The provider must sit **above** every component that calls the hook — see the nesting
order in `App.tsx`:

```tsx
<QueryClientProvider> → <ThemeProvider> → <AuthProvider> → <AuthGate> → {header + tabs}
```

## 6. `useMemo` / `useCallback` (seen in this repo)

- `useMemo(() => value, [deps])` — memoize a computed value so it only changes when deps change:

  ```tsx
  // src/features/warehouses/WarehousesPage.tsx — id→name lookup map rebuilt only when data changes
  const warehouseName = useMemo(() => {
    const map = new Map<number, string>();
    for (const w of warehouses.data?.items ?? []) map.set(w.id, w.name);
    return (id: number) => map.get(id) ?? `warehouse #${id}`;
  }, [warehouses.data?.items]);
  ```

- `useCallback(fn, [deps])` — memoize the function identity (used when passing callbacks that
  appear in dep arrays, e.g. `navigate` in `appNavigation.ts`, `clearSession` in `AuthContext.tsx`).

## 7. Lists and keys

When rendering an array, each element needs a stable `key`:

```tsx
{data.items.map((warehouse) => (
  <TableRow key={warehouse.id} data-testid={`warehouse-row-${warehouse.id}`}>
```

Use a domain id, never the array index.

## 8. Conditional rendering

JSX is just expressions, so you use ordinary JS:

```tsx
{canViewDrivers && <Tab value="drivers" label="Drivers" />}      // render-or-false
{isPending ? <LinearProgress /> : <Table>...</Table>}            // ternary
{error != null && <Alert severity="error">{error}</Alert>}       // null-safe
```

Note `!= null` (loose) is used deliberately: it covers both `null` and `undefined`.

## 9. Controlled components & uncontrolled inputs

- Most form inputs are wired through **react-hook-form**: `{...register('name')}` binds the input
  to RHF's internal state; the component does not hold per-field state.
- Filter selects/tables use **controlled components**: MUI `Select` gets `value` + `onChange` bound
  to a `useState` (see `ShipmentsPage.tsx`, `DashboardPage.tsx`).
- Two-state text search pattern (draft vs applied) appears on every list page:

  ```tsx
  const [searchText, setSearchText] = useState('');  // what you type
  const [q, setQ] = useState('');                    // what the query actually uses (on Enter)
  ```

## 10. Events

React uses camelCase synthetic events (`onChange`, `onClick`) and `event.preventDefault()` for
form submits:

```tsx
const search = (event: React.FormEvent) => {
  event.preventDefault();   // stop the browser's native form submit (full page reload)
  setQ(searchText.trim());
  setPage(0);
};
```

## 11. The mental model: render → compare → commit

1. State/props/context change → React re-runs the component function.
2. It diffs the new JSX against the previous render.
3. Only the changed DOM nodes are updated.

Consequences you will feel in this codebase:

- Async results must land in **state** (or React Query's cache) to appear on screen; a local
  variable holding data disappears on re-render.
- Derive, don't sync: duplicate state (`const [x, setX] = useState(y)`) goes stale — that is why
  filters are projected into params during render.
- Re-render ≠ network request. React Query's cache (doc 06) decides refetching.

## 12. Custom hooks

Any function whose name starts with `use` and that may call other hooks is a **custom hook**. That
is the primary reuse mechanism here:

```ts
// src/features/warehouses/hooks.ts
export function useWarehouses(page: number, pageSize: number, q: string) {
  return useQuery({
    queryKey: warehouseKeys.list(page, pageSize, q),
    queryFn: () => api.listWarehouses(page, pageSize, q || undefined),
  });
}
```

Pages stay declarative (`const { data, isPending } = useWarehouses(...)`), while the fetch/caching
plumbing lives in `hooks.ts`.

## 13. JSX gotchas that bite newcomers (all present in this repo)

- HTML attributes are camelCase (`htmlFor`, `tabIndex`, `className` — though MUI mostly uses the
  `sx` prop for styling).
- A component's props are a **single object** — `onClick={handler}`, not `onClick="handler()"`.
- `{}` embeds JS; JSX itself is an expression (can be assigned, returned from ternaries).
- Fragments `<>...</>` group siblings without a DOM node (AuthGate's return).
- MUI gotcha documented in `App.tsx`: **`<Tab>` must remain a direct child of `<Tabs>`** — MUI
  injects selection props via `cloneElement`, so wrapping a Tab silently breaks tab switching.
- `data-testid` attributes appear everywhere: they are the stable hooks for tests (doc 09).

