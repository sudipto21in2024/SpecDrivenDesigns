---
id: LOGI-0007
title: Create shipment (+ shipment list & search)
status: done
owner_agent: spec-agent
created: 2026-09-23
depends_on:
  - LOGI-0001
  - LOGI-0003
  - LOGI-0006
---

## 1. Summary
As a **Dispatcher**, I want to create a shipment record — and then find it again in a filterable,
SLA-aware list — so that freight can be planned onto routes and tracked against its SLA promise.

This ticket covers **F5 (create shipment)** and **F8 (shipment list & search)**. Creation reuses the
domain already shipped by LOGI-0006: `Shipment.Create` inserts the row, the initial `Pending` entry
is appended to `shipment_status_history`, and the reference code and `sla_due_at` are computed
server-side (BR-1, expanded in `Docs/business-rules/BR-sla-rules.md`). The list is the read seam
named in that document's BR-2 enforcement note: `atRisk` is a **read-time projection** over query
results, never a stored column. Status changes stay the exclusive property of the LOGI-0006
transition endpoint — this ticket never writes `shipments.status` after creation.

## 2. Actors & roles
- Admin: create shipments, list/search all shipments.
- Dispatcher: create shipments, list/search all shipments (primary daily user).
- Viewer: read-only — list/search only; creating is 403 (BR-6).
- Driver: cannot create (BR-6). List access is **deferred**: own-route shipment visibility arrives
  with route assignment (LOGI-0009/0010), matching the deferral recorded in LOGI-0006 §2/§7; until
  then Driver-role callers are excluded from `GET /shipments` (see §7).

## 3. Preconditions
- LOGI-0003 auth enforced: callers present `Authorization: Bearer <jwt>`; anonymous → 401.
- At least one warehouse exists (`warehouses`, LOGI-0001) — it is the shipment's origin.
- `shipments` and `shipment_status_history` exist with their indexes (LOGI-0006 migration
  `20260922095953_LOGI-0006_AddShipmentStatusHistory`), including the **unique** index on
  `shipments.reference_code` and the indexes on `shipments.status` / `shipments.sla_due_at`.

## 4. Acceptance criteria (Given/When/Then)

**AC-1 — Happy path: create a shipment (Dispatcher)**
```
Given I am logged in as a Dispatcher
And at least one warehouse exists
When I POST /api/v1/shipments with { originWarehouseId, destinationAddress, weightKg, priority }
Then I receive 201 with the created shipment:
     a server-assigned id, referenceCode matching SHP-######, status "Pending",
     priority as supplied, weightKg and destinationAddress as supplied,
     createdAt and updatedAt as ISO8601 UTC, and slaDueAt per BR-1 (AC-2)
And exactly one shipment_status_history row exists for it:
     fromStatus null, toStatus "Pending", changedByUserId = my user id, changedAt = createdAt
And GET /api/v1/shipments returns the new shipment in the list
```

**AC-2 — BR-1: the SLA due date is computed from the server-side creation instant**
```
Given created_at is the instant the server inserts the row
When a shipment is created with priority "Standard" (or with priority omitted)
Then slaDueAt = createdAt + 48 hours
Given a shipment is created with priority "Express"
Then slaDueAt = createdAt + 12 hours
And a client-supplied createdAt or slaDueAt in the request body never influences the stored
    created_at / sla_due_at (BR-1 rule 1.2 — the promise is never client-controlled)
And the offsets are plain UTC duration arithmetic (BR-1 rule 1.4 — no business-hours exclusion)
```

**AC-3 — BR-1: priority defaults to Standard; an unknown priority fails loudly**
```
Given I omit priority in the request body
Then the shipment is created with priority "Standard" and the +48h due date (BR-1 rule 1.3)
Given I send priority "Overnight"
Then I receive 400 ProblemDetails with errors.priority naming the allowed values
    ("Standard", "Express") and no shipment is created (BR-1 rule 1.7 — no silent coercion)
```

**AC-4 — Create validation (400 and no row written)**
```
Given weightKg is missing, zero, or negative
Then I receive 400 ProblemDetails with errors.weightKg
Given destinationAddress is missing or blank/whitespace-only
Then I receive 400 ProblemDetails with errors.destinationAddress
Given originWarehouseId does not exist
Then I receive 400 ProblemDetails with errors.originWarehouseId ("does not exist"),
    mirroring the driver user-link precedent (FK existence is an Application-layer validation,
    not a missing request resource) — see §7
And in every 400 case neither a shipments row nor a history row is written
```

