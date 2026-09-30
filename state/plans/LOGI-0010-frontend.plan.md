---
ticket: LOGI-0010
arm: frontend
status: locked
created: 2026-09-30T08:03:14.923Z
depends_on_plans:
---

## 1. Objective
LOGI-0010 frontend arm: sync the OpenAPI client, add MSW handlers and role permissions for the three route-shipment operations, and build the route Shipments panel (capacity projection, assign, unassign) with full AC coverage.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/schema.d.ts` | regenerate (`npm run generate:api`) | AC-1..AC-9 — the three new ops + `RouteShipmentsPage` / `RouteCapacityView` types come from the contract, not by hand | generated |
| `src/frontend/src/api/client.ts` | modify | AC-1/AC-6/AC-8 — `assignShipmentToRoute`, `listRouteShipments`, `removeShipmentFromRoute` + contract-derived type aliases (`RouteShipmentsPage`, `RouteCapacityView`, `AssignShipmentToRouteInput`, `ListRouteShipmentsParams`) | ~30 |
| `src/frontend/src/features/auth/permissions.ts` | modify | AC-7 — `viewRouteShipments` (all roles) and `assignRouteShipments` (Admin/Dispatcher) mirroring the three ops' `x-roles` | ~12 |
| `src/frontend/src/features/routes/RouteShipmentsPanel.tsx` | create | AC-1..AC-8 — capacity banner, paged assigned-shipment table, assign form, unassign button, 409/404 problem-detail surfacing | ~330 |
| `src/frontend/src/features/routes/hooks.ts` | modify | AC-1/AC-6/AC-8 — `useRouteShipments`, `useAssignShipmentToRoute`, `useRemoveShipmentFromRoute`; assign/unassign invalidate the shipments list and the routes tree | ~60 |
| `src/frontend/src/features/routes/RoutesPage.tsx` | modify | AC-1/AC-7/AC-8 — a "Shipments" row action on Planned routes opening the panel; read-only affordance for Viewer/Driver | ~40 |
| `src/frontend/src/mocks/handlers.ts` | modify | AC-1..AC-9 — MSW handlers for the 3 ops incl. the BR-5 capacity 409 (with the assigned/adding/capacity numbers in `detail`), non-Planned 409, non-Pending 409, cross-route 409, idempotent re-assign, unassign 204/404/409, paged envelope + `capacity` projection | ~260 |
| `src/frontend/src/test/renderApp.tsx` | modify | reset parity for any new mock store helper | ~5 |
| `src/frontend/src/features/routes/RouteShipmentsPanel.test.tsx` | create | AC-1..AC-9 traceability, each case tagged `// LOGI-0010 AC-n` | ~420 |
| `memory/journal/LOGI-0010.md` | modify (tracker seal only) | frontend-arm journal section | via CLI |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0010-assign-shipment-to-route.md` | full | AC-1..AC-10, §5 out-of-scope, §7 O1-O4 (409-not-400, Planned-only, one-route-per-shipment, unassign is first-class) |
| `contracts/v1-openapi.yaml` | route-shipments ops | exact request/response shapes, `x-roles`, ProblemDetails wiring |
| `src/frontend/src/features/routes/schema.ts` | 1-70 | existing mapper/instant conventions the panel must match |
| `src/frontend/src/features/routes/EditRouteDialog.tsx` | 1-80 | dialog + error-surfacing conventions reused by the panel |
| `src/frontend/src/features/shipments/hooks.ts` | full | how the shipment list is paged, so the assign form reuses it for candidates |
| `src/frontend/src/mocks/handlers.ts` | 60-120, 1300-1573 | mock store shape (`MockShipment.routeId`, `MockRoute`), role rules, route handler conventions |

## 4. Steps (each with verify gate)
- [x] 1. **M1 — Contract sync + logic (client, permissions, hooks, aliases, MSW handlers).** Regenerate `schema.d.ts` from the already-approved contract; add the three client methods and their types; add the two capabilities; add the three hooks with correct invalidation; extend the MSW store so `MockShipment.routeId` is the single source of truth and implement the 3 handlers with every guard the spec names (404 unknown route/shipment; 409 non-Planned route naming "Planned"; 409 non-Pending naming "Pending"; 409 cross-route naming unassign-first; 409 capacity naming assigned/adding/capacity; idempotent 200 for same-route re-assign with no second history row; DELETE 204/404/409; GET paged envelope with `capacity` nulls for a vehicle-less route). → verify: `npm run generate:api` produces no hand-edited drift, `npx tsc --noEmit` passes, and a scratch vitest spec exercises each 200/204/400/404/409 branch against the mock.

- [x] 2. **M2 — Integration + UI (`RouteShipmentsPanel` + `RoutesPage` wiring).** Build the panel: capacity banner (assignedWeightKg / capacityKg / remainingCapacityKg, with an explicit "no vehicle — capacity not checked" state rather than showing 0, AC-2/AC-8), paged assigned-shipment table, a role-gated assign control that lists Pending, unassigned candidates and posts `{shipmentId}`, and a per-row unassign button. Surface 409 `detail` text verbatim so the capacity numbers reach the operator. Wire a "Shipments" action into `RoutesPage` for every role that can read (Viewer/Driver see the list, no write affordances), and only offer assign/unassign on `Planned` routes (AC-3). → verify: `npx tsc --noEmit` + `npm run build` pass; the full test suite still green.

- [x] 3. **M3 — Arm verification.** Write `RouteShipmentsPanel.test.tsx` covering AC-1..AC-9 with `// LOGI-0010 AC-n` comments (happy path + read-back, capacity accept/reject incl. the no-vehicle case, non-Planned 409, non-Pending 409, cross-route 409, idempotent re-assign, 400 field-keyed validation, unassign round-trip freeing capacity, per-role affordance matrix incl. Driver's own-route read, 404/400 paging, and AC-10 no-regression on the existing suites). → verify: `npm test` green in `src/frontend`, AC-n comments present for every AC, then seal + HANDOFF frontend→qa naming the Playwright surface.

