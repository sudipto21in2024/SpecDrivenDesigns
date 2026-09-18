# Feature Spec Template (+ Worked Example)

Spec Agent creates one file per feature at `/specs/features/<id>-<slug>.md` using this exact
structure. The worked example below (Shipment Creation) is ready to feed into the pipeline as-is.

---

```yaml
---
id: LOGI-0007
title: Create shipment
status: spec_approved
owner_agent: spec-agent
created: 2026-09-18
depends_on: [LOGI-0001-warehouses-crud, LOGI-0003-auth-roles]
---
```

## 1. Summary
As a **Dispatcher**, I want to create a shipment record so that it can later be assigned to a
route and vehicle for delivery.

## 2. Actors & roles
- Dispatcher (create), Admin (create) — Viewer and Driver cannot create shipments.

## 3. Preconditions
- At least one warehouse exists.
- User is authenticated with role Dispatcher or Admin.

## 4. Acceptance criteria (Given/When/Then)

**AC-1 — Happy path**
```
Given I am logged in as a Dispatcher
And at least one warehouse exists
When I open "Create Shipment" and fill origin warehouse, destination address, weight (kg), and priority
And I submit the form
Then a new shipment is created with status "Pending" and a generated reference code matching SHP-######
And I see a success confirmation
And the shipment appears in the shipment list
```

**AC-2 — Validation: weight must be positive**
```
Given I am on the Create Shipment form
When I enter a weight of 0 or a negative number
And I submit
Then I see a validation error on the weight field
And no shipment is created
```

**AC-3 — Validation: destination required**
```
Given I am on the Create Shipment form
When I leave destination address empty
And I submit
Then I see a validation error on the destination field
```

**AC-4 — Authorization**
```
Given I am logged in as a Viewer
When I attempt to call the create shipment API directly
Then I receive a 403 Forbidden response
```

**AC-5 — Reference code uniqueness**
```
Given multiple shipments are created concurrently
Then every shipment has a unique reference_code (server-generated, not client-supplied)
```

## 5. Out of scope (explicit)
- Automatic route/vehicle assignment (separate feature, LOGI-0012).
- Bulk import of shipments (future).
- Editing/cancelling a shipment (separate feature, LOGI-0008).

## 6. Data touched
- Reads: `warehouses`
- Writes: `shipments`, `shipment_status_history` (initial Pending entry)

## 7. Open questions (block on human answer if unresolved)
- None for this ticket — priority defaults to "Standard" if not selected; SLA due date rule for
  Express vs Standard is defined in LOGI-0002 (SLA rules) and referenced, not redefined here.

## 8. Non-functional requirements
- Create endpoint responds in <300ms p95 under seeded test data volumes (~1000 shipments).
- Form is usable on tablet width (dispatchers often work on tablets in the warehouse).

---

## Downstream artifacts this spec produces (for traceability)
- `contracts/v1-openapi.yaml` — `POST /shipments` (Architect Agent)
- Migration — none needed, `shipments` table already exists from LOGI-0001 batch
- `src/backend/.../CreateShipmentCommand.cs` + handler + validator (Backend Agent)
- `src/frontend/src/features/shipments/CreateShipmentForm.tsx` (Frontend Agent)
- `tests/e2e/create-shipment.spec.ts` covering AC-1 through AC-5 (QA Agent)
