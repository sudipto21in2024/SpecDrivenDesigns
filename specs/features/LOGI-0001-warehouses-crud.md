---
id: LOGI-0001
title: Warehouse CRUD
status: integration_ready
owner_agent: spec-agent
created: 2026-09-18
depends_on:
  - LOGI-0000
---

## 1. Summary
As a **Dispatcher**, I want to manage warehouse master data (create, list, view, update, delete)
so that shipments can reference real origin warehouses.

## 2. Actors & roles
- Admin (full CRUD), Dispatcher (create/update; deactivates by delete per v1 hard delete of unused rows).
- Viewer/Driver: read-only. Auth enforcement lands in LOGI-0003; contract already declares `x-roles`.

## 3. Preconditions
- LOGI-0000 scaffold complete (build/toolchain green).
- Auth not yet implemented — endpoints are open in this ticket; RBAC added in LOGI-0003.

## 4. Acceptance criteria (Given/When/Then)

**AC-1 — Create warehouse (happy path)**
```
Given I am on the warehouse list page
When I POST /api/v1/warehouses with {name, address} (optional latitude/longitude)
Then I receive 201 with the created warehouse including server-assigned id and createdAt
And the warehouse appears in GET /api/v1/warehouses
```

**AC-2 — Validation: name and address required**
```
When I POST /api/v1/warehouses with empty name or empty address
Then I receive 400 ProblemDetails with errors.name / errors.address populated
And no warehouse row is created
```

**AC-3 — Validation: coordinate ranges**
```
When I POST with latitude outside [-90, 90] or longitude outside [-180, 180]
Then I receive 400 ProblemDetails with the offending field listed
```

**AC-4 — List is paginated**
```
Given 30 warehouses exist
When GET /api/v1/warehouses?page=2&pageSize=10
Then I receive the PagedResponse envelope with 10 items, page=2, pageSize=10,
totalCount=30, totalPages=3
```

**AC-5 — Get by id / not found**
```
When GET /api/v1/warehouses/{id} for an existing id → 200 with the warehouse
When GET /api/v1/warehouses/999999 → 404 ProblemDetails
```

**AC-6 — Update**
```
When PUT /api/v1/warehouses/{id} with valid fields → 200 with the updated warehouse
When PUT /api/v1/warehouses/999999 → 404 ProblemDetails
```

**AC-7 — Delete**
```
When DELETE /api/v1/warehouses/{id} for an existing id → 204 and subsequent GET → 404
When DELETE /api/v1/warehouses/999999 → 404 ProblemDetails
```

## 5. Out of scope (explicit)
- Soft delete (schema has no deleted_at column — noted for a future ADR if needed).
- Warehouse→shipment referential enforcement behavior (shipments arrive in LOGI-0007).
- Auth/RBAC enforcement (LOGI-0003).
- Frontend React/MUI migration (tracked as the LOGI-0001 frontend increment; backend vertical slice lands first).

## 6. Data touched
- Writes: `warehouses` (new table — migration `*_LOGI-0001_AddWarehouses`).
- Reads: `warehouses`.

## 7. Open questions
- None blocking.

## 8. Non-functional requirements
- List endpoint responds <300ms p95 at ~1000 rows (index on name).
- All timestamps ISO8601 UTC.
