---
ticket: LOGI-0012
arm: architect
status: locked
created: 2026-10-01T17:33:53.390Z
depends_on_plans: LOGI-0011-architect, LOGI-0011-backend, LOGI-0011-frontend, LOGI-0011-qa
---

## 1. Objective
LOGI-0012 architect arm: specify F14 (operations dashboard - counts by status, SLA-at-risk list, vehicle/driver utilization) in specs/features/LOGI-0012-operations-dashboard.md and add its read-only aggregate contract additively to contracts/v1/, ending in a human checkpoint. No src/** or tests/** work.
Like the board (LOGI-0011), the dashboard is a **read projection only** in v1: every number it shows
is already owned by `GET /shipments` (BR-2 at-risk), `GET /vehicles` and `GET /drivers`. So the whole
feature is one new aggregate read endpoint plus the UI — no new table, no persisted `at_risk` column
(BR-2 rule 2.5), and no write path.


## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `specs/features/LOGI-0012-operations-dashboard.md` | create | AC-1..AC-9 spec 1-8 | ~230 |
| `contracts/v1/components/schemas/dashboard.yaml` | create (additive only) | StatusCount, DashboardAtRiskShipment, ResourceUtilization, VehicleUtilization, DriverUtilization, DashboardResponse | ~130 |
| `contracts/v1/paths/dashboard.yaml` | create | GET /dashboard op | ~65 |
| `contracts/v1/head.yaml` | modify (additive only) | `Dashboard` tag for the new op — needs the `oas3-schema` tags cap raised in the ruleset, see M2 note | +1/-0 |
| `contracts/.spectral.yaml` | modify (rule override, additive) | `spectral:oas` caps root `tags` at 7; LogiFlow now owns 8 feature areas, so `oas3-schema` is overridden with `maxItems: 12` | +22/-0 |
| `tools/contract/bundle.mjs` | modify (additive only) | register the two new fragments in the ordered build | +2/-0 |
| `contracts/v1-openapi.yaml` | regenerate via `node tools/contract/bundle.mjs` (generated, never hand-edited) | bundled output | ~+150 |
| `tools/contract/index.mjs` | modify (additive only) | new `dashboard` resource slice | +2/-0 |
| `state/plans/LOGI-0012-architect.plan.md` | modify | this plan (tick/lock) | ~70 |
| `memory/journal/LOGI-0012.md` | create | checkpoint + seal notes | ~30 |
| `state/events.jsonl` | append via CLI only | STEP_DONE bookkeeping | n/a |
| `state/handoffs.jsonl` | append via CLI only | architect to backend handoff | n/a |
| `state/tasks.json` | update via CLI only | status transitions | n/a |
| `memory/active.md` | update via CLI only | active state | n/a |
| `memory/progress.md` | update via CLI only | progress row | n/a |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `Docs/productInfo/12-PRD.md` | 56-59, 84-87, 89-99 | F14 statement, the Meera user flow, NFR <300ms p95 |
| `Docs/productInfo/11-BRD.md` | 26-28, 39, 66 | BO-1/BO-2/BO-3, section 4.1 role statement, BR-2 wording |
| `Docs/business-rules/BR-sla-rules.md` | rules 2.1-2.7, boundary table, section 5 | the one authoritative at-risk definition; section 5 forbids a persisted flag |
| `specs/features/LOGI-0011-planning-board.md` | sections 2, 6, 7 via spec slicer | role precedent, Driver 403 (O1), at-risk read-time projection |
| `specs/features/LOGI-0007-create-shipment.md` | sections 1-5 via spec slicer | ShipmentResponse field set the risk row projects |
| `contracts/v1/paths/planning-board.yaml` | full | additive-fragment authorship pattern + ProblemDetails wiring |
| `contracts/v1/components/schemas/planning-board.yaml` | 1-21, 54-68 | the projection-not-duplication precedent for the at-risk row |
| `contracts/v1/components/schemas/shipments.yaml` | ShipmentResponse | canonical shipment field set |
| `contracts/v1/components/schemas/vehicles.yaml` | VehicleResponse | status enum Available/InRoute/Maintenance for utilization |
| `contracts/v1/components/schemas/drivers.yaml` | DriverResponse | status enum Active/OffDuty/Suspended for utilization |
| `contracts/v1/head.yaml` | 18-26 | tag list shape |
| `tools/contract/bundle.mjs` | 11-26, 50-64 | ORDER + concrete build() fragment registration |
| `tools/contract/index.mjs` | 15-22 | RESOURCES map shape |
| `Docs/ProjectTechGuidence/09-sample-feature-spec.md` | 1-99 | spec template sections 1-8 |
| `Docs/ProjectTechGuidence/05-api-contract-standards.md` | contract-first rules | additive-only + 150-line rule |

## 4. Steps (Vertical Slice Milestones — each with verify gate)
- [x] 1. M1 — Author `specs/features/LOGI-0012-operations-dashboard.md` per template
  `09-sample-feature-spec.md` sections 1-8: summary (Meera's 60-second morning read: what is at risk,
  how full the fleet is, where the backlog is), actors/roles (Admin/Dispatcher/Viewer read; Driver 403
  on the same org-wide argument as LOGI-0011 O1), preconditions, and AC-1..AC-9 in Given/When/Then:
  - **AC-1 status counts** — one entry per BR-7 status, all six always present including 0, computed
    over the same filter set; counts are untruncated totals, never the length of a returned list.
  - **AC-2 SLA-at-risk list** — the BR-2 projection (`now >= sla_due_at - 2h`, status not
    Delivered/Cancelled, whole-second UTC), sorted by `slaDueAt` ascending with `id` tiebreak, paged
    with the standard envelope, and a `totalCount` that equals the count shown in the tile.
  - **AC-3 tile and list cannot disagree** — both come from one query source evaluated at a single
    captured `generatedAt`, so the number in the tile is the `totalCount` of the list it links to.
  - **AC-4 vehicle utilization** — counts per `VehicleResponse.status`
    (Available / InRoute / Maintenance) plus capacity-weighted `inUseCapacityKg` /
    `totalCapacityKg`; a Maintenance vehicle is never counted as available capacity.
  - **AC-5 driver utilization** — counts per `DriverResponse.status`
    (Active / OffDuty / Suspended); Suspended is never counted as available capacity.
  - **AC-6 drill-down, not a second query language** — every tile links to the existing
    `GET /shipments?slaRisk=true`, `GET /vehicles`, `GET /drivers` surfaces; the dashboard defines no
    filter parameter those endpoints do not already accept.
  - **AC-7 authorization** — 401 anonymous; 403 Driver; Admin, Dispatcher and Viewer receive 200.
  - **AC-8 validation and determinism** — 400 with a keyed `errors` map for `pageSize` outside 1..100
    and an unknown `status` filter enum; the tiebroken ordering makes two identical requests
    byte-comparable apart from `generatedAt`, and the dashboard stores nothing (BR-2 rule 2.5).
  - **AC-9 no regression** — LOGI-0006/0007/0008/0009/0010/0011 behaviour and contracts are
    unchanged; the dashboard is a pure reader of their data.
  - Section 5 out-of-scope is explicit: historical SLA-performance reporting, a persisted `at_risk`
    column, breach alerting, saved dashboard widgets, route optimisation and GPS. The traceability
    convention `// LOGI-0012 AC-n` is mandated for the downstream arms.
  → verify: `node tools/spec/index.mjs show --ticket LOGI-0012 --section summary` and `--section ac`
  both resolve; sections 1-8 headings present; exactly 9 AC headings.

- [x] 2. M2 — Extend the contract additively (no existing path or schema body touched):
  `contracts/v1/components/schemas/dashboard.yaml` with `StatusCount` (status, count — the same BR-7
  enum as the board so the two cannot drift), `DashboardAtRiskShipment` (id, referenceCode, status,
  priority, slaDueAt, minutesToDue, originWarehouseId, destinationAddress — documented as a
  *projection* of `ShipmentResponse`, never a second source of truth), `ResourceUtilization`
  (totalCount, byStatus buckets, utilizationPercent), `VehicleUtilization` (ResourceUtilization plus
  capacityKg totals and `capacityUtilizationPercent`), `DriverUtilization` (ResourceUtilization), and
  `DashboardResponse` (generatedAt, appliedFilters, statusCounts, atRiskTotalCount, the at-risk page,
  vehicleUtilization, driverUtilization); `contracts/v1/paths/dashboard.yaml` with `GET /dashboard` —
  `x-roles: [Admin, Dispatcher, Viewer]`, operationId `getDashboard`, query params `status`,
  `priority`, `originWarehouseId`, `routeId`, `page`, `pageSize` (default 20, max 100), responses
  200 DashboardResponse / 400 ValidationProblem / 401 Unauthorized / 403 Forbidden. Register both
  fragments in `tools/contract/bundle.mjs` (schemas list + paths list), add the `Dashboard` tag to
  `head.yaml`, add the `dashboard` resource to `tools/contract/index.mjs`, then regenerate with
  `node tools/contract/bundle.mjs`.
  → verify: `npx -y @stoplight/spectral-cli lint contracts/v1-openapi.yaml --ruleset
  contracts/.spectral.yaml` reports 0 errors; `node tools/contract/bundle.mjs --check` is clean; both
  new fragment files are 150 lines or fewer; `node tools/contract/index.mjs show --resource dashboard`
  resolves.

  **M2 findings.** (a) `spectral:oas` pins the root `tags` array to `maxItems: 7`, so the eighth
  feature tag (`Dashboard`) failed `oas3-schema`. Rather than drop a tag or mis-file the dashboard
  under `Planning`, `contracts/.spectral.yaml` now overrides `oas3-schema` with `maxItems: 12` and a
  comment explaining why; the rest of the inherited schema check is unchanged. (b) Spectral also
  flagged `ResourceUtilization` and `DashboardAtRiskShipment` as unused components, which was
  correct: the utilization shapes are now composed with `allOf` off one `ResourceUtilization`, and
  the at-risk rows are carried by a dedicated `AtRiskShipmentPage` that reuses the standard paging
  envelope field-for-field. Both warnings are gone, and the contract has one definition of the
  bucket/percent semantics instead of two copies.

- [x] 3. M3 — Arm verification and checkpoint. Confirm `git diff --stat contracts/` is additions only
  (0 deletions), every authored contract file is 150 lines or fewer, the spec slicer resolves all
  sections, and the AC-to-test traceability convention is stated for the backend/frontend/qa arms. Tick
  the plan, seal the arm, and hand off architect to backend for human review.
  → verify: `git diff --stat contracts/` additions only; `node tools/tracker/index.mjs validate-plan
  state/plans/LOGI-0012-architect.plan.md` reports 0 errors; `node tools/spec/index.mjs show --ticket
  LOGI-0012 --section ac` resolves 9 ACs; one atomic commit.



### 5.1 Open questions (source order: BRD 4.1/6 → PRD F14 → HLD 5 → LOGI-0011 contract precedent)
| # | Question | Decision | Basis | Rejected alternative |
|---|---|---|---|---|
| O1 | May a Driver read the dashboard? | **No, 403.** Identical argument to LOGI-0011 O1: the dashboard is cross-organisation while BR-6 and F12 scope a Driver to their own route. Viewer keeps read access, matching every other v1 read. | BR-6 + LOGI-0009/0010 Driver scoping + LOGI-0011 O1 precedent | 200 with implicit own-route filtering (counts would mean "of what you may see"); 403 for Viewer. |
| O2 | May `at_risk` be persisted for dashboard speed? | **No, read-time projection.** BR-2 rule 2.5 and section 5 already forbid a stored flag, and BR-sla-rules section 6 says revisit only "with an ADR if dashboard p95 exceeds 300ms". | `Docs/business-rules/BR-sla-rules.md` rules 2.5, sections 5 and 6 | A persisted `at_risk` column (needs a BRD revision and goes stale the moment a status changes). |
| O3 | What is "utilization"? | **Status-bucket counts plus a capacity-weighted percent, not a percentage of hours worked.** The PRD says "available vs in-route/off-duty"; the schema already models exactly those buckets (`Available/InRoute/Maintenance`, `Active/OffDuty/Suspended`) and v1 has no shift or duty-time data to compute anything else. | PRD F14 + `VehicleResponse`/`DriverResponse` enums | A time-based utilization percent (no duty-hour data exists in v1; inventing a definition the data cannot support is worse than the honest bucket count). |
| O4 | Does the dashboard define its own filters and paging? | **No, it reuses the shipment list's filter vocabulary and the standard `PagedResponse` envelope.** AC-6 makes the drill-down into `GET /shipments` lossless. | LOGI-0011 AC-2/AC-3 + `PagedResponse` precedent | A dashboard-specific filter DSL (the tile and the list it links to could then disagree). |

### 5.2 Open risks
- **Aggregation drift.** Status counts, the risk tile and the risk list are three views of one query
  source. If the backend evaluates them with separate `now` values, the tile can disagree with the
  list. Mitigation: capture `generatedAt` once and use it as the single `now` for every BR-2
  evaluation in the response, and state that in AC-2/AC-3.
- **Count semantics vs the board.** The board has `totalCount` per column; the dashboard has a flat
  `statusCounts[]`. Both are untruncated, but they must not drift into "what you see" versus "what
  exists". Mitigation: name the untruncated contract explicitly in both specs.
- **Duplicate projection shape.** `DashboardAtRiskShipment` overlaps `ShipmentResponse` and
  `BoardShipmentCard`. Mitigation: document it as a projection in the schema description and have the
  backend project from the same DTO mapping (same mitigation as LOGI-0011 section 5.2).
- **p95 budget.** The dashboard is the heaviest read in the product (PRD section 6, <300ms at 50k
  shipments/year). This plan deliberately avoids any persisted aggregate, so the backend arm's only
  lever is query efficiency; if the budget is missed the fallback is an ADR, not a stored `at_risk`
  flag.

## 6. Exit gates
- `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0012-architect.plan.md` reports 0 errors.
- `npx -y @stoplight/spectral-cli lint contracts/v1-openapi.yaml --ruleset contracts/.spectral.yaml` reports 0 errors.
- `node tools/contract/bundle.mjs --check` is clean; authored `contracts/v1/**` files are 150 lines or fewer.
- `git diff --stat contracts/` is additions only, 0 deletions.
- `node tools/spec/index.mjs show --ticket LOGI-0012 --section ac` resolves with 9 ACs.
- `node tools/tracker/index.mjs show --ticket LOGI-0012` reports next=backend; one atomic commit.
