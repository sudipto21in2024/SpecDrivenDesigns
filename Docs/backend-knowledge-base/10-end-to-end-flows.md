# 10 — End-to-End Code Flows & Cheat Sheet

Traced walkthroughs that tie every document together. Each trace lists the exact files in order.

## 1. Any request (the skeleton)

```text
HTTP → SerilogRequestLogging
     → ExceptionHandlingMiddleware (outermost try/catch)
     → UseAuthentication  ─ invalid/missing token → OnChallenge → 401 ProblemDetails (+WWW-Authenticate)
     → UseAuthorization   ─ wrong role           → OnForbidden → 403 ProblemDetails
     → endpoint lambda:   bind params → ISender.Send(msg)
          → ValidationBehavior: IValidator<T>s → fail = FluentValidation ValidationException → 400
          → handler:  IAppDbContext queries/mutations (+ domain methods)
                 throws: NotFoundException 404 | ConflictException 409 | ForbiddenException 403
                         | UnauthorizedException 401 | (anything) 500
          → Results.Ok/Created/NoContent (camelCase JSON via System.Text.Json)
```

## 2. Login → authenticated call (full auth loop)

```text
POST /api/v1/auth/login {email, password}            AuthEndpoints.cs (AllowAnonymous)
  → LoginCommand (validator: email shape, password 1..128)
  → LoginCommandHandler: IUserCredentials.Find/CheckPassword
       fail → UnauthorizedException → 401 {type: .../unauthorized}     (anti-enumeration)
       ok   → TokenPairFactory.Issue → JwtTokenService.CreateAccessToken (sub/role/email claims)
              + RefreshToken.Issue(hash) → SaveChanges
  → 200 { accessToken, refreshToken, expiresIn, user }
Later: GET /api/v1/shipments  Authorization: Bearer <access>
  → JwtBearer validates (ClockSkew=0) → HttpContext.User → CurrentUser seam
  → RequireRoles(Admin, Dispatcher, Viewer) passes → ListShipmentsQuery ...
Refresh: POST /auth/refresh {refreshToken}
  → hash lookup → IsActive? → Revoke + Issue + ONE SaveChanges (atomic rotation) → 200 new pair
  → replay/unknown/expired → 401 (indistinguishable)
```

## 3. Create a warehouse (the write path)

```text
POST /api/v1/warehouses (role Admin|Dispatcher)       WarehouseEndpoints.cs
  → CreateWarehouseCommand record                      Features/Warehouses/WarehouseCommands.cs
  → ValidationBehavior: CreateWarehouseValidator
       Name 1..200, Address 1..500, lat/lng ranges    fail → 400 errors{name:[...]}
  → CreateWarehouseHandler: Domain.Warehouse.Create(...) → Add → SaveChanges
  → 201 Created + Location: /api/v1/warehouses/{id} + WarehouseDto
Errors: unknown shape → 400 (validator) | unauthenticated → 401 | Viewer role → 403
Frontend counterpart: dialog → useCreateWarehouse → invalidate ['warehouses'] → snackbar.
```

## 4. Assign a shipment to a route (transaction + BR-5 + BR-7)

```text
POST /api/v1/routes/{routeId}/shipments  {shipmentId}   (Admin|Dispatcher)
  → AssignShipmentToRouteCommand (validator: both ids > 0)
  → Handler wraps EVERYTHING in db.ExecuteInTransactionAsync(SERIALIZABLE):
       route lookup        → missing → 404
       route.Status==Planned? → else → 409 "only Planned routes can be assigned to"
       shipment lookup     → missing → 404
       same-route re-assign → idempotent 200 (answered BEFORE the status check)
       RouteCapacityGuard.EnsureFitsAsync (sum of assigned weights + new ≤ vehicle capacity)
                                          over-capacity → 409 (BR-5)
       shipment.AssignToRoute(...) domain guard (Pending & unassigned)
            throws → handler rethrows as ConflictException → 409 (BR-7/shipping rules)
       append shipment_status_history row; SaveChanges ONCE
  → 200 ShipmentDto (status "Assigned", routeId set) — authoritative read-back
Concurrency: a second boundary assign blocks at BEGIN (IMMEDIATE lock), re-reads, gets 409 —
this exact race is asserted by RouteShipmentAssignTests (LOGI-0010 AC-9).
```

