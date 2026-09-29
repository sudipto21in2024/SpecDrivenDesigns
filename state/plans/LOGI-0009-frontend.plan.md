---
ticket: LOGI-0009
arm: frontend
status: locked
created: 2026-09-28T04:41:40.538Z
depends_on_plans: LOGI-0009-architect, LOGI-0009-backend
---

## 1. Objective
Implement frontend routes management feature for LOGI-0009: OpenAPI client sync, MSW mock handlers for routes, role permissions and Route tabs, route list page with filtering and pagination, route creation dialog, route edit/assignment dialog, and comprehensive unit/integration test coverage.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/schema.d.ts` | regenerate | Sync types with OpenAPI contract for routes endpoints | ~274 |
| `src/frontend/src/api/client.ts` | modify | Route types and route API methods (listRoutes, getRoute, createRoute, updateRoute) | ~60 |
| `src/frontend/src/features/auth/permissions.ts` | modify | Capabilities for routes: viewRoutes, createRoutes, editRoutes | ~15 |
| `src/frontend/src/features/routes/schema.ts` | create | Zod schemas and mappers for route creation and route assignment/updating | ~80 |
| `src/frontend/src/features/routes/hooks.ts` | create | React Query hooks for routes list, detail, create, and update | ~60 |
| `src/frontend/src/features/routes/RouteFormDialog.tsx` | create | Route creation dialog with validation and vehicle/driver optional selection | ~160 |
| `src/frontend/src/features/routes/EditRouteDialog.tsx` | create | Route edit / assignment dialog with vehicle/driver selection and unassign support | ~180 |
| `src/frontend/src/features/routes/RoutesPage.tsx` | create | Routes management page with list table, status filter, search, pagination, create/edit actions | ~260 |
| `src/frontend/src/features/routes/RoutesPage.test.tsx` | create | Vitest tests verifying AC-1 through AC-10 via UI interactions and mock API | ~350 |
| `src/frontend/src/mocks/handlers.ts` | modify | MSW handlers for /routes endpoints (GET, POST, GET /:id, PATCH /:id) with conflict and validation checks | ~250 |
| `src/frontend/src/test/renderApp.tsx` | modify | Add resetRoutesDb to resetMocks | ~5 |
| `src/frontend/src/App.tsx` | modify | Add Routes tab to navigation and render RoutesPage | ~20 |
| `memory/journal/LOGI-0009.md` | modify | Log frontend arm progress and sealing | ~20 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0009-create-route.md` | full | Acceptance criteria AC-1..AC-10 |
| `src/frontend/src/api/client.ts` | 1-200 | Existing client idioms |
| `src/frontend/src/features/auth/permissions.ts` | full | Role permissions structure |
| `src/frontend/src/mocks/handlers.ts` | 1-250 | MSW handlers patterns and mock stores |
| `src/frontend/src/test/renderApp.tsx` | full | Test render helper patterns |
| `src/frontend/src/App.tsx` | 100-200 | Navigation and Tab layout |

## 4. Steps (each with verify gate)
- [x] 1. Core API & Mock infrastructure: sync schema.d.ts, export route types & client functions in client.ts, add routes capabilities in permissions.ts, add routes MSW handlers in handlers.ts and renderApp.tsx -> verify: npx tsc --noEmit clean
- [x] 2. Routes UI Components: implement schema.ts, hooks.ts, RouteFormDialog.tsx, EditRouteDialog.tsx, RoutesPage.tsx, and wire into App.tsx -> verify: npx tsc --noEmit clean
- [x] 3. Routes Vitest Test Suite & Verification: implement RoutesPage.test.tsx covering AC-1..AC-10, run test suite, build bundle -> verify: npm test and npm run build pass 100%

## 5. Risks / open questions
- Time window formatting and comparisons: plannedStart and plannedEnd ISO timestamps need clean datetime-local inputs or text validation.
- Double-booking overlap logic in mock handler must strictly mirror BR-3/BR-4 logic (plannedStart < other.plannedEnd && other.plannedStart < plannedEnd for Planned/InProgress routes).
- Role permissions: Driver sees only own assigned routes on list read, cannot access other driver's route detail (403), cannot POST/PATCH. Viewer has read-only access (403 on POST/PATCH).

## 6. Exit gates
- npx tsc --noEmit and npm run build in src/frontend succeed with 0 errors.
- npm test passes all tests across all test suites including newly added RoutesPage.test.tsx.
- All acceptance criteria AC-1..AC-10 are explicitly covered with matching test comments.
- One clean git commit for the frontend arm upon tracker sealing.
