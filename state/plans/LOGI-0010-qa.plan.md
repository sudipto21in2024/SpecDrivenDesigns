---
ticket: LOGI-0010
arm: qa
status: locked
created: 2026-09-30T14:50:48.932Z
depends_on_plans:
---

## 1. Objective
LOGI-0010 qa arm: E2E coverage for the three route-shipment operations against the real API — assign (BR-5 capacity, 404/409/400 guards, idempotency), unassign, the paged list with its capacity projection, the per-role authz matrix, and the panel UI flow.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/support/route-shipments.ts` | create | AC-1..AC-9 — endpoint helpers (assign/list/unassign, status+body in one call) and fixtures: a vehicle with a chosen `capacityKg`, a shipment already linked to a route, and `routeId` on the seeded shipment so capacity fixtures are direct | ~200 |
| `tests/e2e/pages/routes.page.ts` | modify | AC-1/AC-6/AC-8 — the Shipments panel accessors (open, capacity banner, assign select, unassign button, panel alert) so UI specs carry no raw selectors | ~55 |
| `tests/e2e/route-shipments.spec.ts` | create | AC-1..AC-5/AC-8/AC-9 on the API — happy path + read-back, the BR-5 capacity accept/reject ladder, the no-vehicle case, the 404/409/400 guards, idempotent re-assign, atomicity, and the paged list with its capacity projection | ~330 |
| `tests/e2e/route-shipments-authz.spec.ts` | create | AC-7/BR-6 — the real-JWT role matrix: anonymous 401, Viewer read/no-write, Driver own-route 200 and other-route 403, Admin/Dispatcher full access; every rejection asserted to write nothing | ~150 |
| `tests/e2e/route-shipments-ui.spec.ts` | create | AC-1/AC-2/AC-6/AC-7 — the panel end-to-end: open it, assign from the candidate select, see the capacity projection move, hit the capacity 409 with its three numbers, unassign, and confirm a Viewer/Driver sees no write affordances | ~180 |
| `state/plans/LOGI-0010-qa.plan.md` | modify (ticks) | step bookkeeping | via CLI |
| `memory/journal/LOGI-0010.md` | modify (tracker seal only) | qa-arm journal section | via CLI |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0010-assign-shipment-to-route.md` | full | AC-1..AC-10 and §7 O1-O4 — the guard set each spec must prove |
| `contracts/v1-openapi.yaml` | route-shipments ops | response codes and the `RouteCapacityView` null semantics asserted here |
| `tests/e2e/support/routes.ts` | 1-300 | `createRoute`/`seedRoute`/`window`/`routeName`/`uniqueRef` + the driver-link helpers, all reused rather than reinvented |
| `tests/e2e/support/shipments.ts` | 137-330 | `seedShipmentAt` / `getShipment` / `getHistory` / `listShipments` fixtures and the direct-SQLite idiom |
| `tests/e2e/support/api.ts` | full | `signIn`, `SEED_USERS`, `authHeaders`, `seedVehicle` (needs a `capacityKg` override) |
| `tests/e2e/routes-authz.spec.ts` | full | the authz-matrix shape this ticket's matrix must match |
| `tests/e2e/playwright.config.ts` | full | single-worker / `fullyParallel: false` constraint the direct-SQL fixtures rely on |

## 4. Steps (each with verify gate)
- [x] 1. **M1 — Fixtures + endpoint helpers (`support/route-shipments.ts`).** Add `assignShipmentToRoute` / `listRouteShipments` / `removeShipmentFromRoute`, each returning status *and* body in one call so a spec asserts a 2xx payload or a ProblemDetails without a second request (the `support/routes.ts` idiom). Add the fixtures the scenarios need that no existing helper provides: a vehicle with a chosen `capacityKg`, and a `seedShipmentAt`-style shipment carrying a `routeId`, so "already assigned to route R" and "at 900/1000 kg" are direct instead of assembled through a chain of assigns. → verify: `npx playwright test --list` resolves the new helpers and `support/route-shipments.ts` typechecks against the contract-typed client.

- [ ] 2. **M2 — API + authz specs.** Write `route-shipments.spec.ts` (AC-1..AC-5/AC-8/AC-9: assign happy path with read-back through `GET /shipments/{id}` and the history row; the capacity ladder 400 → 400 → reject with all three numbers in `detail`; the no-vehicle case that skips the check; 404 unknown route/shipment; 409 non-Planned naming `Planned`; 409 non-Pending; 409 cross-route; idempotent same-route 200 with no second history row and no double-count; the paged envelope with its capacity projection incl. the nulls; the 400 field-keyed validation cases) and `route-shipments-authz.spec.ts` (AC-7 against real JWTs: anonymous 401, Viewer 200-on-read/403-on-write, Driver 200 only for their own linked route and 403 otherwise, Admin/Dispatcher full; each rejection followed by an assertion that nothing was written). → verify: `npx playwright test route-shipments.spec.ts route-shipments-authz.spec.ts` green.

- [x] 3. **M3 — UI spec + full-suite verification.** Extend `pages/routes.page.ts` with the panel accessors (open, capacity banner, candidate select, unassign, panel alert — no raw selectors in specs) and write `route-shipments-ui.spec.ts` (AC-1/AC-2/AC-6/AC-7: open the panel, assign from the candidate select, watch the capacity projection move, provoke the capacity 409 and see its three numbers in the alert, unassign and watch the freed weight become reusable, and confirm a Viewer and a Driver get the read-only panel). Then run the whole suite. → verify: `npx playwright test` green with every pre-existing spec still passing, and `git status --short` shows only §2 manifest paths.

## 5. Risks / open questions
- **Spec §7 O1 (409, not 400).** The specs assert 409 for the capacity and status guards. If the backend instead answers 400 for any of these, this is a genuine contract/behaviour disagreement to fix at the source, not to paper over in the spec — the assertions follow the approved contract.
- **Direct-SQL fixtures vs. the `routes` FKs.** A seeded shipment's `routeId` must point at a real route row (`fk_shipments_routes`) and a `capacityKg` vehicle at a real vehicle row; the fixtures create the parents first.
- **Shared 1:1 driver link.** The Driver own-route case needs the seeded Driver account linked to a driver row, which `ensureDriverLinkedToUser` shares across the suite — reuse it rather than linking a second one, and leave it linked as the other routes specs do.
- **Capacity fixtures are order-dependent.** A route's assigned total is shared state within a spec, so each capacity scenario builds its own route instead of reusing one, keeping the ladder independent.
- **No src/contract edits.** If a spec uncovers a backend or frontend defect, it is recorded and the *arm* is fixed there — this arm must not quietly widen its manifest to patch `src/**`.

## 6. Exit gates
- `npx playwright test` green, 0 failed, 0 flaky, with no pre-existing spec modified to accommodate LOGI-0010.
- AC-1..AC-9 each covered by at least one test whose title carries a `// LOGI-0010 AC-n` marker; no test asserts a status the real API does not return.
- Every UI spec drives the panel through `pages/routes.page.ts` — no raw CSS selectors in spec files.
- `git status --short` shows only §2 manifest paths (plus tracker-derived state); one atomic commit for the arm.
