---
ticket: LOGI-0012
arm: backend
status: locked
created: 2026-10-02T14:55:00.000Z
depends_on_plans:
  - state/plans/LOGI-0012-architect-followup.plan.md
---

## 1. Objective

LOGI-0012 backend follow-up: **make `GET /shipments` honour the `routeId` filter the architect arm
added to the contract**, so the implementation and the contract finally agree and AC-6's invariant
holds end-to-end rather than on paper only.

The architect arm added `routeId` to the `listShipments` operation in
`contracts/v1/paths/shipments.yaml` (commit `adb46a5`). The API does not implement it yet:
`ListShipmentsQuery` has no `RouteId` member, so a `?routeId=7` on `GET /api/v1/shipments` is silently
ignored and the caller gets the **unfiltered** list. That is the worst failure mode for a filter: it
looks like it worked. The dashboard's route-scoped drill-down therefore still lands on a list
filtered by nothing, and the qa arm's finding is only half closed.

Scope is one read filter. No migration (`route_id` has existed on the row since LOGI-0010), no command,
no new endpoint, no change to the role matrix.

Three rules shape the work:

- **One predicate, not two.** `PlanningBoardFilters.Apply` already implements the `routeId` clause
  with a comment explaining exactly why it is *not* a null equality. `ListShipmentsHandler` keeps its
  own inline filter chain rather than delegating, because that chain is the LOGI-0007 list's own
  contract and refactoring it to share a static helper would widen the blast radius of a
  one-parameter change. So the routeId clause is added inline **with the same semantics and the same
  reasoning comment**, and the two endpoints are held together by a test that asserts they agree —
  which is stronger than a shared helper anyway, because a helper cannot be wrong on only one call
  site.
- **Filter position is observable.** The clause goes immediately after `originWarehouseId`, matching
  the contract's parameter order, so a reader diffing the handler against the contract sees the same
  sequence.
- **Validation matches the contract.** The contract says `minimum: 1`, so `routeId=0` and
  `routeId=-1` are 400 with the response's keyed `errors` map naming `routeId` — the same fail-loud
  treatment `status`/`priority`/`sort` already get (LOGI-0007 AC-7/§7). A negative id silently
  returning the empty page would be the same lie as ignoring the filter.

## 2. Touched files (WRITE manifest — the scope boundary)

| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentQueries.cs` | modify | AC-6 — add `RouteId` to `ListShipmentsQuery` (positioned to mirror the contract's parameter order), the `> 0` validator rule, and the handler clause mirroring `PlanningBoardFilters` | +14/-1 |
| `src/backend/LogiFlow.Api.Tests/ShipmentListRouteFilterTests.cs` | create | AC-6 traceability: the filter narrows, it is not a null equality, an unknown route yields an empty page rather than a 404, it composes AND with the other filters, the out-of-range values are keyed 400s, and the board and the list agree on the same route | ~170 |
| `state/plans/LOGI-0012-backend-followup.plan.md` | create (via CLI) | this arm's milestones | via CLI |
| `memory/journal/LOGI-0012.md` | modify (tracker seal only) | backend-followup journal section | via CLI |

`ShipmentEndpoints.cs` is deliberately **not** in the manifest: `GET /` already binds
`[AsParameters] ListShipmentsQuery`, so a new record member binds from the query string with no
endpoint edit. Same for `DependencyInjection.cs` — `ListShipmentsValidator` is already registered
and only gains a rule.

## 3. Required files (READ-ONLY scope)

| Path | Lines | What's needed |
|---|---|---|
| `contracts/v1/paths/shipments.yaml` | 15-22 | the exact `routeId` parameter the code must match: name, `int64`, `minimum: 1`, and the "a null routeId is not implied" description |
| `src/backend/LogiFlow.Application/Features/Planning/PlanningBoardFilters.cs` | 39-43 | the routeId clause whose semantics must be mirrored verbatim, including its reasoning comment |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentQueries.cs` | 66-140 | the query record, the validator's fail-loud idiom, and the filter chain the clause joins |
| `src/backend/LogiFlow.Api.Tests/ShipmentListTests.cs` | 1-60 | the seeding + client idiom the new test file mirrors |
| `src/backend/LogiFlow.Api.Tests/RouteShipmentListTests.cs` | 41-122 | the warehouse/route/assign seeding helpers, the only existing way to give a shipment a `routeId` |
| `state/plans/LOGI-0012-architect-followup.plan.md` | 1, 5 | the decision this arm implements, and the constraint that the semantics must not be invented here |

