---
id: LOGI-0005
title: Driver CRUD
status: spec_approved
owner_agent: spec-agent
created: 2026-09-20
depends_on:
  - LOGI-0003
---

## 1. Summary
As a **Dispatcher**, I want to manage driver master data (create, list, view, update, delete)
so that routes can later be assigned real drivers (BR-4), and a driver's login account can be
linked to their driver record.

This is PRD F3 (Driver management). Like LOGI-0004 (vehicles), every endpoint here is
authenticated + RBAC-enforced from day one per ADR-007.

## 2. Actors & roles
- Admin (full CRUD, including delete).
- Dispatcher (create/update; no delete — mirrors the LOGI-0001/0003/0004 role matrix).
- Viewer: read-only (list + detail only).
- Driver role: **no access to driver master data** — the driver persona surfaces are F12/F13
  ("my routes", status updates), not master data. Master-data reads follow the vehicle matrix
  (Admin/Dispatcher/Viewer).

## 3. Preconditions
- LOGI-0001 scaffold + warehouse CRUD complete (the CRUD pattern this ticket mirrors).
- LOGI-0003 auth enforced: callers present `Authorization: Bearer <jwt>`; anonymous calls get 401.

## 4. Acceptance criteria (Given/When/Then)

**AC-1 — Create driver (happy path)**
```
Given I am logged in as a Dispatcher
When I POST /api/v1/drivers with {fullName: "Raj Patil", licenseNumber: "DL-112-4589", phone: "+31 6 1234 5678"}
Then I receive 201 with the created driver including server-assigned id and status "Active"
And the driver appears in GET /api/v1/drivers
```

**AC-2 — Validation: full name required**
```
When I POST /api/v1/drivers with an empty or missing fullName
Then I receive 400 ProblemDetails with errors.fullName populated
And no driver row is created
```

**AC-3 — Validation: license number unique**
```
Given a driver with licenseNumber "DL-112-4589" exists
When I POST /api/v1/drivers with licenseNumber "DL-112-4589"
Then I receive 409 ProblemDetails
And no second driver row is created
When I PUT /api/v1/drivers/{otherId} with licenseNumber "DL-112-4589"
Then I receive 409 ProblemDetails and the other driver keeps its license number
```

**AC-4 — Validation: status enum, defaults to Active**
```
When I POST /api/v1/drivers without a status field
Then the driver is created with status "Active"
When I POST with a status outside Active/OffDuty/Suspended
Then I receive 400 ProblemDetails with errors.status populated
```

**AC-5 — Optional user link (valid)**
```
Given user id 7 exists
When I POST /api/v1/drivers with {fullName: "...", licenseNumber: "...", userId: 7}
Then I receive 201 with userId = 7 echoed
When I GET /api/v1/drivers/{id}
Then the response carries userId = 7
```

**AC-6 — Optional user link (broken, taken, cleared)**
```
When I POST /api/v1/drivers with userId 999999 (no such user)
Then I receive 400 ProblemDetails with errors.userId populated and no driver row is created
Given driver D2 is already linked to userId 7
When I POST (or PUT) another driver with userId 7
Then I receive 409 ProblemDetails — a user may be linked to at most one driver
  (User 1---1 Driver, approved schema entity overview)
When I PUT /api/v1/drivers/{D2-id} with userId null
Then I receive 200 and the link is cleared (userId null in the response)
```

**AC-7 — List is paginated and filterable**
```
Given 30 drivers exist (mixed statuses)
When GET /api/v1/drivers?page=2&pageSize=10
Then I receive the PagedResponse envelope with 10 items, page=2, pageSize=10,
totalCount=30, totalPages=3
When GET /api/v1/drivers?status=Active&q=raj
Then every returned item has status "Active" and a fullName containing "raj"
(case-insensitive)
```

