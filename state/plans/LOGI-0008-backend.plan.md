---
ticket: LOGI-0008
arm: backend
status: done
created: 2026-09-26T06:48:59.853Z
depends_on_plans:
---

## 1. Objective
LOGI-0008 backend arm: implement F6 against the approved spec - GET /api/v1/shipments/{id} (detail, the read LOGI-0007 deferred), PATCH /api/v1/shipments/{id} (Pending-only partial edit of originWarehouseId/destinationAddress/destinationLat/Lng/weightKg with field-keyed 400s incl. immutable priority, 404 unknown id, 409 non-Pending, no audit row), and the BR-6 role x toStatus=Cancelled guard that closes the Driver-cancel hole on the existing transitions endpoint. No migration expected. Local gate: dotnet build + dotnet test LogiFlow.sln.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/backend/LogiFlow.Domain/Shipment.cs` | modify | `UpdateDetails(...)` + Pending-only guard (AC-1/AC-2) | ~30 |
| `src/backend/LogiFlow.Application/Common/ForbiddenException.cs` | create | 403 for the BR-6 role rule (AC-10) | ~15 |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentCommands.cs` | modify | `UpdateShipmentCommand`+validator+handler; BR-6 guard in the transition handler (AC-1..AC-5, AC-10) | ~130 |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentQueries.cs` | modify | `GetShipmentQuery`+handler (AC-5, AC-6) | ~35 |
| `src/backend/LogiFlow.Api/Endpoints/ShipmentEndpoints.cs` | modify | `GET/PATCH /{id:long}` routes + body→command mapper (AC-1..AC-6, AC-7 roles) | ~70 |
| `src/backend/LogiFlow.Api/Middleware/ExceptionHandlingMiddleware.cs` | modify | map `ForbiddenException` → the same 403 ProblemDetails `OnForbidden` writes (AC-10) | ~8 |
| `src/backend/LogiFlow.Application/DependencyInjection.cs` | modify | register `UpdateShipmentValidator` + `GetShipmentValidator` (validators are registered per-type, not assembly-scanned — without this the pipeline would silently skip them) | ~4 |
| `src/backend/LogiFlow.Api.Tests/ShipmentEditTests.cs` | create | integration AC-1..AC-7 + AC-12 edit half | ~300 |
| `src/backend/LogiFlow.Api.Tests/ShipmentCancelTests.cs` | create | integration AC-8..AC-10 + AC-12 cancel half | ~180 |
| `state/plans/LOGI-0008-backend.plan.md` | modify | this plan | auto |
| `memory/journal/LOGI-0008.md` | append (tracker seal) | backend-arm section | ~10 |
| `state/events.jsonl` | append (CLI only) | PLAN_*, TASK_STARTED, STEP_DONE, HANDOFF | ~7 |
| `state/handoffs.jsonl` | append (CLI only) | HANDOFF backend→frontend | 1 |
| `state/tasks.json` | derived (CLI only) | snapshot rebuild | auto |
| `memory/active.md` | regenerate (tracker active) | pointer to LOGI-0008 frontend arm | ~20 |
| `memory/progress.md` | modify (tracker progress) | LOGI-0008 row → backend done | 1 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| spec:LOGI-0008 | `node tools/spec/index.mjs show --ticket LOGI-0008 --section ac\|data\|defaults` | AC-1..AC-12 + §6 write-restriction + §7 O1-O6 decisions |
| contract:shipments | `node tools/contract/index.mjs show --resource shipments --fields x-roles,responses,schemas` | role matrix, status codes, `ShipmentUpdateRequest` shape |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentCommands.cs` | 36-74, 76-98, 100-244 | transition handler + the shared DTO projection + create handler idioms to mirror |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentQueries.cs` | 28-59, 91-163 | 404-then-read idiom, SlaPolicy request instant, the shared ShipmentDto projection |
| `src/backend/LogiFlow.Application/Features/Shipments/ShipmentCommands.cs` | 76-98 | the DTO shape the detail endpoint must return byte-for-byte |
| `src/backend/LogiFlow.Domain/Shipment.cs` | full | `Create`/`TransitionTo` invariants; `UpdateDetails` slots in beside them |
| `src/backend/LogiFlow.Domain/ShipmentStatus.cs` | 62-64 | `IllegalShipmentTransitionException` idiom for the new `ShipmentNotEditableException` |
| `src/backend/LogiFlow.Api/Middleware/ExceptionHandlingMiddleware.cs` | full | exception→ProblemDetails mapping order |
| `src/backend/LogiFlow.Api/Endpoints/ShipmentEndpoints.cs` | full | route/`RequireRoles` idiom + request-record placement |
| `src/backend/LogiFlow.Api/Program.cs` | 63-77 | `OnForbidden` URI/title/detail the new 403 must match |
| `src/backend/LogiFlow.Application/Features/Shipments/SlaPolicy.cs` | full | only source of SLA constants (never re-derived here) |
| `src/backend/LogiFlow.Api.Tests/ShipmentCreateTests.cs` | full | test idioms: seeded warehouse, JsonElement asserts, role matrix, `SubFrom` |
| `src/backend/LogiFlow.Api.Tests/ShipmentEndpointsTests.cs` | 39-79, 202-268 | seeding + 404 + role-matrix idioms for the cancel tests |
| `src/backend/LogiFlow.Api.Tests/LogiFlowTestFactory.cs` | full | shared in-memory SQLite factory |


## 4. Steps (each with verify gate)
- [x] 1. Milestone 1 — Logic slice (domain + Application + wiring): `Shipment.UpdateDetails(originWarehouseId, destinationAddress, lat, lng, weightKg, at)` guarded by a new `ShipmentNotEditableException` (Pending-only, AC-2) beside `TransitionTo`; `ForbiddenException` in Application/Common mapped to the exact 403 body `OnForbidden` writes (AC-10); `UpdateShipmentCommand` (presence-aware patch fields + rejected-property list) + validator (AC-3/AC-4) + handler (warehouse existence → `errors.originWarehouseId`, merge-then-update, `UpdatedAt` server-managed per §7 O6, no history row per §7 O3); `GetShipmentQuery` + handler reusing the shared ShipmentDto projection with one SlaPolicy request instant (AC-6); BR-6 role×toStatus guard in the transition handler before the 404 lookup; `GET /{id:long}` + `PATCH /{id:long}` routes with contract `x-roles` and a body→command mapper → verify: `dotnet build src/backend/LogiFlow.sln -c Release` 0 warnings-as-errors, plus the M2 unit assertions locally; no migration (`dotnet ef migrations has-pending-model-changes` → "none")
- [x] 2. Milestone 2 — Integration slice (real API + SQLite): `ShipmentEditTests.cs` AC-1 (edit + read-back + untouched server-owned fields + zero new history rows), AC-2 (409 for each non-Pending status), AC-3 (per-field 400s + empty body), AC-4 (server-owned/immutable rejection incl. `priority`), AC-5 (404 both endpoints), AC-6 (detail shape), AC-7 (anon 401 / Viewer GET 200 PATCH 403 / Driver 403 / Admin+Dispatcher 2xx), AC-12 edit half (`slaDueAt` + `priority` byte-identical); `ShipmentCancelTests.cs` AC-8 (Pending and Assigned cancel + audit echo + list filter), AC-9 (409 outside Pending/Assigned, no audit row), AC-10 (Driver 403 on Cancelled but still 200 on Assigned→InTransit, Viewer 403, anon 401, Admin/Dispatcher 200), AC-12 cancel half (`atRisk` false afterwards) → verify: `dotnet test src/backend/LogiFlow.sln -c Release` fully green (existing suites unchanged), every new test carries a `// LOGI-0008 AC-n` comment
- [x] 3. Milestone 3 — Arm verification + handoff: prove no migration, re-run the full local gate on a clean build, confirm the contract-conformance of both routes via the slicer, one atomic commit `feat(LOGI-0008): backend arm - shipment detail/edit + BR-6 cancel guard`, `tracker seal`, `tracker handoff --ticket LOGI-0008 --from backend --to frontend` → verify: `tracker plan-slice --ticket LOGI-0008 --arm backend` shows all steps done; `git status --short` clean apart from derived state; `tracker show --ticket LOGI-0008` → next=frontend

