# API Contract Standards

Owned by the **Architect Agent**. `contracts/v1-openapi.yaml` is the single source of truth —
Backend and Frontend agents both generate/validate against it and must not diverge from it.

## Conventions

- Base path: `/api/v1`
- Resource naming: plural nouns — `/shipments`, `/vehicles`, `/drivers`, `/routes`, `/warehouses`
- Standard REST verbs: `GET` (list/detail), `POST` (create), `PUT` (full update),
  `PATCH` (partial update, e.g. status transition), `DELETE` (soft delete where applicable)
- Status transitions are their own sub-resource actions, not raw PATCH-anything:
  `POST /shipments/{id}/status-transitions` with body `{ "toStatus": "InTransit", "note": "..." }`
  — this keeps the audit trail (`shipment_status_history`) authoritative and centralizes
  transition validation (no skipping illegal states).

## Pagination

```json
GET /api/v1/shipments?page=1&pageSize=25&status=Pending&sort=-slaDueAt

{
  "items": [...],
  "page": 1,
  "pageSize": 25,
  "totalCount": 132,
  "totalPages": 6
}
```

## Error format (RFC 7807 Problem Details)

```json
{
  "type": "https://logiflow.dev/errors/validation",
  "title": "Validation failed",
  "status": 400,
  "detail": "weightKg must be greater than 0",
  "errors": { "weightKg": ["must be greater than 0"] },
  "traceId": "00-abc123..."
}
```

All error responses use this shape. Backend Agent implements a global exception middleware that
converts domain/validation exceptions into it; Frontend Agent's API client parses it uniformly.

## Auth

- `Authorization: Bearer <jwt>` on every request except `/auth/login`, `/auth/refresh`.
- 401 = not authenticated, 403 = authenticated but not authorized for this role/resource.
- Role checks documented per-endpoint in the OpenAPI `security` + custom `x-roles` extension, e.g.
  `x-roles: [Admin, Dispatcher]`.

## Versioning

- Breaking changes require a new major path (`/api/v2/...`); additive changes (new optional
  field, new endpoint) can land in `v1`. Architect Agent decides and records as ADR.

## Contract-first workflow

1. Architect Agent edits `contracts/v1-openapi.yaml` for the ticket's scope only.
2. Orchestrator runs `spectral lint` (or equivalent) — contract must pass lint before
   `CONTRACT_APPROVED`.
3. Frontend Agent generates a typed client (`openapi-typescript` + a thin fetch wrapper) and a
   mock server (e.g. `msw` fed from the same spec) so it can build UI without waiting on backend.
4. Backend Agent implements to match the spec exactly; a contract test (e.g. using
   `Microsoft.AspNetCore.Mvc.Testing` + schema validation against the YAML) runs in CI to catch
   drift automatically.

## Example endpoint definition (shipments)

```yaml
/shipments:
  get:
    summary: List shipments
    x-roles: [Admin, Dispatcher, Viewer]
    parameters:
      - { name: page, in: query, schema: { type: integer, default: 1 } }
      - { name: pageSize, in: query, schema: { type: integer, default: 25, maximum: 100 } }
      - { name: status, in: query, schema: { type: string } }
    responses:
      "200":
        description: Paged shipment list
        content:
          application/json:
            schema: { $ref: '#/components/schemas/PagedShipmentResponse' }
  post:
    summary: Create shipment
    x-roles: [Admin, Dispatcher]
    requestBody:
      content:
        application/json:
          schema: { $ref: '#/components/schemas/CreateShipmentRequest' }
    responses:
      "201": { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/ShipmentResponse' } } } }
      "400": { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ProblemDetails' } } } }
```