## 5. Risks / open questions
- **409 vs 400 (spec §7 O1).** The UI must show *any* non-2xx `ProblemDetails.detail` rather than assuming 400-means-field / 409-means-global; `ApiError` already carries both, so one alert renderer covers all guards.
- **Candidate list source.** The assign form needs Pending + unassigned shipments. `GET /shipments` already supports paged reads and LOGI-0007 owns it, so the panel consumes the existing hook instead of adding an endpoint (spec §5: no new reads). A shipment assigned to *another* route is filtered out client-side, but AC-4's 409 remains the authority for the race.
- **Driver own-route scoping (AC-7).** Server-side is the backend's job; the frontend only hides write affordances. The mock must mirror the 403 for a Driver on a route that is not theirs, or the AC-7 test would assert UI behaviour the real API does not have.
- **Idempotent re-assign (AC-4).** The mock must not append a history row or double-count weight on a same-route POST, since a "successful" UI showing a duplicate history entry would contradict AC-1.
- **No new tab.** The panel is a route-scoped surface; `App.tsx` stays untouched, so `viewRoutes` continues to govern tab visibility.

## 6. Exit gates
- `npx tsc --noEmit` and `npm run build` in `src/frontend` succeed with 0 errors.
- `npm test` in `src/frontend` passes every suite, including the new `RouteShipmentsPanel.test.tsx`; all pre-existing LOGI-0007/0008/0009 suites still pass (AC-10).
- Every AC-1..AC-9 is covered by at least one test carrying a `// LOGI-0010 AC-n` comment; no test asserts a 409/404 the mock does not actually produce.
- `src/frontend/src/api/schema.d.ts` matches `npm run generate:api` output (no hand-edited contract types); no new hand-invented endpoint.
- `git status --short` shows only §2 manifest paths (plus tracker-derived state); one atomic commit for the arm.
