---
ticket: LOGI-0011
arm: architect
status: locked
created: 2026-09-30T15:55:33.243Z
depends_on_plans: LOGI-0010-architect, LOGI-0010-backend, LOGI-0010-frontend, LOGI-0010-qa
---

## 1. Objective
LOGI-0011 architect arm: specify F11 (planning board — kanban by shipment status + list view,
filterable) in `specs/features/LOGI-0011-planning-board.md` and add its read-only aggregate contract
additively to `contracts/v1/`, ending in a human checkpoint. No `src/**` or `tests/**` work.

The board is a **read projection only** in v1: it renders what `GET /shipments` and `GET /routes`
already own, so the whole feature is one new aggregate read endpoint plus the UI. No writes, no
drag-and-drop mutation, no migration expected (`shipments.route_id` and the status enum already
exist).

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `specs/features/LOGI-0011-planning-board.md` | create | AC-1..AC-10 spec §§1-8 | ~240 |
| `contracts/v1/components/schemas/planning-board.yaml` | create (additive only) | BoardShipmentCard, BoardRouteCard, BoardColumn, PlanningBoardResponse | ~110 |
| `contracts/v1/paths/planning-board.yaml` | create | GET /planning-board op | ~70 |
| `contracts/v1/head.yaml` | modify (additive only) | `Planning` tag for the new op | +1/-0 |
| `tools/contract/bundle.mjs` | modify (additive only) | register the two new fragments in ORDER | +3/-0 |
| `contracts/v1-openapi.yaml` | regenerate via `node tools/contract/bundle.mjs` (generated — never hand-edited) | bundled output | ~+130 |
| `tools/contract/index.mjs` | modify (additive only) | new `planning` resource slice | +2/-0 |
| `state/plans/LOGI-0011-architect.plan.md` | modify | this plan (tick/lock) | ~60 |
| `memory/journal/LOGI-0011.md` | create | checkpoint + seal notes | ~30 |
| `state/events.jsonl` | append via CLI only | STEP_DONE bookkeeping | — |
| `state/handoffs.jsonl` | append via CLI only | architect→backend handoff | — |
| `state/tasks.json` | update via CLI only | status transitions | — |
| `memory/active.md` | update via CLI only | active state | — |
| `memory/progress.md` | update via CLI only | progress row | — |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0010-assign-shipment-to-route.md` | §§2-8 via spec slicer | role matrix, `routeId` seam, capacity projection, O1-O4 defaults |
| `specs/features/LOGI-0007-create-shipment.md` | §§1-5 via spec slicer | shipment shape, atRisk read-time projection (BR-2) |
| `specs/features/LOGI-0009-create-route.md` | §§1-5 via spec slicer | route lifecycle + Driver own-route scoping rule |
| `contracts/v1/paths/routes-shipments.yaml` | full | additive-fragment authorship pattern + ProblemDetails wiring |
| `contracts/v1/components/schemas/shipments.yaml` | 72-92 | ShipmentResponse field set the board card projects |
| `contracts/v1/components/schemas/routes.yaml` | 30-42, 69-96 | RouteResponse + RouteCapacityView (reused, not redefined) |
| `contracts/v1/head.yaml` | 20-30 | tag list shape |
| `tools/contract/bundle.mjs` | 11-24 | ORDER registration pattern |
| `tools/contract/index.mjs` | 15-22 | RESOURCES map shape |
| `Docs/productInfo/11-BRD.md` | §3 BO-3, §4.1 | board is in scope v1; dispatcher-time objective |
| `Docs/productInfo/12-PRD.md` | §3.3 F11 | authoritative feature statement |
| `Docs/ProjectTechGuidence/09-sample-feature-spec.md` | 1-99 | spec template §§1-8 |
| `Docs/ProjectTechGuidence/05-api-contract-standards.md` | contract-first rules | additive-only + 150-line rule |

## 4. Steps (each with verify gate)
- [x] 1. M1 — Author `specs/features/LOGI-0011-planning-board.md` per template `09-sample-feature-spec.md` §§1-8: summary (Dispatcher works the day from a board: kanban columns = shipment status, plus a list view over the same data, no writes), actors/roles (Admin/Dispatcher full read; Viewer read; Driver excluded from the org-wide board — see O1), preconditions, and AC-1..AC-10 in Given/When/Then:
  - **AC-1 kanban columns** — one column per BR-7 status in the server-supplied fixed order; every non-terminal shipment appears in exactly one column; each column carries a `totalCount` that is the *untruncated* count for that column.
  - **AC-2 list view** — the same filter set over the same data, flattened to one list, sortable by `slaDueAt` or `createdAt` (asc/desc), paginated with the standard envelope.
  - **AC-3 filters compose** — `status`, `priority`, `originWarehouseId`, `slaRisk`, `routeId`, `q` are each optional and AND-combined; the applied filter set is echoed in the response so the UI can render and restore the active filters.
  - **AC-4 route cards and the BR-5 capacity bar** — each route card reuses `RouteCapacityView`; `capacityKg` null ⇒ the bar reads "no vehicle assigned" and is never drawn as 0/full.
  - **AC-5 unassigned lane** — shipments with `routeId` null are visible on the board and are not excluded by the route filter; the board never invents a synthetic backlog route.
  - **AC-6 authorization** — 401 anonymous; 403 Driver; Admin, Dispatcher and Viewer receive 200.
  - **AC-7 the board is read-only** — no board control changes state; status transitions (BR-7, LOGI-0006) and assign/unassign (BR-5, LOGI-0010) remain reachable only on the shipment and route surfaces.
  - **AC-8 validation and bounds** — 400 with a keyed `errors` map for `pageSize` outside 1..100, `maxPerColumn` outside its range, and unknown `status`/`priority` enum values; a truncated column sets an explicit `truncated` flag rather than silently dropping cards.
  - **AC-9 determinism** — column order and intra-column card order are stable (default `slaDueAt` ascending, `id` as tiebreak) so paging can neither duplicate nor drop a card; the board is computed from the same query source as the shipment list, not a cached copy.
  - **AC-10 no regression** — LOGI-0006/0007/0008/0009/0010 behaviour and contracts are unchanged; the board is a pure reader of their data.
  - §5 out-of-scope is explicit: drag-and-drop status change, auto-assign, route optimisation, GPS, the LOGI-0012 dashboard, and saved/personal filters. Traceability convention `// LOGI-0011 AC-n` is mandated for the downstream arms.
  → verify: `node tools/spec/index.mjs show --ticket LOGI-0011 --section summary` and `--section ac` both resolve; §§1-8 headings present; exactly 10 AC headings.

