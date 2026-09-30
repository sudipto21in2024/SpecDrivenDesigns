---
ticket: LOGI-0010
arm: architect
status: locked
created: 2026-09-30T06:46:42.141Z
depends_on_plans:
---

## 1. Objective
LOGI-0010 architect arm: specify F10 (assign shipment to route with BR-5 capacity check) in specs/features/LOGI-0010-assign-shipment-to-route.md and extend the API contract additively, ending in a human checkpoint. No src/** or tests/** work.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `specs/features/LOGI-0010-assign-shipment-to-route.md` | create | AC-1..AC-10 spec §§1-8 | ~230 |
| `contracts/v1/components/schemas/routes.yaml` | modify (additive only) | AssignShipmentToRouteRequest + RouteCapacityView |
| `contracts/v1/paths/routes-shipments.yaml` | create | POST/GET/DELETE /routes/{id}/shipments ops |
| `tools/contract/bundle.mjs` | modify (additive only) | register the new paths fragment in ORDER |
| `contracts/v1-openapi.yaml` | regenerate via `node tools/contract/bundle.mjs` (generated — never hand-edited) | bundled output of the two fragments above |
| `tools/contract/index.mjs` | modify (additive only) | extend `routes` resource slice with the sub-resource | +6/-0 |
| `state/plans/LOGI-0010-architect.plan.md` | modify | this plan (tick/lock) | ~60 |
| `memory/journal/LOGI-0010.md` | create | checkpoint + seal notes | ~45 |
| `state/events.jsonl` | append via CLI only | STEP_DONE bookkeeping | — |
| `state/handoffs.jsonl` | append via CLI only | architect→backend handoff | — |
| `state/tasks.json` | update via CLI only | status transitions | — |
| `memory/active.md` | update via CLI only | active state | — |
| `memory/progress.md` | update via CLI only | progress row | — |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0009-create-route.md` | §§3-8 via spec slicer | route lifecycle, Planned-only rule, driver scoping, O1-O4 defaults |
| `specs/features/LOGI-0007-create-shipment.md` | §§1-5 via spec slicer | shipment shape, Pending/Assigned states, at-risk projection |
| `specs/features/LOGI-0006-shipment-status-lifecycle.md` | AC section via spec slicer | BR-7 state machine + status-history row shape |
| `contracts/v1-openapi.yaml` | routes/shipments/vehicles slices only via contract slicer | additive patterns (x-roles, ProblemDetails, PagedResponse) |
| `tools/contract/index.mjs` | RESOURCES map range only | slice registration pattern for the sub-resource |
| `Docs/productInfo/11-BRD.md` | §6 BR-5/BR-6/BR-7 | authoritative rule text |
| `Docs/productInfo/12-PRD.md` | §3.3 F10 | feature statement (auto-transition to Assigned) |
| `Docs/productInfo/13-HLD.md` | §6 assign sequence | POST /routes/{id}/shipments + capacity-check flow |

## 4. Steps (each with verify gate)
- [x] 1. M1 — Author `specs/features/LOGI-0010-assign-shipment-to-route.md` per template `09-sample-feature-spec.md` §§1-8: summary (Dispatcher assigns a shipment to a Planned route; BR-5 capacity check; auto-transition Pending→Assigned with a status-history row), actors/roles (Admin/Dispatcher assign + unassign + read; Viewer read-only 403 on writes; Driver read own-route shipments only), preconditions, AC-1..AC-10 Given/When/Then — AC-1 happy path assign (200, `routeId` set, status `Assigned`, exactly one status-history row with actor + fromStatus Pending), AC-2 BR-5 capacity guard (assign into a route whose vehicle has insufficient remaining `capacityKg` → 409 ProblemDetails carrying current/added/capacity numbers, nothing written, default O1), AC-3 route must exist and be `Planned` (404 unknown route; 409 non-Planned naming the required status, default O2), AC-4 shipment must exist and be `Pending` (404; 409 already-assigned / terminal; re-assign to a different route → 409, same route is an idempotent 200, default O3), AC-5 validation 400 (missing/0/negative `shipmentId`, empty body), AC-6 unassign (DELETE /routes/{id}/shipments/{shipmentId} → 204, `routeId` null, status back to `Pending` with history row, capacity freed, default O4), AC-7 RBAC matrix (401 anonymous, 403 Viewer + Driver on writes, Driver read own-route only), AC-8 list shipments of a route (paged + running total / remaining capacity projection), AC-9 atomicity and concurrency (two concurrent boundary assigns — exactly one wins, the other 409, no negative overflow), AC-10 no-regression seam (LOGI-0006/0007/0009 behaviour unchanged; an assigned shipment reads back through the existing model with its new `routeId`); §5 out-of-scope explicit (route status transitions, board LOGI-0011, dashboard LOGI-0012, re-optimising, GPS); traceability convention `// LOGI-0010 AC-n` mandated → verify: spec slicer `show --ticket LOGI-0010 --section ac|summary` resolve, §§1-8 headings present, 10 AC headings.

- [x] 2. M2 — Extend `contracts/v1-openapi.yaml` additive-only (no existing path or schema body touched): `AssignShipmentToRouteRequest` (shipmentId integer >= 1, required), `RouteCapacityView` (vehicleId nullable, capacityKg nullable, assignedWeightKg, remainingCapacityKg nullable, shipmentCount — read-only projections), POST `/routes/{id}/shipments` (x-roles [Admin, Dispatcher]; 200 ShipmentResponse / 400 / 401 / 403 / 404 route-or-shipment / 409 capacity-exceeded | route-not-Planned | shipment-not-Pending | already-assigned), GET `/routes/{id}/shipments` (x-roles [Admin, Dispatcher, Viewer] + Driver own-only note; paged allOf PagedResponse, 200/401/403/404), DELETE `/routes/{id}/shipments/{shipmentId}` (x-roles [Admin, Dispatcher]; 204/400/401/403/404/409); register the sub-resource under the existing `routes` entry in `tools/contract/index.mjs` RESOURCES → verify: `npx -y @stoplight/spectral-cli lint contracts/v1-openapi.yaml --ruleset contracts/.spectral.yaml` → 0 errors; `git diff --stat contracts/` additions-only; operationIds `assignShipmentToRoute`/`listRouteShipments`/`removeShipmentFromRoute` unique (grep count 1 each); slicer `show --resource routes --fields x-roles` lists the 3 new ops and `--resource shipments|vehicles` unaffected.
- [ ] 3. M3 — Human checkpoint + seal: present spec+contract summary with the open defaults — O1 (capacity breach → 409 not 400; HLD §6 says 400 but the contract precedent for a rule violation is 409, defaulting to 409 with the alternative recorded), O2 (assign requires route `Planned`; in-progress routes reject new assignments), O3 (one route per shipment; move requires unassign first), O4 (unassign is a first-class DELETE returning the shipment to `Pending` because BR-7 has no reverse edge) — plus rejected alternatives; on approval set spec front matter `status: spec_approved`, write the `memory/journal/LOGI-0010.md` architect-arm section, `tracker seal` and HANDOFF architect→backend naming the backend scope (AssignShipmentToRouteCommand + capacity guard + unassign + `GET /routes/{id}/shipments` query; no new migration expected — `shipments.route_id` already exists per schema, backend to confirm) → verify: `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0010-architect.plan.md` → 0 errors; journal sealed; `tracker show --ticket LOGI-0010` → next=backend; `git status --short` shows only §2 manifest paths; one atomic commit `docs(LOGI-0010): architect — assign shipment to route spec (AC-1..AC-10) + route-shipments contract (steps 1-3/3)`.

## 5. Risks / open questions

### 5.1 Checkpoint decision record (decided 2026-09-30, BRD/PRD primacy)

Instruction applied: decide from the BRD (`Docs/productInfo/11-BRD.md` §6) first, then PRD F10, then HLD
§6, then contract precedent. Recorded here with pros and cons so the backend/QA arms inherit the
reasoning and not just the verdict.

**O1 — capacity breach status code → 409 Conflict (decided 409, overriding HLD §6's `400`).**
Basis: BR-5 states a *precondition on assignment* ("can only be assigned … if the sum … does not
exceed"), not an input-validation rule, and the BRD/PRD are silent on the code; contract precedent is
decisive and unanimous — every rule-state violation in v1 is 409 (LOGI-0009 AC-5 BR-3/BR-4
double-booking, LOGI-0006 AC-4 illegal transition), while 400 is reserved for malformed/unprocessable
input (`ValidationProblem` with a keyed `errors` map). HLD §6's `400` sits in a sequence diagram
illustrating *control flow*, not a status-code contract, so it is the weakest of the four sources.
- **Pro (409):** consistent, learnable API — clients branch on one rule-violation code; the `detail`
  carries the three numbers (assigned / adding / capacity) the UI needs for the capacity bar; a
  400 would invite client-side "fix the input and retry" handling that can never succeed. Matches the
  two shipped precedents, so QA can reuse the Conflict assertions verbatim.
- **Con:** a client that only special-cases 400 for rule violations mis-handles it, and the HLD
  diagram now disagrees with the contract — mitigated by recording the divergence here and in spec §7
  rather than silently diverging.
- **Rejected:** 400 per HLD §6 (breaks v1 uniformity, no keyed-errors shape to fill); 422 (no 422
  exists anywhere in `v1-openapi.yaml` — introducing it breaks RFC7807 uniformity).

**O2 — which route statuses accept an assignment → `Planned` only (decided Planned-only).**
Basis: BR-3/BR-4 (LOGI-0009) treat `Planned` *and* `InProgress` as "occupying" a vehicle/driver, which
makes `InProgress` the state where commitments are already locked; BR-5 is a load-fit rule and PRD F10
describes adding shipments while planning a trip, not amending a manifest in flight. LOGI-0009 AC-6
already fixes "assignment changes are Planned-only", so reusing it costs the domain no new rule.
- **Pro (Planned-only):** a route is a *plan* until it departs — after that the load is a physical
  fact, and letting a Dispatcher add 300kg to a van already under way makes the capacity figure a
  fiction the driver never sees; one consistent status gate is simpler to enforce in a single `if`
  and simpler to test than a two-state rule with an in-flight exception.
- **Con:** a late add (a customer calls after the truck leaves) is impossible through the API — the
  Dispatcher corrects out-of-band, which v1 accepts because route status transitions and cancellation
  are separate later tickets; if this becomes a pain point the natural fix is a *new* operation ("add
  to an in-progress route with driver acknowledgement"), not a relaxation of this one, because
  relaxing it needs a second capacity re-check and a manifest re-broadcast to the driver.
- **Rejected:** allow InProgress (no good failure mode when the capacity re-check fails mid-trip — the
  vehicle is already loaded, so the system can only report a violation it can no longer prevent).

- O1: capacity breach status code — **409** (ProblemDetails) by default. HLD §6 says `400 Problem Details
  (capacity exceeded)`, but the contract precedent (LOGI-0009 AC-5 double-booking → 409, LOGI-0006 illegal
  transition → 409) keeps 400 for malformed input, so a capacity rule violation is 409 with `detail` naming
  current weight / added weight / capacity. **Confirm at checkpoint.**
- O2: which route statuses accept assignments — default `Planned` only, mirroring LOGI-0009's Planned-only
  assignment rule (its AC-6). A route already `InProgress` is a trip under way → 409.
**O3 — moving an assigned shipment to another route → refused (409); unassign then assign.**
Basis: BR-5 is evaluated against *a* vehicle's `capacity_kg`; an implicit move would evaluate the weight
against two different vehicles in one call, and BRD BO-4 requires every shipment change to be
attributable in the audit trail.
- **Pro (refuse):** each assignment is one capacity check against one vehicle, so the guard is
  auditable and the two-step flow leaves two honest history rows (the release and the new booking)
  instead of one row that hides a vehicle change; the Dispatcher sees the intermediate unassigned
  state, which is exactly the "this shipment is not on any truck" situation worth noticing.
- **Con:** two calls and an intermediate state where a shipment is unassigned — a board reading
  between the two calls shows it as `Pending`, and a crash between them leaves it unassigned
  (recoverable, but visible). The idempotent same-route re-assign (200 no-op) removes the common
  double-click case.
- **Rejected:** implicit move (two capacity checks, one history row, and "which truck is this on"
  becomes ambiguous mid-trip — a direct BRD BO-4 traceability loss).

**O4 — what unassign does to the status → back to `Pending` via a first-class `Shipment.Unassign()`.**
Basis: BR-7 is exhaustive ("No other transition is permitted") and its table has no `Assigned → Pending`
edge, so routing the revert through the generic `Shipment.TransitionTo` would *extend BR-7 by
implementation* — a domain-rule change disguised as an endpoint. The shipment must not stay `Assigned`
either, because BR-6 scopes Driver action by "shipments assigned to their own routes" and an
`Assigned` shipment with a null route is a delivery nobody owns.
- **Pro (Pending, dedicated operation):** BR-7 stays literally true — the generic transition validator
  is untouched and LOGI-0006's test matrix keeps passing unchanged; the history row records
  `Assigned → Pending` with the acting user, so the audit trail distinguishes "a Dispatcher detached
  this" from any future status change; capacity is freed and immediately re-usable, which is the
  practical point of unassigning.
- **Con:** the state machine gains one edge that does not come from BR-7, so it must be documented as
  *assignment-domain* rather than *lifecycle* state movement (done in spec §6/§7) or a future reader
  will "fix" it by folding it into `TransitionTo`; the enum-legal transition list and the unassign
  operation must be kept in sync deliberately.
- **Rejected:** leave the shipment `Assigned` with a null route (breaks BR-6 driver scoping and
  strands it on the board); cancel it on unassign (cancelling is a business decision with its own
  endpoint and its own BR-7 edge, and must not be a side effect of detaching).

**Two further decisions taken on the same basis (recorded so they are not re-litigated downstream):**
- **Route with no vehicle → skip the BR-5 check, allow the assignment, report capacity as `null`.**
  BR-5 is conditioned on "the assigned vehicle's `capacity_kg`" — with no vehicle there is nothing to
  exceed, so the rule is vacuously satisfied. LOGI-0009 O3 deliberately allows a vehicle-less route
  ("unassigned lane") so planning can happen before the truck is chosen, and blocking here would
  reverse that decision one ticket later. `null` rather than `0` because `0` reads as "full truck" in
  every UI that renders the number. *Con to note:* a Dispatcher can therefore build an unverified
  load and discover the overflow only when the vehicle is attached, which is the correct trade for v1
  because the alternative blocks planning outright.
- **Capacity re-read inside the write transaction (serialise on the route row).** BR-5 is a check on
  the *sum*, and two assigns can read the same sum and both pass — a TOCTOU hole that would let the
  physical rule be violated by the API. SQLite serialises writers, so re-reading inside the
  transaction gives AC-9's exactly-one-winner for free. *Pro:* the invariant is enforced by the
  database rather than by hope. *Con:* one extra read per assign and a slightly wider transaction
  lock, and the guard must be written *inside* the transaction by discipline — a reviewer-visible
  requirement, hence AC-9 and the handoff note.

## 6. Exit gates
- Spec complete: §§1-8 present, AC-1..AC-10 Given/When/Then, traceability (`// LOGI-0010 AC-n`)
  mandated, §5 out-of-scope explicit, §7 open questions O1-O4 with rejected alternatives.
- Contract additive only, spectral 0 errors, 3 new ops carry `x-roles` + 400/401/403/404/409, camelCase
  schemas, no existing path or schema body modified.
- Slicer: `routes --fields x-roles` lists assignShipmentToRoute/listRouteShipments/removeShipmentFromRoute;
  `shipments` / `vehicles` / `drivers` slices unaffected.
- Checkpoint recorded in the journal (O1-O4 + rejected alternatives) and HANDOFF architect→backend with
  the backend scope named, including the concurrency serialisation requirement and the "no new migration
  expected — `shipments.route_id` already exists, backend to confirm" claim.
- `tracker show --ticket LOGI-0010` → next=backend; `git status` clean apart from §2 + derived state; one
  atomic commit for the arm.

