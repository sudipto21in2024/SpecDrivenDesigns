---
id: LOGI-0004
title: Vehicle CRUD
status: spec_approved
owner_agent: spec-agent
created: 2026-09-20
depends_on:
  - LOGI-0001
  - LOGI-0003
---

## 1. Summary
As a **Dispatcher**, I want to manage vehicle master data (create, list, view, update, delete)
so that routes can later be assigned real vehicles with known capacity and availability status.

This is PRD F2 (Vehicle management). Unlike LOGI-0001 (which shipped open and was secured later),
every endpoint here is authenticated + RBAC-enforced from day one per ADR-007.

## 2. Actors & roles
- Admin (full CRUD, including delete).
- Dispatcher (create/update; no delete — mirrors the LOGI-0001/LOGI-0003 role matrix).
- Driver/Viewer: read-only (list + detail only).

## 3. Preconditions
- LOGI-0001 scaffold + warehouse CRUD complete.
- LOGI-0003 auth enforced: callers present `Authorization: Bearer <jwt>`; anonymous calls get 401.

## 4. Acceptance criteria (Given/When/Then)

**AC-1 — Create vehicle (happy path)**
```
Given I am logged in as a Dispatcher
When I POST /api/v1/vehicles with {plateNumber: "RT-8421-X", type: "Truck", capacityKg: 12000, status: "Available"}
Then I receive 201 with the created vehicle including server-assigned id and createdAt
And the vehicle appears in GET /api/v1/vehicles
```

**AC-2 — Validation: plate number required**
```
When I POST /api/v1/vehicles with an empty plateNumber
Then I receive 400 ProblemDetails with errors.plateNumber populated
And no vehicle row is created
```

**AC-3 — Validation: plate number unique**
```
Given a vehicle with plateNumber "RT-8421-X" exists
When I POST /api/v1/vehicles with plateNumber "RT-8421-X"
Then I receive 409 ProblemDetails
And no second vehicle row is created
```

**AC-4 — Validation: type must be a known enum value**
```
When I POST /api/v1/vehicles with type "Spaceship" (or any value outside Van/Truck/Trailer)
Then I receive 400 ProblemDetails with errors.type populated
```

**AC-5 — Validation: capacity must be positive**
```
When I POST /api/v1/vehicles with capacityKg 0 or a negative number
Then I receive 400 ProblemDetails with errors.capacityKg populated
And no vehicle row is created
```

**AC-6 — Validation: status enum, defaults to Available**
```
When I POST /api/v1/vehicles without a status field
Then the vehicle is created with status "Available"
When I POST with a status outside Available/InRoute/Maintenance
Then I receive 400 ProblemDetails with errors.status populated
```

**AC-7 — List is paginated and filterable**
```
Given 30 vehicles exist (mixed types and statuses)
When GET /api/v1/vehicles?page=2&pageSize=10
Then I receive the PagedResponse envelope with 10 items, page=2, pageSize=10,
totalCount=30, totalPages=3
When GET /api/v1/vehicles?status=Available&type=Truck
Then every returned item has status "Available" and type "Truck"
```

**AC-8 — Get by id / update / delete / not found**
```
When GET /api/v1/vehicles/{id} for an existing id → 200 with the vehicle
When GET /api/v1/vehicles/999999 → 404 ProblemDetails
When PUT /api/v1/vehicles/{id} with valid fields → 200 with the updated vehicle
When PUT /api/v1/vehicles/999999 → 404 ProblemDetails
When DELETE /api/v1/vehicles/{id} for an existing id → 204 and subsequent GET → 404
When DELETE /api/v1/vehicles/999999 → 404 ProblemDetails
```

**AC-9 — Authorization (RBAC enforced from day one)**
```
Given I have no Authorization header
When I call any /api/v1/vehicles endpoint
Then I receive 401 ProblemDetails
Given I am logged in as Viewer
When I POST /api/v1/vehicles (x-roles: [Admin, Dispatcher])
Then I receive 403 ProblemDetails and no vehicle row is created
Given I am logged in as Dispatcher
Then GET, POST and PUT return 2xx and DELETE returns 403
Given I am logged in as Admin
Then DELETE returns 204
```

## 5. Out of scope (explicit)
- Vehicle→route assignment and overlap rules (BR-3) — LOGI-0009.
- Capacity enforcement at assignment time (BR-5: route weight vs `capacityKg`) — LOGI-0010.
- Soft delete (schema has no deleted_at column — same v1 position as LOGI-0001 §5).
- A status lifecycle/state machine for vehicles (no BRD rule governs Available↔InRoute↔Maintenance;
  free-form PUT in v1; a lifecycle rule would need a BRD revision, not an ad hoc agent decision).
- Driver resource-ownership scoping ("own routes only", HLD §7) — belongs to LOGI-0009/0010.

## 6. Data touched
- Writes: `vehicles` (new table — migration `*_LOGI-0004_AddVehicles`; unique index on `plate_number`).
- Reads: `vehicles`.

## 7. Open questions
- None blocking. Delete-when-referenced-by-a-route (409 vs cascade vs block) is deferred to
  LOGI-0009 where the `routes.vehicle_id` FK lands; v1 contract declares 409 on DELETE for a
  referenced vehicle, mirroring how LOGI-0001 deferred shipment-reference behavior.

## 8. Non-functional requirements
- List endpoint responds <300ms p95 at ~1000 rows (index on plate_number; status/type filters indexed if query plans require).
- All timestamps ISO8601 UTC.

---
## Downstream artifacts this spec produces (for traceability)
- `contracts/v1-openapi.yaml` — `/vehicles`, `/vehicles/{id}` + `VehicleRequest`/`VehicleResponse` schemas (Architect Agent, this arm).
- Migration `<Timestamp>_LOGI-0004_AddVehicles` (Database Agent, additive; unique index `plate_number`).
- `src/backend/.../CreateVehicleCommand.cs` + handler + validator, queries, endpoints (Backend Agent).
- `src/frontend/src/features/vehicles/*` (Frontend Agent, typed client regenerated from the contract).
- `tests/e2e/vehicles.spec.ts` covering AC-1 through AC-9 (QA Agent).