- [x] 2. M2 — Extend the contract additively (no existing path or schema body touched): `contracts/v1/components/schemas/planning-board.yaml` with `BoardShipmentCard` (id, referenceCode, status, priority, weightKg, slaDueAt, atRisk, routeId nullable, originWarehouseId, destinationAddress — documented as a *projection* of `ShipmentResponse` so it never becomes a second source of truth), `BoardRouteCard` (id, name, status, vehicleId nullable, driverId nullable, plannedStart, plannedEnd, plus `capacity` reusing the existing `RouteCapacityView` by `$ref`), `BoardColumn` (status, totalCount, truncated, cards), and `PlanningBoardResponse` (generatedAt, applied filter echo, columns, unassignedTotalCount, routes); `contracts/v1/paths/planning-board.yaml` with `GET /planning-board` — `x-roles: [Admin, Dispatcher, Viewer]`, operationId `getPlanningBoard`, query params `status`, `priority`, `originWarehouseId`, `slaRisk`, `routeId`, `q`, `sort`, `maxPerColumn` (default 50, max 200), responses `200` PlanningBoardResponse / 400 ValidationProblem / 401 Unauthorized / 403 Forbidden; register a `Planning` tag in `contracts/v1/head.yaml`; register both fragments in `tools/contract/bundle.mjs` ORDER (schemas before `components/responses.yaml`, the path after `paths/routes-shipments.yaml`).
  → verify: `npx -y @stoplight/spectral-cli lint contracts/v1-openapi.yaml --ruleset contracts/.spectral.yaml` → 0 errors; `node tools/contract/bundle.mjs --check` clean; every authored `contracts/v1/**` file ≤150 lines; `git diff --stat contracts/` shows additions and **0 deletions**.

- [x] 3. M3 — Register the slicer slice and close the arm at the checkpoint: add `planning: { schemas: [...], paths: ['/planning-board'] }` to `RESOURCES` in `tools/contract/index.mjs`; record the checkpoint decision record (O1 Driver exclusion, O2 fixed column order, O3 board is read-only) with pros/cons in §5.1 and in spec §7; set the spec front matter to `status: spec_approved`; write the `memory/journal/LOGI-0011.md` architect-arm section; `tracker seal` and HANDOFF architect→backend naming the backend scope (one `GetPlanningBoardQuery` + the `GET /planning-board` endpoint + the O1 authorization decision; no migration and no write path).
  → verify: `node tools/contract/index.mjs show --resource planning --fields x-roles` resolves the single op and `--fields params` lists the query params, while `show --resource shipments` and `show --resource routes` are byte-identical to a pre-arm capture (additive proof); `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0011-architect.plan.md` → 0 errors; `node tools/tracker/index.mjs show --ticket LOGI-0011` → next=backend; `git status --short` shows only §2 manifest paths; one atomic commit `docs(LOGI-0011): architect — planning board spec (AC-1..AC-10) + GET /planning-board contract`.


