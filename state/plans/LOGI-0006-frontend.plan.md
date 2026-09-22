---
ticket: LOGI-0006
arm: frontend
status: done
created: 2026-09-22T11:14:24.561Z
depends_on_plans:
---

## 1. Objective
Frontend seam for BR-7: regenerate typed client from the shipments contract slice and add api client methods + types + MSW handlers + permissions for status-transitions/status-history. No screens (LOGI-0007/0008 land those); nothing frontend-blocking beyond the seam.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/api/schema.d.ts` | regenerate | `npm run generate:api` from the contract — StatusTransitionRequest/ShipmentStatusEvent + the two /shipments paths (AC-1..AC-8) | 0 (regen) |
| `src/frontend/src/api/client.ts` | modify | `ShipmentStatus`/`ShipmentStatusEvent`/`StatusTransitionRequest` types + `transitionShipmentStatus`/`listShipmentStatusHistory` methods (no shipment CRUD — LOGI-0007) — AC-1..AC-8 | ~30 |
| `src/frontend/src/features/auth/permissions.ts` | modify | `transitionShipments` (x-roles Admin/Dispatcher/Driver, AC-8) + `viewShipmentHistory` (all four roles, AC-8) | ~8 |
| `src/frontend/src/mocks/handlers.ts` | modify | `shipmentsDb` + `resetShipmentsDb` + MSW handlers for both endpoints: bearer 401, role matrix (Driver CAN transition, Viewer cannot — AC-8), 404 unknown id (AC-6), BR-7 legal map with 409 ProblemDetails naming legal next states (AC-2/3/4), paged history oldest-first (AC-7), event echo (AC-1) | ~140 |
| `src/frontend/src/test/renderApp.tsx` | modify | `resetMocks` also clears `shipmentsDb` | ~1 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0006-shipment-status-lifecycle.md` | full | AC-1..AC-8 source of truth, §2 role matrix, §5 out-of-scope (no screens here) |
| contract:shipments (x-roles, schemas, params) | slice | x-roles per op (transitions [Admin,Dispatcher,Driver]; history [+Viewer]); StatusTransitionRequest (toStatus enum + nullable note ≤500); ShipmentStatusEvent (id, fromStatus nullable, toStatus, changedByUserId, changedAt, note); path id int64; history query page/pageSize (default 25, max 100). NOTE: RESOURCES in `tools/contract/index.mjs` lacks `shipments` — resolve slice via `grep -n "shipments\|ShipmentStatus\|StatusTransition" contracts/v1-openapi.yaml` (targeted line ranges only), never whole-file reads |

## 4. Steps (each with verify gate)
- [x] 1. Regenerate the typed client: `npm run generate:api` in `src/frontend`; confirm the diff contains ONLY the shipments additions (StatusTransitionRequest, ShipmentStatusEvent, /shipments/{id}/status-transitions + /status-history ops) — no unrelated hunks (report if any) → verify: `git diff --stat src/frontend/src/api/schema.d.ts` shipments-only; `npx tsc --noEmit` clean
- [x] 2. Client seam in `src/frontend/src/api/client.ts`: export `ShipmentStatus`, `ShipmentStatusEvent`, `StatusTransitionRequest` type aliases (schema-derived, same style as Driver types) + `api.transitionShipmentStatus(id, body): Promise<ShipmentStatusEvent>` (POST) + `api.listShipmentStatusHistory(id, page?, pageSize?): Promise<Paged<ShipmentStatusEvent>>` (GET, oldest first). No shipment CRUD/list methods — LOGI-0007 owns those → verify: `npx tsc --noEmit` clean
- [x] 3. Permissions in `src/frontend/src/features/auth/permissions.ts`: `transitionShipments` (Admin/Dispatcher/Driver — Driver ownership scoping deferred to LOGI-0009/0010 per spec §2/§7) + `viewShipmentHistory` (all roles). UX convenience only; server is the authority → verify: `npx tsc --noEmit` clean; `npm test` existing suites still green
- [x] 4. Mock seam in `src/frontend/src/mocks/handlers.ts` + `renderApp.tsx`: `shipmentsDb` (id, referenceCode, status, statusHistory: ShipmentStatusEvent[]), `resetShipmentsDb`, both handlers mirroring the contract (401 anonymous; transitions 403 for Viewer, allowed Driver; history 200 for Viewer; 404 unknown shipment; 409 with ProblemDetails.detail listing legal next states for illegal BR-7 jumps; rejected transitions never recorded; note echoed verbatim; paged envelope oldest-first); `resetMocks` clears the shipment store → verify: `npm test` full existing suite green (warehouse + auth + vehicle + driver); `npx tsc --noEmit` clean
- [x] 5. Seal: journal frontend-arm section (what/gates/findings/next), commit manifest-exact, plan status done, `tracker handoff --ticket LOGI-0006 --from frontend --to qa`, update `memory/active.md` via tracker commands → verify: `git status --short` clean except state/memory artifacts; all §4 steps ticked

## 5. Risks / open questions
- **No UI in this arm (by design):** screens land with LOGI-0007/0008 (spec §5 + backend handoff). The seam (types + client + mocks + permissions) is the deliverable; UI vitest coverage is deferred to those tickets, and the qa arm covers AC-1..AC-8 e2e against the real API.
- **No shipments contract resource in the slicer:** `tools/contract/index.mjs` RESOURCES lacks `shipments` (tooling gap, outside this arm's boundary). §3 documents the grep-fallback; adding the resource is an orchestrator/tooling follow-up.
- **Driver-role asymmetry is deliberate:** unlike /drivers (Driver fully excluded) and the shared `roleRules` map (Driver write=false), shipment transitions ALLOW Driver per contract x-roles — the mock must ship a dedicated `shipmentTransitionRules` map, NOT reuse `roleRules`/`driverRoleRules`. Viewer: history yes, transitions 403.
- **fromStatus null:** the initial history entry has `fromStatus: null`; the mock seeds a creation event per shipment so AC-7 paging is deterministic. Rejected transitions never append (AC-4/AC-5 invariant).
- `generate:api` regenerates the whole file: keep only shipments hunks if unrelated drift appears (none expected — the committed schema matches the contract as of the backend seal).

## 6. Exit gates
- `npx tsc --noEmit` clean in `src/frontend`; `npm test` full suite green (existing warehouse + auth + vehicle + driver suites); `npm run build` succeeds.
- `npm run generate:api` leaves `api/schema.d.ts` byte-identical (contract stays the single source of truth).
- Mock honours the full AC-8 role matrix (401 anonymous / 403 Viewer transition / Driver CAN transition / Viewer CAN read history) and the BR-7 409 detail names the legal next states.
- No screens, no routes, no shipment CRUD in the client (LOGI-0007/0008 scope); no backend, contract or `tests/e2e` file touched (arm boundary); only §2 paths + journal/state/memory committed.