## 5. Illegal status transition (domain → 409)

```text
POST /api/v1/shipments/{id}/status-transitions {toStatus: "Delivered"} from Pending
  → TransitionShipmentStatusCommand → handler → shipment.TransitionTo(...)
       LegalNextStates("Pending") = [Assigned, Cancelled]
       "Delivered" not in list → IllegalShipmentTransitionException
  → handler lets it surface as ConflictException(message) → 409
     detail: "Cannot transition shipment from Pending to Delivered: legal next state(s): Assigned, Cancelled."
  → frontend shows problem.detail verbatim + refetches the row.
```

## 6. Validation failure (400 anatomy)

```text
POST /api/v1/shipments with latitude: 95 (if it were a field) / name: "" on warehouses
  → ValidationBehavior aggregates ALL validator failures
  → ExceptionHandlingMiddleware groups by PropertyName → camelCase keys
  → 400 application/problem+json:
     { type: "https://logiflow.dev/errors/validation", title: "Validation failed",
       status: 400, detail: "One or more validation errors occurred.",
       errors: { name: ["'Name' must not be empty."] }, traceId: "..." }
  → frontend ApiError.fieldErrors → RHF setError(field) on the dialog field.
```

## 7. Cheat sheet: "Where do I change X?"

| I want to… | Touch |
|---|---|
| add/change an endpoint | `contracts/v1/` → `Endpoints/<F>Endpoints.cs` (+ `RequireRoles`) → map in `Program.cs` |
| change request validation | `Features/<F>/*Validator` **and** register it in `Application/DependencyInjection.cs` |
| change use-case logic | `Features/<F>/*Commands|Queries.cs` handler |
| change a business rule | its single home (doc 08): `SlaPolicy` / `Shipment.TransitionTo` / `RouteCapacityGuard` |
| change response shape | DTO record in `Features/<F>` → contract schema → regenerate frontend types |
| change DB shape | entity + `OnModelCreating` → `dotnet ef migrations add ...` → commit migration |
| change who can call an endpoint | contract `x-roles` → `RequireRoles(...)` → frontend `permissions.ts` → `*AuthzTests` |
| change error mapping/status | `Middleware/ExceptionHandlingMiddleware.cs` (+ `ProblemDetailsWriter`) |
| change token lifetime/key | `appsettings` `Jwt:*` → `JwtOptions` (docs say 15 min / 7 d defaults) |
| add seed/demo data | `Infrastructure/Seed/SeedData.cs` (users) or `DemoData.cs` (bulk, opt-in) |
| understand a flow | this document → then the files it lists |

## 8. How the two knowledge bases connect

```text
contracts/v1-openapi.yaml            ← the hinge: shapes, status codes, x-roles
   │                                    │
   ├─ backend/knowledge-base/          ├─ frontend/knowledge-base/
   │   endpoints mirror x-roles        │   schema.d.ts generated from it
   │   DTOs mirror schemas             │   permissions.ts mirrors x-roles
   │   ProblemDetails ↔ ApiError       │   MSW handlers mirror behavior
   │   244 integration tests           │   162 component tests
   └──────────── both suites must agree ────────────┘
```

If you are fixing a cross-cutting bug (say, a 409 the UI shows wrongly): read backend docs 03
(error pipeline) + 08 (which rule threw it), then frontend docs 05 (`ApiError`) + 06
(invalidation/refetch), and check the contract test that pins the behavior.

## 9. Suggested reading path (backend newcomer)

1. Doc 01 (stack/commands) — run `dotnet test` once so you know green looks like 244/244.
2. Doc 02 (solution architecture) + skim `Program.cs` with doc 03 open beside it.
3. Doc 04 (application layer) while reading `Features/Warehouses/*` — the smallest complete slice.
4. Doc 07 (auth) + `Features/Auth/AuthCommands.cs` — the flow every request depends on.
5. Doc 05 (domain) + `Domain/Shipment.cs` — the richest rule set, heavily commented.
6. Doc 06 (persistence) + `LogiFlowDbContext` — mapping and the transaction rationale.
7. Doc 08 (business rules) as a reference while working on tickets.
8. Doc 09 (testing) — write one small `*Tests.cs` following the `ShipmentCreateTests` shape.
9. Doc 10 traces — step through trace 4 (assign) in a debugger to watch the transaction and the
   exception → ProblemDetails conversion live.

