# Frontend Knowledge Base — LogiFlow React SPA

A set of documents that explains **how the LogiFlow frontend is implemented and how code flows
through it**. Written for developers who are new to React and/or new to this repository.

## Where things live

- The frontend source root is `c:\Sudipto\SpecDrivenDesigns\src\frontend` (referred to below as
  `<frontend>/`).
- All paths in these documents are relative to the repository root
  `c:\Sudipto\SpecDrivenDesigns` unless stated otherwise.
- The backend is an ASP.NET Core API at `src/backend`; the OpenAPI contract the frontend is typed
  against is `contracts/v1-openapi.yaml`.

## Reading order

| # | Document | What it answers |
|---|----------|-----------------|
| 01 | [01-tech-stack.md](01-tech-stack.md) | What libraries/tools are used, what each npm script does, how dev/build/test run |
| 02 | [02-react-primer.md](02-react-primer.md) | The React concepts you must know to read this codebase (components, state, hooks, context, effects) |
| 03 | [03-project-architecture.md](03-project-architecture.md) | Folder layout, the App shell, provider nesting, and the anatomy of a feature |
| 04 | [04-startup-and-auth-flow.md](04-startup-and-auth-flow.md) | What happens from page load → login screen → authenticated shell; session restore, refresh, expiry, roles |
| 05 | [05-api-layer.md](05-api-layer.md) | The contract-first API client: generated types, `request()`, error handling, token attachment |
| 06 | [06-data-fetching.md](06-data-fetching.md) | TanStack React Query: query keys, caching, mutations, invalidation patterns |
| 07 | [07-navigation-and-url-state.md](07-navigation-and-url-state.md) | Why there is no router, how tabs + `history.pushState` + URL filters work |
| 08 | [08-forms-and-validation.md](08-forms-and-validation.md) | react-hook-form + Zod validation, dialog form pattern, mapping server field errors |
| 09 | [09-testing.md](09-testing.md) | Vitest + MSW + Testing Library, the shared test harness, test conventions |
| 10 | [10-end-to-end-flows.md](10-end-to-end-flows.md) | Traced walkthroughs of the main scenarios, plus a "where do I change X" cheat sheet |

## The 60-second version

1. `index.html` loads `src/main.tsx`, which optionally starts **MSW mocks**, then renders `<App />`
   into `#root` with `React.StrictMode`.
2. `App.tsx` stacks **providers**: React Query → MUI theme → `AuthProvider` → `AuthGate`.
3. `AuthGate` shows the **login page** until `AuthContext` reports `authenticated`; otherwise it
   mounts the app chrome: a header (`AppHeader`) and a **tab strip** (`MasterDataTabs`) that
   conditionally renders one page per tab (Warehouses, Vehicles, Drivers, Shipments, Routes,
   Board, Dashboard) — there is **no react-router**; navigation is a state machine over tab keys
   plus `history.pushState`.
4. Every page talks to the backend through `src/api/client.ts`, a typed wrapper over the generated
   OpenAPI types (`src/api/schema.d.ts`), with **React Query** hooks (`src/features/<f>/hooks.ts`)
   handling caching/invalidation and **Zod schemas** (`src/features/<f>/schema.ts`) mirroring the
   backend's validation rules.
5. The same MSW handlers (`src/mocks/handlers.ts`) power both browser mock mode and the unit/integration
   test suite (162 tests, `npm test`).

## Quick directory map

```
src/frontend/
├── index.html              # Vite entry HTML (div#root → /src/main.tsx)
├── vite.config.ts          # dev/preview proxy /api → http://localhost:5199 + vitest config
├── package.json            # scripts: dev, build, preview, test, test:watch, generate:api
├── Dockerfile, nginx.conf  # production image serving the built dist/
└── src/
    ├── main.tsx            # bootstrap: optional MSW → createRoot → <App/>
    ├── App.tsx             # providers + header + tab shell (the "router")
    ├── appNavigation.ts    # tab/URL grammar: navigate(), useTabNavigation(), popstate
    ├── theme.ts            # MUI createTheme
    ├── api/                # contract-typed fetch client + token storage
    ├── components/         # shared UI bits (icons)
    ├── features/           # one folder per feature (auth, warehouses, vehicles, drivers,
    │                       #   shipments, routes, planning, dashboard)
    ├── mocks/              # MSW handlers (in-memory API) + browser worker
    └── test/               # vitest setup + renderApp harness
```