**AC-5 — Reference code: server-generated, unique, concurrency-safe**
```
Given N shipments are created concurrently (including for the same origin warehouse)
Then every shipment has a distinct reference_code matching ^SHP-[0-9]{6}$
And the code is generated server-side (a client-supplied referenceCode is never trusted)
And a collision retries a bounded number of times instead of leaking a duplicate-key 500;
    if the retry budget is exhausted the request fails with 409 ProblemDetails
    (the unique index ix_shipments_reference_code remains the final authority)
```

**AC-6 — Paged list envelope and pagination validation**
```
Given I am logged in as Admin, Dispatcher or Viewer
When I GET /api/v1/shipments
Then I receive 200 with { items, page, pageSize, totalCount, totalPages }
     where page defaults to 1 and pageSize defaults to 25 (maximum 100)
And totalCount counts every shipment matching the filters (not only the current page)
And GET /api/v1/shipments?page=0 (or pageSize=0, or pageSize=101) → 400 ProblemDetails
And paging is stable: the same ordering rules are applied to every page (AC-8)
```

**AC-7 — F8 filters combine with AND**
```
Given shipments exist across statuses, priorities and origin warehouses
When I GET /api/v1/shipments?status=Pending
Then only shipments whose status is exactly "Pending" are returned
When I additionally pass priority, originWarehouseId, q or slaRisk
Then every supplied filter must match simultaneously and totalCount reflects the combination
And q matches referenceCode or destinationAddress (contains, case-insensitive)
And a status/priority value outside the schema enum → 400 ProblemDetails (fail loudly, §7)
And a slaRisk value other than true/false → 400 ProblemDetails
```

**AC-8 — F8 sorting (including SLA due date)**
```
Given shipments exist with different createdAt and slaDueAt values
When I GET /api/v1/shipments without sort
Then the page is ordered by createdAt descending (newest first)
When I pass sort=slaDueAt or sort=-slaDueAt
Then the page is ordered by SLA due instant ascending, respectively descending
And sort=createdAt and sort=-createdAt are accepted too
And ties break deterministically by id (descending for -createdAt, ascending otherwise) so
    pagination never duplicates or skips a row
And an unknown sort value → 400 ProblemDetails
And rows with slaDueAt = null (seeded/pre-LOGI-0007 data) sort last in both directions
```

**AC-9 — BR-2: "at risk" is a read-time projection on the list**
```
Given a shipment with slaDueAt = 2026-09-20T08:00:00Z (Example A of BR-sla-rules §3)
And the server clock is truncated to whole seconds before the comparison
Then atRisk is true when now >= slaDueAt - 2h (inclusive boundary) and the status is not
     Delivered or Cancelled — Pending, Assigned, InTransit and Delayed are all eligible
And atRisk is false once the status is Delivered or Cancelled, and when slaDueAt is null
And the value reflects the request instant: there is no stored at_risk/breached column and no
     scheduled job (BR-sla-rules rule 2.5) — it is computed per query in the Application layer
And GET /api/v1/shipments?slaRisk=true returns exactly the at-risk rows while slaRisk=false
     returns exactly the complement, with totalCount consistent with the filter
```

**AC-10 — Authorization (RBAC enforced from day one)**
```
Given I have no Authorization header
When I POST or GET /api/v1/shipments
Then I receive 401 ProblemDetails
Given I am logged in as a Viewer
When I POST /api/v1/shipments
Then I receive 403 ProblemDetails (BR-6)
Given I am logged in as a Viewer, Admin or Dispatcher
When I GET /api/v1/shipments
Then I receive 200 (Viewer is read-only, not blind)
Given I am logged in as a Driver
When I POST /api/v1/shipments
Then I receive 403 ProblemDetails (BR-6 — only Admin/Dispatcher may create)
And GET /api/v1/shipments is 403 for a Driver until own-route scoping lands (LOGI-0009/0010, §7)
```

**AC-11 — Integration seam with the LOGI-0006 lifecycle**
```
Given a shipment created by this endpoint (status Pending)
When I POST /api/v1/shipments/{id}/status-transitions with { "toStatus": "Assigned" }
Then the transition succeeds with 200 (the created row satisfies the BR-7 state machine)
And GET /api/v1/shipments/{id}/status-history lists the initial Pending row first
     (fromStatus null, changedByUserId = the creator, changedAt = createdAt), then "Assigned"
And the list (AC-6..AC-9) subsequently shows status "Assigned" for that shipment
```

## 5. Out of scope (explicit)
- Editing a shipment and the cancel UX — LOGI-0008 (cancel calls the LOGI-0006 transition endpoint;
  no new status-write path is introduced here).
- Route creation and vehicle/driver assignment (BR-3, BR-4) — LOGI-0009; assigning shipments to a
  route including the BR-5 capacity check — LOGI-0010. `routeId` is returned (null) but never set.