## 5. Risks / open questions

### 5.1 Checkpoint decision record (to be decided 2026-09-30, BRD/PRD primacy)
Instruction applied: decide from BRD §4.1 first, then PRD F11, then HLD §5, then contract precedent
(`x-roles` unanimity across v1), and record pros/cons so the backend and frontend arms inherit the
reasoning and not just the verdict.

**O1 — Driver access to the org-wide board (pending; leaning 403).**
The board is cross-organisation — every shipment and every route — while BR-6 and the LOGI-0009 /
LOGI-0010 Driver rule both scope a Driver to *their own* route's shipments only. A 200 for a Driver
would require inventing an implicit filter the contract never describes, and the column `totalCount`s
would be wrong for a Driver either way. Leaning **403 for Driver on `GET /planning-board`**, leaving
the Driver's own surface to F12.
- **Pro (403):** consistent with every other Driver-scoped read in v1; no implicit-filter contract
  gap; a clear denial beats an empty board that looks like a bug; a 200 would need a second set of
  `totalCount` semantics that means "of the shipments you may see", not "of the column".
- **Con:** a Driver who has just been assigned work hits a wall on the page Dispatchers use daily.
  Mitigations: the driver nav never shows the board, F12 "My routes" is the Driver's equivalent, and
  a follow-up ticket can add an explicit `mine=true` scoping.
- **Rejected:** 200 with implicit own-route filtering (undocumented, untestable counts); 403 for
  Viewer (Viewer is read-allowed everywhere in v1 and BRD §4.1 does not exclude it from the board).

**O2 — column set and order (pending; leaning all six BR-7 statuses, fixed server order).**
PRD F11 says "columns = shipment status". Leaning all six statuses in BR-7 lifecycle order (Pending,
Assigned, InTransit, Delivered, Delayed, Cancelled), with Delivered and Cancelled collapsed behind a
per-column "show terminal" toggle so a working board is not dominated by finished work.
- **Pro:** a server-supplied order means the UI never guesses; hiding terminal columns at the API
  level would make Cancelled shipments — which exist and matter for the audit trail (BO-4) —
  invisible; merging into Open / InTransit / Done would contradict PRD F11.
- **Con:** six columns is wide at 1280px, and the collapse toggle is a UI default rather than an API
  flag (the API must not encode a screen-size decision).

**O3 — the board is a read-only projection (pending; leaning yes).**
Leaning **no write operations in v1**: drag-and-drop would be a status transition (BR-7, LOGI-0006)
and drop-onto-route would be an assign (BR-5, LOGI-0010), both of which already own their guards and
history rows.
- **Pro:** the board reuses the delivered guards verbatim instead of duplicating them; the QA arm can
  assert the board is GET-only, which is a cheap high-value regression test; no new history semantics.
- **Con:** drag-to-advance-status is the obvious gesture a user will try. Mitigated by naming it in
  §5 out-of-scope with a follow-up, and by the card linking to the shipment detail where the
  transition control already lives.
- **Rejected:** `PATCH /planning-board/{shipmentId}` (a second entry point to BR-7, guarded twice);
  optimistic UI with a local status flip (a board showing state the server never accepted is exactly
  the failure this ticket exists to prevent).

### 5.2 Open risks
- **Card shape duplication.** `BoardShipmentCard` is a subset of `ShipmentResponse`; if the fields
  drift, the board and the shipment list will disagree. Mitigation: document the card as a projection
  and have the backend project from the same DTO mapping.
- **`totalCount` vs truncation.** AC-8's explicit `truncated` flag is load-bearing, not cosmetic: if a
  column is truncated without it, the UI can neither show "50 of 312" nor offer a correct load-more.
- **Driver-scope helper.** LOGI-0010's backend journal deferred extracting the shared Driver
  read-scoping helper to "the arm that adds the third call site". If O1 lands on 403 the board adds no
  such call site and the deferral stands until a genuine third one appears (F12).

## 6. Exit gates
- `node tools/tracker/index.mjs validate-plan state/plans/LOGI-0011-architect.plan.md` → 0 errors.
- `npx -y @stoplight/spectral-cli lint contracts/v1-openapi.yaml --ruleset contracts/.spectral.yaml` → 0 errors.
- `node tools/contract/bundle.mjs --check` clean; authored `contracts/v1/**` files ≤150 lines.
- `git diff --stat contracts/` → additions only, 0 deletions.
- `node tools/spec/index.mjs show --ticket LOGI-0011 --section ac` resolves with 10 ACs.
- `node tools/tracker/index.mjs show --ticket LOGI-0011` → next=backend; one atomic commit.

