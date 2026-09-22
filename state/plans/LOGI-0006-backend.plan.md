---
ticket: LOGI-0006
arm: backend
status: locked
created: 2026-09-22T09:41:35.316Z
depends_on_plans:
---

## 1. Objective
LOGI-0006 backend (spec spec_approved, contract CONTRACT_APPROVED): shipment_status_history table migration + TransitionTo state machine (BR-7 legal-transition map in Application layer) via POST /shipments/{id}/status-transitions + paged GET status-history, single-transaction status update + history append, 400/401/403/404/409 per contract, integration tests AC-1..AC-8.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Domain/Shipment.cs` | modify | Add `TransitionTo` behavior method: BR-7 legal-transition map + `ShipmentStatusEvent` domain record — AC-1..AC-4 | ~45 |
| `src/backend/LogiFlow.Domain/ShipmentStatus.cs` | create | `ShipmentStatus` enum (Pending/Assigned/InTransit/Delivered/Delayed/Cancelled) — AC-1..AC-3 | ~12 |
| `src/backend/LogiFlow.Domain/ShipmentStatusHistory.cs` | create | Append-only audit entity (from/to/changed_by/changed_at/note) — AC-7 (deviation: added per PLAN_DEVIATION 2026-09-22) | ~20 |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | modify | Add `Shipments` + `ShipmentStatusHistory` DbSets — AC-1..AC-8 | ~4 |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentCommands.cs` | create | `TransitionShipmentStatus` command + validator + handler: single SaveChanges transaction (status update + history row); illegal -> ConflictException(legal next states) AC-1..AC-4; unknown toStatus/missing/long note -> 400 AC-5; missing shipment -> NotFound AC-6 | ~130 |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentQueries.cs` | create | `ListShipmentStatusHistory` paged query ordered changed_at asc then id — AC-7 | ~75 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify | Register shipment validators | ~4 |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | modify | shipments entity mapping + shipment_status_history mapping (index on shipment_id) — AC-7/NFR | ~30 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/20260922094500_LOGI-0006_AddShipmentStatusHistory.cs` | create | Additive migration: shipment_status_history (from_status nullable, to_status, changed_by_user_id, changed_at, note) — AC-7 | ~40 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/20260922094500_LOGI-0006_AddShipmentStatusHistory.Designer.cs` | create | EF designer for the migration | ~250 |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/LogiFlowDbContextModelSnapshot.cs` | modify | Snapshot gains shipments entity + history table | ~60 |
| `src/backend/LogiFlow.Api/Endpoints/ShipmentEndpoints.cs` | create | POST /api/v1/shipments/{id}/status-transitions + GET /api/v1/shipments/{id}/status-history; RequireRoles per contract x-roles — AC-1..AC-8 | ~70 |
| `src/backend/LogiFlow.Api/Program.cs` | modify | `app.MapShipmentEndpoints();` wiring | ~2 |
| `src/backend/LogiFlow.Api.Tests/ShipmentEndpointsTests.cs` | create | Integration tests AC-1..AC-8 (TestAuth per-role clients; shipments seeded directly) | ~260 |

Reuse note: `ConflictException` -> 409 ProblemDetails mapping exists from LOGI-0004; the middleware already passes through `detail`, which carries the legal next states (no API-middleware change in this manifest). Shipment creation stays out of scope (LOGI-0007) — tests seed shipment rows directly.

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0006-shipment-status-lifecycle.md` | full | AC-1..AC-8 source of truth + checkpoint answers + out-of-scope boundaries |
| `contract:shipments (schemas, params, responses, x-roles)` | slice | StatusTransitionRequest/ShipmentStatusEvent/ShipmentStatusHistoryPage fields + endpoint declarations + x-roles per op + 409 detail wording — resolve via `node tools/contract/index.mjs show --resource shipments` |
| `memory/journal/LOGI-0006.md` | full | Architect findings: state machine table, checkpoint answers (409 + legal next states; Delayed InTransit-scoped; Driver x-roles now/scoping at 0009/0010), migration plan |
| `Docs/ProjectTechGuidence/04-database-schema.md` | 49-64, 109-118 | Approved shipments columns (status enum) + shipment_status_history columns/indexing |
| `src/backend/LogiFlow.Domain/Vehicle.cs` | full | Entity idiom (string-typed enums, Create/Update behavior methods) to mirror |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleCommands.cs` | full | Command/validator/handler idiom (404 via NotFound, ConflictException pre-check) |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleQueries.cs` | full | Paged-list idiom (AsNoTracking, PagedResult.Create) |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | full | Seam to extend |
| `src/backend/LogiFlow.Application/Common/PagedResult.cs` | full | PagedResult.Create + NotFoundException idiom |
| `src/backend/LogiFlow.Infrastructure/Persistence/LogiFlowDbContext.cs` | full | Entity-mapping idiom (SQLite value conversions, indexes) |
| `src/backend/LogiFlow.Api/Endpoints/VehicleEndpoints.cs` | full | Minimal-API route + RequireRoles + TypedResults idiom |
| `src/backend/LogiFlow.Api/Middleware/ExceptionHandlingMiddleware.cs` | full | ConflictException/NotFoundException mapping (verify detail passthrough for 409 legal-next-states) |
| `src/backend/LogiFlow.Api/Program.cs` | full | Endpoint wiring order |
| `src/backend/LogiFlow.Api.Tests/VehicleEndpointsTests.cs` | full | Integration-test idiom + AC-to-test mapping precedent |
| `src/backend/LogiFlow.Api.Tests/TestAuth.cs` | full | Role sign-in helper (Admin/Dispatcher/Viewer/Driver clients for AC-8) |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/20260920060044_LOGI-0004_AddVehicles.cs` | full | Migration shape precedent (fallback if dotnet-ef unavailable) |
| `src/backend/LogiFlow.Infrastructure/Persistence/Migrations/LogiFlowDbContextModelSnapshot.cs` | full | Snapshot to extend (also listed in §2) |