- Planning board / kanban (LOGI-0011) and dashboard aggregates / SLA-risk *list block* (LOGI-0012).
  Only the read-time `atRisk` projection on the shipments query lands here, because
  `Docs/business-rules/BR-sla-rules.md` §2.5 names this query as its enforcement seam.
- `GET /shipments/{id}` (shipment detail) — deferred to LOGI-0008, which needs it for editing;
  F5/F8 require only create + list (AC-11 proves the created row through the LOGI-0006 endpoints).
- Driver own-route visibility scoping (see §7) — LOGI-0009/0010.
- Geocoding / address normalisation: destination coordinates are stored as supplied.
- Bulk import (CSV), duplicate-shipment detection, creation webhooks or notifications.
- Persisting `at_risk`/`breached`, SLA history tables or breach reporting (BR-sla-rules §5).

## 6. Data touched
- Reads: `warehouses` (origin existence + list display), `shipments` (list, filters, SLA projection).
- Writes: `shipments` (single insert) and `shipment_status_history` (the initial `Pending` row) in
  **one transaction** — either both rows exist or neither does.
- Never written here: `shipments.status` after creation (LOGI-0006 owns transitions),
  `shipments.route_id` (LOGI-0010), any at-risk column (it does not exist by design).
- Migration: **none** — `shipments` and `shipment_status_history` plus the unique index on
  `reference_code` and the `status`/`sla_due_at` indexes already exist from LOGI-0006's migration
  `20260922095953_LOGI-0006_AddShipmentStatusHistory`.

## 7. Open questions (safe defaults applied — confirm at the checkpoint)
| Question | Safe default applied |
|---|---|
| Scope of the list `q` filter | Matches `referenceCode` or `destinationAddress`, contains + case-insensitive (warehouse/vehicle `q` precedent) |
| Unknown filter enum / sort value | 400 (fail loudly — BR-1 rule 1.7 spirit) rather than a silently empty page |
| Driver access to `GET /shipments` | Excluded (403) for now; own-route scoping is enforced from LOGI-0009/0010, matching the LOGI-0006 deferral and the `x-roles` example in `05-api-contract-standards` |
| `priority` sent as an empty string vs omitted | Omitted/null → `Standard` (BR-1 rule 1.3); explicit empty/whitespace → 400 (rule 1.7) |
| Shipment detail endpoint | Deferred to LOGI-0008; the 201 create response is the authoritative read-back until then |
| Unknown `originWarehouseId` | 400 with `errors.originWarehouseId` (driver user-link precedent), not 404 — the requested resource (a shipment) does not exist yet |
| Reference-code format and generation | `SHP-` + 6 zero-padded digits derived from the current maximum id with a bounded collision retry; no sequence table (the unique index stays authoritative) |

## 8. Non-functional requirements
- Create responds <300ms p95; list/search <300ms p95 at ~1000 shipments (template §8 budget).
- The list uses the existing indexes (`ix_shipments_status`, `ix_shipments_sla_due_at`, unique
  `ix_shipments_reference_code`); `atRisk` is never a WHERE clause for the unfiltered case, and
  `slaRisk` filtering is a computed predicate over the same result set (SQLite v1 volumes — revisit
  with an ADR if dashboard p95 exceeds 300ms, per BR-sla-rules §6).
- Every instant is a whole-second ISO8601 UTC timestamp; comparisons truncate to whole seconds
  (BR-sla-rules precision note) so tests and implementation compare identical instants.
- Errors are RFC 7807 ProblemDetails with `errors` keyed by field name (05-api-contract-standards).

---
## Downstream artifacts this spec produces (for traceability)
- `contracts/v1-openapi.yaml` — `POST /shipments` + `GET /shipments`, `ShipmentRequest` /
  `ShipmentResponse` (Architect Agent, this arm).
- `tools/contract/index.mjs` — `shipments` resource registered for slice-first reads (tooling
  follow-up recorded in LOGI-0006 §5).
- Migration — **none**: tables and indexes shipped with LOGI-0006.
- `src/backend/LogiFlow.Application/Features/Shipments/CreateShipment*` (command + validator +
  one `SlaPolicy` unit holding the BR-1 offset table) and `ListShipmentsQuery` (Backend Agent).
- `src/frontend/src/features/shipments/` — shipment list (filters, sort, pagination, at-risk
  badge) + create form, with MSW handlers and the regenerated typed client (Frontend Agent).
- `tests/e2e/create-shipment.spec.ts` + `tests/e2e/shipments-list.spec.ts` covering AC-1..AC-11
  (QA Agent).


