# 07 — Navigation & URL State (no react-router)

LogiFlow has **no router library**. Navigation = one `useState<TabKey>` in the shell + a tiny
module (`src/appNavigation.ts`) that keeps the address bar in step. This document explains why and
how.

## 1. Why there is no router

- The app is a **single-page tab shell**: seven top-level sections, no nested routes, no URL
  parameters beyond query strings on two drill-downs.
- A full page load would re-run the whole auth bootstrap for what is often a read-only drill-down.
- The tab shell is a state machine; `history.pushState` gives Back/Forward support without
  paying for a router.

Trade-off accepted: **the URL is written but not read on cold boot** — reloading `/shipments?...`
lands on the default Warehouses tab. The URL exists for drill-downs, sharing, and Back/Forward
during the session (documented deliberately in the code comments).

## 2. The vocabulary: `TabKey`

```ts
// src/appNavigation.ts
export type TabKey = 'warehouses' | 'vehicles' | 'drivers' | 'shipments' | 'routes' | 'board' | 'dashboard';
export const TAB_KEYS: readonly TabKey[] = ['warehouses', 'vehicles', 'drivers', 'shipments', 'routes', 'board', 'dashboard'];
```

Tab values **are** the URL path segments: `/shipments`, `/board`, `/routes`. One word, two uses —
which is why the segment check needs no lookup table.

## 3. Parsing an href: `tabForHref`

```ts
export function tabForHref(href: string): TabKey | null {
  const [pathname] = href.split('?');                       // cut the query FIRST (load-bearing!)
  const segment = pathname.replace(/^\/+/, '').split('/')[0];
  return (TAB_KEYS as readonly string[]).includes(segment) ? (segment as TabKey) : null;
}
```

The comment in the source is worth reading: the query split is not defensive — `href` is a full
href, so without it `shipments?status=Pending` would never match, producing a **silent no-op**
drill-down (the original bug this function exists to prevent). Unknown hrefs return `null`.

## 4. Moving: `navigateTo(href, setTab, history)`

```ts
export function navigateTo(href, setTab, history = window.history): TabKey | null {
  const target = tabForHref(href);
  if (target == null) return null;        // unknown href → do nothing (never land elsewhere)
  history.pushState(null, '', href);      // 1) URL FIRST …
  setTab(target);                         // 2) … then switch tab
  return target;
}
```

**Order is the contract.** `ShipmentsPage` hydrates its filters from `window.location.search`
inside a lazy `useState` initializer *during* the mount triggered by `setTab`. Writing the URL
afterwards would arrive one render too late: the list would come up unfiltered while the address
bar claimed otherwise.

## 5. The hook: `useTabNavigation(setTab)`

Returns the shell's whole navigation surface:

| Member | Behavior |
|---|---|
| `navigate(href)` | drill-down: `navigateTo` (pushState → setTab) |
| `selectTab(tab)` | direct tab click: **clears** any lingering `?query` (pushState `/<tab>` if search non-empty) so a later visit doesn't re-hydrate `?routeId=3` from an unrelated drill-down, then `setTab` |
| *(effect)* | subscribes `popstate` → `tabForLocation()` → `setTab` so Back/Forward move tabs; a non-section path (initial `/`) keeps the current tab rather than blanking the screen |

`useCallback` wraps `navigate`; the `popstate` listener is removed on cleanup.

## 6. The drill-down flow (end to end)

```text
Dashboard tile "Pending (42)" clicked
  └─ onClick → navigate(shipmentListHref('Pending', filters))      (dashboard/schema.ts builds
                                                                    '/shipments?status=Pending&...')
     ├─ tabForHref → 'shipments'
     ├─ history.pushState(null, '', '/shipments?status=Pending')    ← address bar updated
     └─ setTab('shipments')                                         ← shell re-renders
          └─ MasterDataTabs mounts <ShipmentsPage/>
               └─ const [initial] = useState(initialShipmentFilters)
                    └─ shipmentsFiltersFromSearch(window.location.search)   ← reads what we just wrote
                         └─ status='Pending' seeded as first state
                              └─ useShipments(params) fires ONE filtered request
```

Two halves, both required (LOGI-0012 AC-6): the shell writes the URL **and** switches the tab;
the list reads the URL **once on mount**.

### URL → filter parsing (`shipmentsFilterParams.ts`)

- `shipmentsFiltersFromSearch(search)` is **pure and total**: unknown enum values are dropped
  (`oneOf`), non-positive/non-integer ids dropped (`positiveInt`), `slaRisk` tri-state validated —
  a hand-edited or stale link degrades to a usable unfiltered page instead of a 400 the user can't
  attribute to any control.
- Extracted from the page precisely so it unit-tests without a DOM
  (`shipmentsFilterParams.test.ts`).
- After mount, local `useState` owns the values — editing controls does not rewrite the address
  bar (URL is a *starting point*, not a live mirror).

### Href builders live next to their feature

```ts
// dashboard/schema.ts — always targets EXISTING endpoints with equivalent filters
shipmentListHref('at-risk', filters)  // → /shipments?slaRisk=true&priority=...
shipmentListHref('Pending', filters)  // → /shipments?status=Pending&...
vehicleListHref('Maintenance')        // → /vehicles?status=Maintenance
driverListHref('OffDuty')             // → /drivers?status=OffDuty
```

Rule (AC-6): a drill-down never invents a new query language — it reuses the exact `GET`
parameters the destination list already understands. Dashboard filters carry over so the tile and
the list ask the server the same question (except `status` when the tile itself set one).

## 7. Back/Forward behavior summary

```text
click Board tab   → pushState('/board')    (only when a query needed clearing — see selectTab)
click Dashboard   → pushState('/dashboard')
browser Back      → popstate → tabForLocation() → '/board' → setTab('board')
browser Forward   → popstate → '/dashboard' → setTab('dashboard')
```

Note `selectTab` only pushes when it must clear a query — direct tab clicks on a clean URL don't
pollute history.

## 8. If you're adding navigation behavior

- New section → add to `TabKey` + `TAB_KEYS` + `<Tab>` + the conditional render chain; the
  segment check follows automatically.
- New drill-down → build the href with `URLSearchParams` from the destination's own param
  vocabulary; call `navigate(href)` from the feature (dashboard passes `onNavigate` down as a prop
  so `DashboardPage` stays router-agnostic).
- Never write the URL *after* `setTab` — mount-time readers would miss it.