**AC-8 — Get by id / update / delete / not found**
```
When GET /api/v1/drivers/{id} for an existing id → 200 with the driver
When GET /api/v1/drivers/999999 → 404 ProblemDetails
When PUT /api/v1/drivers/{id} with valid fields → 200 with the updated driver
When PUT /api/v1/drivers/999999 → 404 ProblemDetails
When DELETE /api/v1/drivers/{id} for an existing id → 204 and subsequent GET → 404
When DELETE /api/v1/drivers/999999 → 404 ProblemDetails
```

**AC-9 — Authorization (RBAC enforced from day one)**
```
Given I have no Authorization header
When I call any /api/v1/drivers endpoint
Then I receive 401 ProblemDetails
Given I am logged in as Viewer
When I POST /api/v1/drivers (x-roles: [Admin, Dispatcher])
Then I receive 403 ProblemDetails and no driver row is created
Given I am logged in as Driver
When I GET /api/v1/drivers (x-roles: [Admin, Dispatcher, Viewer])
Then I receive 403 ProblemDetails — master data is not a driver-persona surface
Given I am logged in as Dispatcher
Then GET, POST and PUT return 2xx and DELETE returns 403
Given I am logged in as Admin
Then DELETE returns 204
```

## 5. Out of scope (explicit)
- Driver↔route assignment and BR-4 overlap rules ("a driver cannot be assigned to two routes
  with overlapping planned time windows") — LOGI-0009.
- Resource-ownership scoping ("a driver must only see their own routes", HLD §7 / ADR-007
  negative) — LOGI-0009/0010/0013.
- F12/F13 driver self-service (my routes, status updates) — separate tickets; this spec is
  master data only.
- Soft delete (schema has no deleted_at column — same v1 position as LOGI-0001 §5).
- A status lifecycle/state machine for drivers (no BRD rule governs Active↔OffDuty↔Suspended;
  free-form PUT in v1 — mirrors vehicles §5; a lifecycle rule would need a BRD revision, not an
  ad hoc agent decision).
- Auto-provisioning/unprovisioning a driver row when an Admin creates/deletes a Driver-role user
  (F4) — the user↔driver link is explicit via `userId` only.
- Requiring the linked user to hold the Driver role — specified nowhere (BRD/PRD/schema);
  v1 validates existence + 1:1 only (see §7).

## 6. Data touched
- Writes: `drivers` (new table — migration `*_LOGI-0005_AddDrivers`; unique index on
  `license_number`; nullable FK `user_id` → `users.id`, default NO ACTION per schema).
- Reads: `drivers`, `users` (userId existence check).

## 7. Open questions
- Should the user link require the target user to have role=Driver? Not specified in the BRD,
  PRD or approved schema. v1 does not enforce it; flagged for the checkpoint — cheap to add as
  a validation rule later without a contract change.
- Delete-when-referenced-by-a-route (409 vs cascade vs block) is deferred to LOGI-0009 where the
  `routes.driver_id` FK lands; v1 declares hard delete + 409 on DELETE for a referenced driver,
  mirroring how LOGI-0004 declared it for vehicles.
- None blocking.

## 8. Non-functional requirements
- List endpoint responds <300ms p95 at ~1000 rows (unique index on `license_number`; status
  filter indexed if query plans require).
- The response deliberately carries **no createdAt** — the approved schema §drivers defines no
  `created_at` column; do not invent one (list ordering is id asc).
- All other timestamps (none in this resource) would be ISO8601 UTC.

---
## Downstream artifacts this spec produces (for traceability)
- `contracts/v1-openapi.yaml` — `/drivers`, `/drivers/{id}` + `DriverRequest`/`DriverResponse` schemas (Architect Agent, this arm).
- Migration `<Timestamp>_LOGI-0005_AddDrivers` (Database Agent, additive; unique index `license_number`; nullable FK `user_id` → `users.id`).
- `src/backend/.../CreateDriverCommand.cs` + handler + validator, queries, endpoints (Backend Agent).
- `src/frontend/src/features/drivers/*` (Frontend Agent, typed client regenerated from the contract).
- `tests/e2e/drivers.spec.ts` covering AC-1 through AC-9 (QA Agent).
