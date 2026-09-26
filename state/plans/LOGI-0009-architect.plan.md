---
ticket: LOGI-0009
arm: architect
status: locked
created: 2026-09-26T13:45:57.557Z
depends_on_plans:
---

## 1. Objective
LOGI-0009 architect arm: specify F-create-route (create route + assign vehicle/driver, PRD route planning) in specs/features/LOGI-0009-create-route.md (ACs + defaults) and extend the API contract additively (POST/GET /routes + GET/PATCH /routes/{id} with vehicle_id/driver_id assignment semantics, x-roles Admin/Dispatcher + Viewer read) plus the contract slicer routes resource, ending in a human checkpoint. No src/** or tests/** work in this arm.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `specs/features/LOGI-0009-create-route.md` | create | AC-1..AC-10 spec §§1-8 | ~220 |
| `contracts/v1-openapi.yaml` | modify (additive only) | RouteRequest/RouteResponse + /routes ops | +90/-0 |
| `tools/contract/index.mjs` | modify (additive only) | register `routes` resource slice | +10/-0 |
| `state/plans/LOGI-0009-architect.plan.md` | modify | this plan (tick/lock) | ~60 |
| `memory/journal/LOGI-0009.md` | create | checkpoint + seal notes | ~40 |
| `state/events.jsonl` | append via CLI only | STEP_DONE bookkeeping | — |
| `state/handoffs.jsonl` | append via CLI only | architect→backend handoff | — |
| `state/tasks.json` | update via CLI only | status transitions | — |
| `memory/active.md` | update via CLI only | active state | — |
| `memory/progress.md` | update via CLI only | progress row | — |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0008-edit-cancel-shipment.md` | §§7-8 only via spec slicer | AC style + traceability convention to mirror |
| `contracts/v1-openapi.yaml` | shipments/vehicles/drivers slices only via contract slicer | additive patterns (x-roles, ProblemDetails, camelCase) |
| `tools/contract/index.mjs` | RESOURCES map range only | slice registration pattern for new `routes` resource |

## 4. Steps (each with verify gate)
- [x] 1. M1 — Author `specs/features/LOGI-0009-create-route.md` per template §§1-8: summary (Dispatcher creates route, assigns vehicle+driver), actors/roles, data (route: name/code, date, vehicle_id FK, driver_id FK, status Planned), AC-1..AC-10 Given/When/Then (create 201, validation 400, vehicle/driver existence 422-or-404 default O1, double-booking conflict 409 default O2, roles Admin/Dispatcher create+assign / Viewer read / Driver read-own, delete-when-referenced 409 enforcement now live per LOGI-0004/0005 deferrals, capacity deferred to LOGI-0010), §5 out-of-scope explicit (shipment→route assignment, kanban, dashboard), traceability convention (`// LOGI-0009 AC-n`) mandated → verify: spec slicer sections ac/summary resolve, §§1-8 present.
- [x] 2. M2 — Extend `contracts/v1-openapi.yaml` additive-only (no existing path/schema touched): `RouteRequest` (name 1..200, routeDate date, vehicleId/driverId uuid nullable for create-unassigned default O3), `RouteResponse` (+ status enum Planned/InProgress/Completed), POST /routes (Admin/Dispatcher, 201/400/401/403/404-or-422/409), GET /routes (Admin/Dispatcher/Viewer + Driver own-only note), GET/PATCH /routes/{id} (assign/reassign vehicle/driver; 200/400/401/403/404/409); register `routes` in `tools/contract/index.mjs` RESOURCES → verify: `spectral lint` 0 errors, `git diff -- contracts/` additions-only, slicer `show --resource routes --fields x-roles` lists new ops and shipments/vehicles/drivers slices unaffected.
- [x] 3. M3 — Human checkpoint + seal: present spec+contract summary with O1 (missing vehicle/driver → 404), O2 (same vehicle/driver overlapping date → 409), O3 (allow null vehicle/driver at create; assignment via PATCH), O4 (Driver list own-routes only, enforced backend LOGI-0009) + rejected alternatives; record in journal; `validate-plan` 0 errors → verify: checkpoint recorded, HANDOFF architect→backend written naming backend scope (Route entity + vehicle/driver FKs + overlap guard; migration creates routes table; enforces deferred vehicle/driver 409s).

## 5. Risks / open questions
- O1: unknown vehicle_id/driver_id → 404 (vs 422) — default 404 mirroring shipments/warehouse pattern; confirm at checkpoint.
- O2: double-booking rule scope — BRD BR-3/BR-4 + PRD F9 say "overlapping planned time windows",
  and schema §routes carries planned_start/planned_end (not a single date). Default: 409 on
  **interval overlap** (plannedStart < other.plannedEnd AND other.plannedStart < plannedEnd) for the same
  vehicle/driver while both routes are Planned/InProgress; terminal routes never conflict.
  My earlier "same routeDate" plan shorthand was wrong — corrected here per BRD primacy.
- O3: unassigned route allowed — default yes (nullable FKs) so planning board (LOGI-0011) can show unassigned lane.
- Deferred 409s from LOGI-0004/0005 become enforceable once routes FKs exist — backend must add the checks.

## 6. Exit gates
- Spec complete: §§1-8 present, AC-1..AC-10 Given/When/Then, traceability (`// LOGI-0009 AC-n`) mandated, §5 out-of-scope explicit.
- Contract additive only, spectral 0 errors, new ops carry x-roles + 400/401/403/404/409, camelCase schemas.
- Slicer: `routes` x-roles lists new ops; vehicles/drivers/shipments slices unaffected.
- Checkpoint in journal (O1-O4 + rejected alternatives) and HANDOFF architect→backend; backend scope named (no migration-free claim).
- `tracker show --ticket LOGI-0009` → next=backend; `git status` clean apart from derived state; one atomic commit for the arm.

