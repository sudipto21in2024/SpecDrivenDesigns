# 03 — The API Pipeline (`Program.cs` + endpoints + middleware)

How the host is wired and what happens to every request.

## 1. `Program.cs`, top to bottom

```text
1.  Serilog bootstrap (console + Logs/logiflow-<date>.txt), builder.Host.UseSerilog()
2.  JSON: PropertyNamingPolicy = CamelCase   ← matches the contract & the TS types
3.  builder.Services.AddApplication()        ← MediatR scan + validators + ValidationBehavior
4.  builder.Services.AddInfrastructure(cfg)  ← EF SQLite, Identity, JwtOptions, token seams
5.  AddHttpContextAccessor + AddScoped<ICurrentUser, CurrentUser>   ← identity seam (ADR-007)
6.  AddAuthentication(JwtBearer) — TokenValidationParameters (issuer/audience/signing key,
    ValidateLifetime, ClockSkew = TimeSpan.Zero) + JwtBearerEvents:
       OnChallenge → HandleResponse + ProblemDetails 401 (+ WWW-Authenticate: Bearer)
       OnForbidden → ProblemDetails 403
7.  AddAuthorization()
8.  Build():
       - Development: UseDeveloperExceptionPage
       - NOT Testing: db.Database.Migrate()            ← apply migrations on startup
       - Development: SeedData.EnsureSeededAsync (4 role users) + optional DemoData
9.  Pipeline order:
       ExceptionHandlingMiddleware → SerilogRequestLogging
       → UseAuthentication → UseAuthorization        ← authN MUST precede authZ
10. MapGet /api/v1/health (anonymous)
11. MapAuthEndpoints / MapWarehouse / MapVehicle / MapDriver / MapShipment /
    MapRoute / MapPlanningBoard / MapDashboard
12. app.Run()  +  public partial class Program;   ← needed by WebApplicationFactory in tests
```

Two deliberate quirks:

- **`ClockSkew = TimeSpan.Zero`** — tokens are 15 minutes; the framework's default 5-minute skew
  would silently extend every one of them by a third.
- **Auth failures never throw** — they short-circuit, so the exception middleware can't format
  them; that's why `JwtBearerEvents` write ProblemDetails directly.

## 2. Endpoint anatomy (`WarehouseEndpoints.cs` is the template)

```csharp
public static class WarehouseEndpoints
{
    public static IEndpointRouteBuilder MapWarehouseEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/warehouses").WithTags("Warehouses");

        group.MapGet("/", async ([AsParameters] ListWarehousesQuery query, ISender sender,
                                 CancellationToken ct) =>
            Results.Ok(await sender.Send(query, ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        group.MapPost("/", async (CreateWarehouseRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(
                new CreateWarehouseCommand(request.Name, request.Address, request.Latitude, request.Longitude), ct);
            return Results.Created($"/api/v1/warehouses/{dto.Id}", dto);
        })
            .RequireRoles(Roles.Admin, Roles.Dispatcher);
        // ... PUT (Admin/Dispatcher), DELETE (Admin only)
        return app;
    }
}
public record CreateWarehouseRequest(string Name, string Address, double? Latitude, double? Longitude);
```

Pattern notes:

- **`[AsParameters]`** binds GET query-string values onto the query record; POST/PUT bodies bind to
  a `*Request` record declared at the bottom of the same file (contract schema name).
- Every handler invocation is `sender.Send(commandOrQuery, ct)` — the endpoint does transport only:
  no validation, no business logic, no direct DB access.
- Response verbs follow the contract: `Results.Created(location, dto)` → 201 with `Location`,
  `Results.Ok` → 200, `Results.NoContent` → 204.

## 3. `RequireRoles(...)` — the x-roles adapter

```csharp
// Authorization/CurrentUser.cs
public static TBuilder RequireRoles<TBuilder>(this TBuilder builder, params string[] roles)
    where TBuilder : IEndpointConventionBuilder
{
    ArgumentOutOfRangeException.ThrowIfZero(roles.Length);
    var policy = new AuthorizationPolicyBuilder().RequireRole(roles).Build();
    return builder.RequireAuthorization(policy);
}
```

- Semantics = the contract's `x-roles` list: **any-of whitelist**, never a conjunction.
- Missing/invalid token → **401** (with bearer challenge); valid token, wrong role → **403** — both
  as ProblemDetails, produced by `OnChallenge`/`OnForbidden` (see §1).
- Anonymous endpoints opt out with `.AllowAnonymous()` (auth token endpoints, health).
- A *payload-dependent* rule (e.g. only Admin/Dispatcher may cancel a shipment, BR-6) is not an
  endpoint policy — the handler throws `ForbiddenException`, which the middleware maps to the same
  403 shape.

## 4. The error pipeline

`ExceptionHandlingMiddleware` wraps the whole pipeline and converts exceptions to ProblemDetails
(`type` URLs under `https://logiflow.dev/errors/...`, camelCase `errors` map, `traceId`):

| Exception | Status | Source |
|---|---|---|
| FluentValidation `ValidationException` | **400** + `errors{field:[msgs]}` | `ValidationBehavior` before any handler runs |
| `UnauthorizedException` | **401** + bearer challenge | auth handlers (bad credentials, dead refresh token) |
| `NotFoundException` | **404** | handlers (`?? throw new NotFoundException(...)`) |
| `ConflictException` | **409** | unique-key clashes, illegal BR-7 transitions, capacity/state conflicts |
| `ForbiddenException` | **403** | payload-dependent role rules (BR-6) |
| anything else | **500** (details hidden, logged) | bugs |

`ProblemDetailsWriter` is the single serializer for both this middleware and the JWT events. It
no-ops when the response has already started, and adds `WWW-Authenticate: Bearer` after
`Response.Clear()` (order matters — `Clear()` drops headers).

## 5. One request, step by step

```text
HTTP request
  → SerilogRequestLogging (timing)
  → UseAuthentication: JwtBearer validates signature/lifetime → HttpContext.User (or 401+ProblemDetails)
  → UseAuthorization:  RequireRoles policy evaluates (or 403+ProblemDetails)
  → endpoint lambda:    binds parameters → ISender.Send(...)
      → MediatR resolves handler
      → ValidationBehavior: all IValidator<T> run → failures throw → 400
      → handler: queries/updates via IAppDbContext, may throw domain/app exceptions
  → Results.* written (camelCase JSON)
  on exception: ExceptionHandlingMiddleware → ProblemDetails body
```

