# 05 — The Domain Model (`LogiFlow.Domain`)

Entities, their encapsulation idiom, and the business rules that live in code — not in SQL.

## 1. The entities

| Entity | Table | Notes |
|---|---|---|
| `AppUser` | Identity users (+`FullName`, `Role`) | extends Identity's user; role as a column |
| `RefreshToken` | `refresh_tokens` | hashed token, `ExpiresAt`, `RevokedAt`; `Issue()`/`Revoke()`/`IsActive()` |
| `Warehouse` | `warehouses` | name/address/coords/createdAt |
| `Vehicle` | `vehicles` | `PlateNumber` (unique), `CapacityKg`, `Type`, `Status` |
| `Driver` | `drivers` | `LicenseNumber` (unique), optional `UserId` link (1—1 with a user) |
| `Shipment` | `shipments` | the aggregate at the center of the system (§3) |
| `ShipmentStatusHistory` | `shipment_status_history` | append-only audit rows for BR-7 transitions |
| `Route` | `routes` | planned route, vehicle/driver assignment, status |

Supporting value types: `ShipmentStatus` (enum) + `ShipmentStatusValues` (string list + BR-7
table), `RouteStatusValues`, `Roles` (four role constants).

## 2. The encapsulation idiom

Entities use **private setters + factory/methods**, so state can only change through code that
knows the rules:

```csharp
public class Shipment
{
    public long Id { get; set; }                     // EF needs a public setter for keys
    public string Status { get; private set; } = null!;
    public double WeightKg { get; private set; }

    public static Shipment Create(..., DateTime now) => new() { ... };   // factory

    public ShipmentStatusEvent TransitionTo(string to, long userId, string? note, DateTime at) { ... }
}
```

- `Create`/`Update`/`TransitionTo`/`AssignToRoute` are the **only** ways state changes; handlers
  call them instead of assigning properties (except `UpdatedAt`, set by the methods themselves).
- Validation split: *shape* in Application validators, *state/invariants* in the entity methods,
  which throw **domain exceptions** (below).
- The event-return style (`ShipmentStatusEvent`) lets a handler persist the mutation and append the
  audit row from one call.

## 3. The `Shipment` aggregate — where BR-7 lives

```text
Status machine (ShipmentStatusValues.LegalNextStates):
  Pending    → Assigned | Cancelled
  Assigned   → InTransit | Cancelled
  InTransit  → Delivered | Delayed
  Delayed    → InTransit                     (Delayed → Cancelled deliberately NOT legal)
  Delivered  → (terminal)                    Cancelled → (terminal)
```

| Method | Rule | On violation |
|---|---|---|
| `TransitionTo(to, user, note, at)` | only edges from the BR-7 table; returns the audit event to append | `IllegalShipmentTransitionException` → handler → **409** whose detail *names the legal next state(s)* |
| `UpdateDetails(...)` | descriptive edits only while `Pending` (LOGI-0008); server-owned fields (`referenceCode`, `status`, `priority`, `slaDueAt`) are not even in the signature | `ShipmentNotEditableException` → 409 |
| `AssignToRoute(routeId, user, at)` | must be `Pending` and unassigned; sets `RouteId`, status→`Assigned`, returns audit event | `ShipmentNotAssignableException` / `ShipmentAlreadyAssignedException` → 409 |
| `UnassignFromRoute(expectedRouteId, user, at)` | route must match; status must be `Assigned`; reverts to `Pending` **without** going through `TransitionTo` (BR-7 has no Assigned→Pending edge — see the method comment: routing it through the validator would extend a BRD rule by implementation) | `ShipmentNotOnRouteException` → **404**; `ShipmentNotAssignableException` → 409 |

Domain exception classes are defined at the bottom of `Shipment.cs` — their **messages are the API
contract**: the 409 `detail` the frontend shows users is these strings verbatim.

## 4. Domain exceptions vs application exceptions

```text
Domain  (Shipment.cs):   IllegalShipmentTransition, ShipmentNotEditable, ShipmentNotAssignable,
                         ShipmentAlreadyAssigned, ShipmentNotOnRoute
                              │  caught by Application handlers
                              ▼
Application (Common/):   ConflictException(message)  → 409
                         NotFoundException / ForbiddenException / UnauthorizedException
                              │  thrown out of the handler (or domain thrown directly)
                              ▼
Api middleware:          RFC 7807 ProblemDetails with the right status code
```

Handlers that invoke domain methods wrap them in `try/catch` and rethrow as
`ConflictException(ex.Message)` — one vocabulary at the HTTP boundary, precise vocabulary inside
the model.

## 5. `Roles`

```csharp
public static class Roles
{
    public const string Admin = "Admin", Dispatcher = "Dispatcher", Driver = "Driver", Viewer = "Viewer";
    public static readonly IReadOnlyList<string> All = [Admin, Dispatcher, Driver, Viewer];
    public static bool IsKnown(string? role) => ...;
}
```

Declared once here so endpoint policies (ADR-007), seed data and the contract's `x-roles` cannot
drift apart. The frontend keeps its own mirror in
`src/frontend/src/features/auth/permissions.ts`; contract tests assert parity.

## 6. What deliberately is NOT in the Domain

- **Paging/filtering/DTO projection** — Application (queries must translate to SQL).
- **SLA offsets and the at-risk window** — `SlaPolicy` in Application (it must produce a
  SQL-translatable bound for the list query; see doc 08).
- **Route capacity summation** — `RouteCapacityGuard` in Application (needs route + vehicle + a
  running sum across shipments, i.e. multiple aggregates + a transaction).
- Anything EF Core — the Domain has no `using Microsoft.EntityFrameworkCore`.

The split is intentional: pure invariants that need no I/O live in the entity; rules that need
queries or must be expressed in SQL live in Application, each in exactly one named class.
