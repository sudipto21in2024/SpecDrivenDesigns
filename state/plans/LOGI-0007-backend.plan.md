---
ticket: LOGI-0007
arm: backend
status: done
created: 2026-09-23T10:09:07.535Z
depends_on_plans: LOGI-0007-architect
---

## 1. Objective
Create shipment (F5) + shipment list/search (F8) backend per the approved spec: one `SlaPolicy` unit (BR-1 offsets + BR-2 at-risk), `CreateShipmentCommand` writing the initial audit row, `ListShipmentsQuery` with filters/sort/atRisk projection, and `GET`/`POST /api/v1/shipments` with the contract's x-roles. No migration (LOGI-0006 shipped the tables and indexes).

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Application/Features/Shipments/SlaPolicy.cs` | create | AC-2/AC-3/AC-9 — BR-1 offset table + priority value set + BR-2 at-risk predicate in ONE unit (BR-sla-rules §1/§2 enforcement seams) | ~60 |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentCommands.cs` | modify | AC-1..AC-5 — `ShipmentDto` + `CreateShipmentCommand`/validator/handler (reference code, BR-1 due date, initial Pending audit row) | ~95 |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentQueries.cs` | modify | AC-6..AC-9 — `ListShipmentsQuery`/validator/handler (AND filters, sort + id tiebreak, atRisk projection) | ~95 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify | register the two new validators (per-type convention, LOGI-0004/0005/0006 pattern) | ~3 |
| `src/backend/LogiFlow.Api/Endpoints/ShipmentEndpoints.cs` | modify | AC-1/AC-6/AC-10 — `GET /` (list) + `POST /` (create) with the contract x-roles + `CreateShipmentRequest` | ~40 |
| `src/backend/LogiFlow.Api.Tests/SlaPolicyTests.cs` | create | BR-1 offsets + default/unknown priority + BR-2 boundary table (whole-second, Delayed eligible, null due) | ~80 |
| `src/backend/LogiFlow.Api.Tests/ShipmentCreateTests.cs` | create | AC-1..AC-5, AC-10 (POST 401/403/201), AC-11 (transition seam + oldest-first history) | ~160 |
| `src/backend/LogiFlow.Api.Tests/ShipmentListTests.cs` | create | AC-6..AC-9 + AC-10 (GET roles, 401/403) | ~170 |
| `memory/journal/LOGI-0007.md` | modify | backend-arm section (written by `tracker seal`) | ~5 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0007-create-shipment.md` | 40-235 | AC-1..AC-11 (the acceptance contract for every step), §6 data touched, §7 defaults |
| `contract:shipments (x-roles, params, responses, schemas)` | slice | Approved request/response shapes + role matrix + query params (resolve via `node tools/contract/index.mjs show --resource shipments`) |
| `Docs/business-rules/BR-sla-rules.md` | 14-46, 83-92 | BR-1 rules 1.1-1.7 (anchor, default Standard, fail-loud, persisted once) + the whole-second precision note |
| `src/backend/LogiFlow.Domain/Shipment.cs` | 1-64 | Shipment.Create signature + TransitionTo (reuse, do not change) |
| `src/backend/LogiFlow.Domain/ShipmentStatus.cs` | 18-60 | ShipmentStatusValues.All + the `ShipmentStatusEvent` record |
| `src/backend/LogiFlow.Application/Abstractions/IAppDbContext.cs` | 9-31 | `Shipments`, `ShipmentStatusHistory`, `Warehouses` sets |
| `src/backend/LogiFlow.Application/Abstractions/ICurrentUser.cs` | full | Actor id for `changed_by_user_id` |
| `src/backend/LogiFlow.Application/Common/PagedResult.cs` | 1-16 | PagedResult<T>.Create + `NotFoundException` |
| `src/backend/LogiFlow.Application/Common/ConflictException.cs` | full | Uniqueness/state conflict → 409 |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleCommands.cs` | 21-69 | Create command/validator/handler idiom + unique-violation backstop |
| `src/backend/LogiFlow.Application/Features/Vehicles/VehicleQueries.cs` | 10-57 | Paged list idiom (q contains, enum filters, PagedResult.Create) |
| `src/backend/LogiFlow.Application/Features/Drivers/DriverCommands.cs` | 29-58 | Cross-entity FK validation precedent (`ValidationFailure` on the field → 400 `errors.<field>`) |
| `src/backend/LogiFlow.Api/Endpoints/VehicleEndpoints.cs` | 19-59 | Endpoint idiom: `[AsParameters]` list binding, `Results.Created(uri, dto)`, `RequireRoles` |
| `src/backend/LogiFlow.Api.Tests/TestAuth.cs` | full | `SignInAsync(role)` against the real JWT pipeline |
| `src/backend/LogiFlow.Api.Tests/ShipmentEndpointsTests.cs` | 19-100 | Test idiom: seed warehouse via API, seed shipments via scope, ProblemDetails assertions |

## 4. Steps (each with verify gate)
- [x] 1. `SlaPolicy.cs` (create): `Priorities`/`DefaultPriority`, `IsKnownPriority`, `DueAt(createdAtUtc, priority)` = `created_at + 48h` (Standard) / `+12h` (Express) as plain UTC duration, `TruncateToSeconds`, `AtRiskCutoff(now) = truncate(now) + 2h` and `IsAtRisk(slaDueAt, status, now)` (inclusive boundary, excludes Delivered/Cancelled, null due → false) — one unit serving both the SQL-translatable cutoff and the in-memory predicate; `SlaPolicyTests.cs` with the BR-1 examples and the BR-2 boundary table → verify: `dotnet build src/backend/LogiFlow.sln` 0 errors + `dotnet test src/backend/LogiFlow.Api.Tests --filter FullyQualifiedName~SlaPolicyTests` green
- [x] 2. Create path: `ShipmentDto` + `CreateShipmentCommand`/validator/handler in `ShipmentCommands.cs` (reference code `SHP-` + max(id)+1 zero-padded to 6 with a bounded retry → 409 on exhaustion; `SlaPolicy.DueAt` from one server `now` truncated to whole seconds; `Shipment.Create` + the initial `ShipmentStatusHistory` row in ONE `SaveChanges`; unknown warehouse → `ValidationFailure(nameof(OriginWarehouseId), "Warehouse {id} does not exist.")` mirroring the driver user-link precedent); DI registration; `POST /` in `ShipmentEndpoints.cs` with `CreateShipmentRequest` and `RequireRoles(Admin, Dispatcher)`; `ShipmentCreateTests.cs` covering AC-1..AC-5 (AC-1 also asserts the single initial audit row and list visibility, AC-11 the transition seam) → verify: build 0 errors + `dotnet test src/backend/LogiFlow.Api.Tests --filter FullyQualifiedName~ShipmentCreateTests` green
- [x] 3. List path: `ListShipmentsQuery`/validator/handler in `ShipmentQueries.cs` (page/pageSize validation, status/priority enum filters, originWarehouseId, q over referenceCode/destinationAddress, `slaRisk` via `SlaPolicy.AtRiskCutoff`, sort `createdAt|-createdAt|slaDueAt|-slaDueAt` with nulls-last for slaDueAt and an id tiebreak, `atRisk` projected per row, `PagedResult.Create`); `GET /` in `ShipmentEndpoints.cs` with `[AsParameters]` and `RequireRoles(Admin, Dispatcher, Viewer)`; `ShipmentListTests.cs` covering AC-6..AC-9 and the AC-10 GET role matrix → verify: build 0 errors + `dotnet test src/backend/LogiFlow.Api.Tests --filter FullyQualifiedName~ShipmentListTests` green
- [x] 4. Whole-suite gate + boundary/drift proof: `dotnet test src/backend/LogiFlow.sln` (existing 50 + the new suites), `dotnet ef migrations has-pending-model-changes --project src/backend/LogiFlow.Infrastructure` (no schema/model change expected), `git status --short` (only §2 files) → verify: all tests green, no pending model changes, nothing outside the manifest touched
- [x] 5. Seal + handoff: `tracker seal` (backend-arm section with gates + findings), `tracker handoff backend→frontend`, `tracker active`/`progress`, plan status done → verify: journal section present, HANDOFF event recorded, plan done, one commit per verified step

## 5. Risks / open questions
- **Nulls-last for the `slaDueAt` sort (AC-8):** SQLite orders NULLs first, so the query uses `.OrderBy(s => s.SlaDueAt == null).ThenBy(s => s.SlaDueAt)`; the AC-8 test seeds a null-due row to prove the ordering.
- **`atRisk` stays SQL-translatable and unpersisted:** the predicate is rewritten as `s.SlaDueAt <= AtRiskCutoff(now)` (equivalent to BR-2's `now >= slaDueAt - 2h` at whole-second precision), so `slaRisk` filtering, `totalCount` and paging all stay server-side; `SlaPolicy.IsAtRisk` is the in-memory twin used by the unit tests. No column is added.
- **Reference-code ceiling:** `SHP-` + 6 digits derived from `max(id)+1`; beyond 999,999 the numeric part grows a digit — outside v1 volume (≤50k shipments/year per BRD §7). Recorded, not solved.
- **Race on the reference code:** two concurrent creates can compute the same candidate; the unique index arbitrates and the loser retries (bounded) → 409 rather than a 500, mirroring the vehicle plate backstop (`CreateVehicleHandler.IsUniqueViolation`).
- **Location header nuance:** `Results.Created(uri, dto)` (the existing warehouse/vehicle idiom) sets a `Location` header the approved contract does not document. Additive and harmless; the architect plan §5 described it as "no Location header" — corrected here for the record.
- **Driver role on GET:** excluded (403) per the approved spec §7 and AC-10; own-route scoping arrives with LOGI-0009/0010.

## 6. Exit gates
- `dotnet build src/backend/LogiFlow.sln` → 0 errors; `dotnet test src/backend/LogiFlow.sln` → all green (existing 50 + SlaPolicy/create/list additions, 0 failed).
- Every AC-1..AC-11 has at least one test (AC refs in test names/comments); the RBAC tests run against the real JWT pipeline (`TestAuth.SignInAsync`).
- No schema/model change: `has-pending-model-changes` reports none; `src/frontend/**`, `contracts/**` and `tests/e2e/**` untouched.
- Backend arm sealed and handed off to the frontend arm.
