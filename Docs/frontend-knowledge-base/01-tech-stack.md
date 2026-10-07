# 01 — Tech Stack & Tooling

What the LogiFlow frontend is built with, why, and how you run it.

## 1. The stack at a glance

| Layer | Choice | Where defined |
|---|---|---|
| UI framework | **React 18.3** (function components + hooks, TypeScript 5.9) | `src/frontend/package.json` |
| Build tool / dev server | **Vite 8** + `@vitejs/plugin-react` | `src/frontend/vite.config.ts` |
| Component library | **MUI v5** (`@mui/material`) + Emotion (`@emotion/react`, `@emotion/styled`) | `src/frontend/src/theme.ts` |
| Server-state / data fetching | **TanStack React Query v5** (`@tanstack/react-query`) | provider in `src/frontend/src/App.tsx` |
| Forms | **react-hook-form v7** + `@hookform/resolvers` | every `*FormDialog.tsx` |
| Validation | **Zod v3** | every `src/features/<f>/schema.ts` |
| API typing | **openapi-typescript** → `src/api/schema.d.ts` from `contracts/v1-openapi.yaml` | `generate:api` script |
| HTTP | native `fetch` (no axios) | `src/frontend/src/api/client.ts` |
| Auth token storage | `localStorage` with in-memory fallback | `src/frontend/src/api/tokenStore.ts` |
| Tests | **Vitest 5** + **jsdom** + **Testing Library** + **MSW 2** (mock API) | `vite.config.ts` `test` block, `src/test/setup.ts` |

Architecture decisions behind these choices are recorded as ADRs in `Docs/adr/` — notably
**ADR-002** (MUI), **ADR-004** (contract-first client + MSW mocks), **ADR-007** (JWT auth model).

## 2. npm scripts (`src/frontend/package.json`)

```text
npm run dev          → vite               dev server on :5173, proxies /api → http://localhost:5199
npm run build        → tsc && vite build  type-check, then emit dist/
npm run preview      → vite preview       serve dist/ with the same /api proxy (E2E/CI runtime)
npm test             → vitest run         one-shot test run (162 tests, ~64s)
npm run test:watch   → vitest             watch mode
npm run generate:api → openapi-typescript ../../contracts/v1-openapi.yaml -o src/api/schema.d.ts
```

Key implications:

- **`npm run build` runs `tsc` first** — type errors fail the build. There is no ESLint step in the
  scripts; the compiler (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` in
  `tsconfig.json`) is the linting pressure.
- **`schema.d.ts` is generated, never hand-edited.** Change `contracts/v1-openapi.yaml` and re-run
  `generate:api`.

## 3. Vite configuration (`src/frontend/vite.config.ts`)

```ts
server: { port: 5173, proxy: { '/api': { target: 'http://localhost:5199', changeOrigin: true } } }
preview: { /* same proxy */ }
test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' }
```

- The **proxy** is why `client.ts` can use relative paths (`/api/v1/...`): the same code works
  against the dev proxy, `vite preview`, MSW mocks, and the production nginx (`nginx.conf`).
- The `test` block (imported from `vitest/config`) is where Vitest gets its config — one file
  configures build + test.
- `globals: true` makes `describe/it/expect` available without imports (though the code imports
  `beforeEach` etc. from `vitest` explicitly).

## 4. TypeScript config highlights (`src/frontend/tsconfig.json`)

- `"jsx": "react-jsx"` — the modern JSX transform: no `import React` needed just to write JSX.
- `"moduleResolution": "bundler"` + `"allowImportingTsExtensions"` — Vite-style imports.
- `"verbatimModuleSyntax": true` — type-only imports must say `import type { ... }`; you will see
  this everywhere in the codebase.
- `"noEmit": true` — `tsc` only checks; Vite does the transpiling.
- `"types": ["vite/client"]` — gives `import.meta.env` typing for env vars like
  `VITE_ENABLE_MOCKS`.

## 5. The React StrictMode wrapper

`src/main.tsx` renders `<App />` inside `<React.StrictMode>`. In development this double-invokes
render and effects so you catch:

- effects that are not idempotent (missing cleanup),
- side effects that depend on mount order.

This is why some `useEffect` blocks in the codebase have careful `cancelled` flags or
"runs on mount only" comments.

## 6. Environment variables

Only one is used: `VITE_ENABLE_MOCKS` (`src/main.tsx`):

```bash
VITE_ENABLE_MOCKS=1 npm run dev   # start the MSW service worker → no backend needed
npm run dev                       # real API through the /api proxy
```

Vite exposes only vars prefixed `VITE_` to the client bundle; anything else is build-time hidden.

## 7. Running the whole system

- Backend: ASP.NET Core on `http://localhost:5199` (that is the proxy target).
- Frontend: `npm run dev` in `src/frontend` → `http://localhost:5173`.
- Docker: `docker-compose.yml` / `docker-compose.override.yml` at the repo root orchestrate both;
  the frontend image builds `dist/` and serves it via nginx (`src/frontend/Dockerfile`,
  `src/frontend/nginx.conf`).

## 8. What "contract-first" means here (ADR-004)

1. The OpenAPI spec `contracts/v1-openapi.yaml` is the single source of truth for the API shape.
2. `npm run generate:api` compiles it into `src/api/schema.d.ts` (TypeScript types only, ~2400 lines).
3. `src/api/client.ts` imports those types and wraps `fetch` — **no hand-invented endpoints or
   DTOs**.
4. The MSW handlers in `src/mocks/handlers.ts` model the same contract, including status codes,
   `ProblemDetails` errors and role checks, so UI work and tests run without the backend.

If the backend changes a response field, the fix flows: contract → regenerate types → compiler
errors point at the exact code to update.
