# 04 — The Application Layer (use cases, validation, exceptions)

The heart of the backend: every request becomes a MediatR message, gets validated, and lands in a
handler that talks to the database through a seam.

## 1. Messages: `ICommand` / `IQuery`

```csharp
// Application/Messaging/Messaging.cs — thin markers over MediatR's IRequest
public interface ICommand<TResponse> : IRequest<TResponse>;   // mutating, has a result
public interface ICommand : IRequest;                         // mutating, no result (204)
public interface IQuery<TResponse> : IRequest<TResponse>;     // read-only
```

They change nothing at runtime — they make intent greppable and keep CQRS vocabulary explicit.
MediatR (registered by assembly scan in `AddApplication()`) routes each message to its
`IRequestHandler<TRequest, TResponse>`.

## 2. Anatomy of a use case (the warehouse slice)

```csharp
// 1) message — an immutable record; property names match the contract's camelCase
public record CreateWarehouseCommand(string Name, string Address, double? Latitude, double? Longitude)
    : ICommand<WarehouseDto>;

// 2) validation — runs BEFORE the handler for every request (see §3)
public class CreateWarehouseValidator : AbstractValidator<CreateWarehouseCommand>
{
    public CreateWarehouseValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Address).NotEmpty().MaximumLength(500);
        RuleFor(x => x.Latitude).InclusiveBetween(-90d, 90d).When(x => x.Latitude.HasValue);
        RuleFor(x => x.Longitude).InclusiveBetween(-180d, 180d).When(x => x.Longitude.HasValue);
    }
}

// 3) handler — primary-constructor DI, one awaitable Handle method
public class CreateWarehouseHandler(IAppDbContext db) : IRequestHandler<CreateWarehouseCommand, WarehouseDto>
{
    public async Task<WarehouseDto> Handle(CreateWarehouseCommand request, CancellationToken ct)
    {
        var warehouse = Domain.Warehouse.Create(request.Name, request.Address,
            request.Latitude, request.Longitude, DateTime.UtcNow);
        db.Warehouses.Add(warehouse);
        await db.SaveChangesAsync(ct);
        return new WarehouseDto(warehouse.Id, warehouse.Name, ...);
    }
}
```

**Reads** look the same but use `IQuery<T>` + `AsNoTracking()` + a paging envelope:

```csharp
public record ListWarehousesQuery(int Page = 1, int PageSize = 25, string? Q = null)
    : IQuery<PagedResult<WarehouseDto>>;
// handler: filter → CountAsync → OrderBy(Id).Skip/Take → Select(Dto) → PagedResult.Create(...)
```

Handler idioms used throughout:

- **`?? throw new NotFoundException(...)`** after `SingleOrDefaultAsync` → 404.
- **Project to the DTO inside the query** (`.Select(w => new WarehouseDto(...))`) — never return
  entities from a read path.
- **Paging defaults** live on the record; `Page ≥ 1`, `PageSize 1..100` enforced by the validator.
- **`CancellationToken ct`** threaded to every EF call.
- Writes call `SaveChangesAsync` at the exact point the transaction should close.

## 3. The validation pipeline

```csharp
// Application/Behaviors/ValidationBehavior.cs — a MediatR IPipelineBehavior<,>
if (!validators.Any()) return await next();
var failures = (await Task.WhenAll(validators.Select(v => v.ValidateAsync(context, ct))))
    .SelectMany(r => r.Errors).Where(f => f is not null).ToList();
if (failures.Count != 0) throw new ValidationException(failures);   // → 400 ProblemDetails
return await next();
```

- Registered once: `services.AddScoped(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>))`.
- Validators are registered **per type**, not scanned — `Application/DependencyInjection.cs` lists
  every `IValidator<T>` explicitly (the convention: one line per command/query, grouped by ticket).
  *If you add a validator and forget this line, it silently never runs — tests must cover it.*
- Multiple validators for one message all run; all failures are aggregated into the 400 `errors`
  map (keys camelCased by the middleware).
- Validators check **shape and ranges**; correctness that needs state (unknown warehouse, wrong
  status) is checked in the handler (→ 400/404/409) or the domain (→ 409/403).

## 4. The exception vocabulary (`Application/Common/`)

| Exception | HTTP | Thrown when | File |
|---|---|---|---|
| `ValidationException` (FluentValidation) | 400 | shape/range rules fail | pipeline |
| `UnauthorizedException` | 401 | bad credentials, unusable refresh token | `UnauthorizedException.cs` |
| `ForbiddenException` | 403 | payload-dependent role rule (e.g. cancel BR-6) | `ForbiddenException.cs` |
| `NotFoundException` | 404 | entity id does not exist | **defined in `PagedResult.cs`** |
| `ConflictException` | 409 | unique-key clash **or** caller-supplied state message | `ConflictException.cs` |
| domain exceptions (`IllegalShipmentTransitionException`, `ShipmentNotAssignableException`, ...) | — | raised inside Domain | translated to `ConflictException`/409 by handlers |

The two-constructor `ConflictException` matters: `ConflictException(resource, key)` builds the
"already exists" message; `ConflictException(message)` lets the caller supply wording that will be
**echoed verbatim** as the 409 `detail` (the frontend shows it directly).

Domain exceptions never cross the Api boundary unmapped — handlers catch and rethrow them as the
Common types (see `AssignShipmentToRouteHandler`).

## 5. The paging envelope

```csharp
public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize,
                             int TotalCount, int TotalPages)
{
    public static PagedResult<T> Create(...) => ...;   // TotalPages = ceil(total/pageSize)
}
```

Serialized camelCase it is exactly the contract's list shape (`items/page/pageSize/totalCount/
totalPages`) — the same shape the frontend's `Paged<T>` type aliases.