## 4. Steps (each with verify gate)
- [x] 1. Domain: `ShipmentStatus.cs` enum + `Shipment.cs` `TransitionTo(toStatus, userId, note, at)` returning a `ShipmentStatusEvent` (id 0 until persisted, fromStatus/toStatus, changedByUserId, changedAt, note) — legal-transition map: Pending->[Assigned,Cancelled], Assigned->[InTransit,Cancelled], InTransit->[Delivered,Delayed], Delayed->[InTransit], Delivered->[], Cancelled->[] (checkpoint answers 1+2; `fromStatus` null only in history for the initial row, never from TransitionTo) → verify: `dotnet build src/backend/LogiFlow.sln` passes

- [ ] 2. Migration + persistence: IAppDbContext `DbSet<Shipment> Shipments` + `DbSet<ShipmentStatusHistory>`; LogiFlowDbContext mappings (shipments.status string conversion + shipment_status_history with index on shipment_id); migration `20260922094500_LOGI-0006_AddShipmentStatusHistory` + Designer + snapshot (additive; dotnet-ef if available, else hand-author mirroring LOGI-0004 shape) → verify: `dotnet ef migrations has-pending-model-changes --project src/backend/LogiFlow.Infrastructure` reports no pending changes (or snapshot/build parity if tool unavailable) + `dotnet build src/backend/LogiFlow.sln` passes
- [ ] 3. Application + API: `TransitionShipmentStatus` command (validator: toStatus required+enum, note <=500 — AC-5) + handler (load shipment, TransitionTo, add history row, single SaveChanges; illegal -> ConflictException("legal next state(s): X, Y") — AC-1..AC-4; missing -> NotFound — AC-6); `ListShipmentStatusHistory` paged query (changed_at asc then id — AC-7); DI registrations; `src/backend/LogiFlow.Api/Endpoints/ShipmentEndpoints.cs` contract routes + RequireRoles (transitions [Admin,Dispatcher,Driver], history [Admin,Dispatcher,Driver,Viewer]) + Program.cs wiring → verify: `dotnet build src/backend/LogiFlow.sln` passes
- [ ] 4. Tests: `src/backend/LogiFlow.Api.Tests/ShipmentEndpointsTests.cs` (shipments seeded directly until LOGI-0007): AC-1 forward chain each 200 + status + newest history entry; AC-2 Cancelled 200 from Pending/Assigned, 409 from InTransit/Delivered/Cancelled; AC-3 Delayed 200 from InTransit + back to InTransit, 409 from others; AC-4 direct jump 409 with legal next state in detail + no history row; AC-5 empty/unknown toStatus + note 501 chars -> 400 errors.toStatus/errors.note; AC-6 404 both endpoints id 999999; AC-7 paged history oldest->newest, rejected absent; AC-8 anonymous 401, Viewer POST 403 + GET 200, Driver 2xx, Admin/Dispatcher 2xx → verify: `dotnet test src/backend/LogiFlow.Api.Tests` full suite green (auth + warehouses + vehicles + drivers + shipments)
- [ ] 5. Seal: `tracker seal --ticket LOGI-0006 --arm backend` (migration timestamp, test counts, state-machine map location, Driver-scoping deferral note); manifest-exact commit; `tracker handoff --ticket LOGI-0006 --from backend --to frontend --summary "memory/journal/LOGI-0006.md#backend-arm" --gates "build-pass,tests-green,br7-409-legal-next,history-transactional"` → verify: `git status --short` shows only §2 files + state/memory bookkeeping; HANDOFF event recorded

## 5. Risks / open questions
- Shipments table has no producer yet (LOGI-0007 lands after): tests seed rows directly via the test DbContext — same pattern drivers used for user links; no API change.
- 409 detail wording ("legal next state(s): X") is contract-declared — verify the middleware passes handler-provided detail through in step 3; fallback: adjust ConflictException usage, not the middleware (deviation protocol if middleware itself must change).
- Delayed->Cancelled is illegal (checkpoint answer 1) — encode the map exactly; do NOT "fix" per intuition.
- Driver-role ownership scoping (own-route shipments) lands with LOGI-0009/0010 — v1 Driver-role callers transition any shipment per checkpoint answer 4 (documented deferral).
- dotnet-ef tool availability assumed (9.0.8 at LOGI-0004) — hand-author fallback mirrors LOGI-0004 migration + snapshot edit.
- SQLite lacks native enums — status stored as string (vehicles/drivers precedent); history.from_status nullable string.
- No escalation triggers: schema pre-approved, additive-only, checkpoint answers recorded in the journal.

## 6. Exit gates
- `dotnet build src/backend/LogiFlow.sln` passes; `dotnet test src/backend/LogiFlow.Api.Tests` full suite green (auth + warehouse + vehicle + driver + shipment suites).
- BR-7 legal-transition map enforced server-side in the Application layer: illegal -> 409 ProblemDetails naming legal next states; status unchanged; no history row.
- Every accepted transition writes shipments.status update + shipment_status_history row in one SaveChanges/transaction; history GET returns paged rows ordered changed_at asc then id with from/to/who/when/note.
- 400 with errors.toStatus/errors.note per AC-5; 404 per AC-6; RBAC matrix matches contract x-roles exactly (Driver included per deferral; Viewer read-only; anonymous 401).
- Migration additive (one ticket = one migration, LOGI-0006_AddShipmentStatusHistory) with index on shipment_id; contracts/ and src/frontend/ untouched.