## 4. Milestones (vertical slices)

- [ ] 1. **M1 — the filter, its validation and the handler clause.** Add `long? RouteId` to
      `ListShipmentsQuery` in the position the contract lists it, `RuleFor(x => x.RouteId).GreaterThan(0)`
      alongside the existing fail-loud rules, and the handler clause after the `originWarehouseId`
      block, carrying the same "an explicit routeId is an equality filter, not a null equality"
      reasoning the planning board records.
      → verify: `dotnet build src/backend/LogiFlow.sln` 0 errors 0 warnings; `GET /api/v1/shipments?routeId=0`
      returns 400 with `errors.routeId` rather than an empty page.

- [ ] 2. **M2 — coverage that pins the semantics, including the cross-endpoint agreement.** Create
      `ShipmentListRouteFilterTests.cs`: the filter narrows to exactly the assigned rows; unassigned
      shipments are **not** dragged in (the case a naive `OR routeId IS NULL` would fail); an unknown
      route id returns 200 with an empty page, never a 404; the clause ANDs with `status` rather than
      replacing it; `routeId=0` and `routeId=-1` are keyed 400s; and the decisive one — the same
      `routeId` on `GET /shipments` and `GET /planning-board` returns the same shipment set, which is
      what makes the dashboard drill-down lossless and is the assertion the architect arm's fix
      exists to enable. Each case tagged `// LOGI-0012 AC-6`.
      → verify: `dotnet test src/backend/LogiFlow.Api.Tests --filter FullyQualifiedName~ShipmentListRouteFilterTests`
      green, with every new test carrying a `// LOGI-0012 AC-6` marker.

- [ ] 3. **M3 — whole-suite gate and the no-regression proof.** `dotnet test src/backend/LogiFlow.sln`
      (231 pre-existing + the new cases) and
      `dotnet ef migrations has-pending-model-changes --project src/backend/LogiFlow.Infrastructure`
      — a read filter must move no schema. `git status --short` must show only §2 paths, and
      `check-size.mjs` must show no **new** violation attributable to this arm.
      → verify: full suite green with no pre-existing test edited (the LOGI-0007 list suite and the
      LOGI-0011 board suite are the regression canaries for the filter chain and the shared clause),
      no pending model changes, nothing outside the manifest touched.

## 5. Risks

- **A shared helper is tempting and wrong here.** `PlanningBoardFilters.Apply` is `public static` and
  the dashboard already calls the value-level overload. Routing the shipment list through it would
  look like de-duplication, but the list's chain has its own ordering/paging contract and the two
  currently differ in how they build the query. Widening that into a shared abstraction during a
  one-parameter change is the classic way a "small" fix becomes a regression. The cross-endpoint
  equality test is the cheaper guarantee.
- **`ShipmentQueries.cs` is already over the 150-line gate** (192 lines, pre-existing). This arm adds
  ~13 lines to it. The file was already over before this arm and is not made *worse in kind* — the
  addition is a filter clause, which is what the file is for — but the size gate will still report it
  and the count will have grown. Recorded in the seal rather than silently ignored; splitting the
  file is a separate ticket, not a drive-by refactor inside a follow-up.
- **A silently ignored query parameter is the real hazard.** Nothing in the current stack rejects
  unknown query parameters, so before this change `?routeId=7` was indistinguishable from omitting
  it. The M1 gate therefore checks the 400 on `routeId=0` explicitly, and the M2 empty-vs-404 case
  pins that a *valid* id is honoured rather than merely validated.