## 5. Risks / open questions
- **R1 (new, the arm's first risk):** a partial PATCH must distinguish "omitted" from "explicit null", and AC-4 requires rejecting *server-owned* keys — impossible with a plain typed record, because `JsonSerializerDefaults.Web` silently drops unknown members. The endpoint therefore binds the body as `JsonElement`, whitelists the five editable camelCase names, records every other name as a rejected property (AC-4), and carries presence in an `PatchField<T>`-style wrapper down to the validator. If `JsonElement` body binding does not resolve in minimal APIs, fall back to `JsonNode`/`JsonDocument` (same body-binding family) before considering a stream read.
- **R2:** the Driver-cancel 403 must be a *handler* exception, not a validator failure (a validator produces 400). `ICurrentUser.Role` is already injected in the transition handler; `Roles.Driver` comes from `LogiFlow.Domain.Security`, which Application already references.
- **R3:** the new 403 must be byte-identical to `OnForbidden`'s body (`https://logiflow.dev/errors/forbidden`, title `Forbidden`, the "not permitted" detail) so clients cannot tell the two 403 sources apart — and `ShipmentEndpointsTests.AC8` (Driver Assigned→InTransit = 200) must stay green, proving the guard is scoped to `toStatus: Cancelled` only.
- **R4:** `SlaPolicy` stays the only home of SLA constants: the edit path never recomputes `sla_due_at`/`priority` (BR-1 rule 1.5, the checkpoint decision), so no new offset or window may appear anywhere in this arm.
- **R5:** the shared in-memory SQLite connection is per-factory; the new tests seed shipments directly (LOGI-0006 idiom) and must not rely on `max(id)+1` reference codes.
- Out of scope (deferred to the frontend/qa arms): `schema.d.ts` regeneration, MSW handlers, row actions/dialogs, Playwright specs, and the `LOGI-0007-F1/F2` follow-ups.

## 6. Exit gates
- `dotnet build src/backend/LogiFlow.sln -c Release --no-incremental` clean and `dotnet test src/backend/LogiFlow.sln -c Release` green with the two new files' tests included; no existing test changed except an additive one.
- AC-1..AC-12 are each covered by at least one test carrying `// LOGI-0008 AC-n` (AC-11 excepted: it is the frontend/qa seam, asserted as a backend capability here — the row-action rules exist in the spec and the contract's `x-roles`).
- Behavioural non-regressions proven by tests: no `shipment_status_history` row for edits or rejected operations, `priority`/`slaDueAt` untouched by an edit, `atRisk` false for Cancelled, Driver still 2xx for non-Cancelled transitions, Viewer still 200 on reads.
- No migration: `dotnet ef migrations has-pending-model-changes` reports none, and no file under `Persistence/Migrations` changes.
- Both routes match the contract exactly (paths, methods, `x-roles`, status codes) — verified against the `shipments` contract slice, not from memory.
- One atomic commit; `tracker seal` + `HANDOFF backend→frontend` recorded; `tracker show --ticket LOGI-0008` → next=frontend.
