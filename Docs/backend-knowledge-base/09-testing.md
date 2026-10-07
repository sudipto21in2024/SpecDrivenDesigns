# 09 — Testing (xUnit + WebApplicationFactory + real SQL)

**244 tests in 31 files, all green (~9s after build — verified with `dotnet test`).** These are
integration tests: they host the *real* API and talk to it over HTTP, exactly like the frontend's
tests do.

## 1. The stack

| Piece | File | Job |
|---|---|---|
| Test host | `LogiFlowTestFactory.cs` | `WebApplicationFactory<Program>` — boots the real `Program.cs` against SQLite in-memory |
| Sign-in helper | `TestAuth.cs` | logs in through the real `/api/v1/auth/login` and attaches the bearer token |
| Specs | `<Feature>Tests.cs` (31 files) | one file per feature/acceptance criteria group |
| Assertions | FluentAssertions | `status.Should().Be(HttpStatusCode.Created, ...)` style |
| Fixtures | `IClassFixture<LogiFlowTestFactory>`, `DashboardFixture`, `PlanningBoardFixture` | shared factory per test class / heavier shared state |

Packages: `xunit`, `FluentAssertions`, `Microsoft.AspNetCore.Mvc.Testing`, `coverlet.collector`
(versions in `Directory.Packages.props`).

## 2. `LogiFlowTestFactory` — the interesting part

```text
UseEnvironment("Testing")
  → Program.cs skips db.Database.Migrate() and dev seeding (the factory owns the schema)
Override Database:ConnectionString with an in-memory SQLite connection string
  Data Source=LogiFlowTests-<GUID>;Mode=Memory;Cache=Shared
Open ONE "keep-alive" connection for the factory lifetime
  → a shared-cache in-memory DB dies with its last connection; without this the schema
     would vanish between tests
Register a hosted initializer: EnsureCreatedAsync + SeedData.EnsureSeededAsync
  → schema + the four role users exist before the first request
```

Three design decisions are called out in the source comments because they are easy to "fix" into
brokenness:

1. **Shared-cache in-memory, not `:memory:`** — a private `:memory:` DB exists only inside its own
   connection, so the schema written by the initializer would be invisible to request scopes.
2. **Connection *string*, not a shared `SqliteConnection` object** — EF must be able to open
   *multiple* connections so two concurrent assigns can really hold two transactions; handing EF a
   single shared connection made the second `BeginTransaction` fail (surfacing 500 instead of the
   409 the BR-5 guard must produce). This is what makes LOGI-0010 AC-9 (concurrency) testable.
3. **A GUID database name per factory** — xUnit runs one factory per test class, in parallel, in
   one process; a constant name made every class share tables and contaminate each other's rows
   (duplicate-plate 409s, drifting counts).

## 3. Signing in — no token forging (`TestAuth.cs`)

```csharp
await _client.SignInAsync(Roles.Dispatcher);
// POST /api/v1/auth/login { email: SeedData user for the role, password: DevelopmentPassword }
// asserts 200, then sets Authorization: Bearer <accessToken> on the client
```

Because authentication goes through the **real** endpoint, RBAC assertions exercise actual JWT
validation and the actual role policies — nothing is bypassed. Role selection is data-driven
(`SeedData.Users`), so a changed seed email cannot silently break tests into using a stale
account. Unauthenticated cases simply skip `SignInAsync`.

## 4. Typical test shape

```csharp
public class ShipmentCreateTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        await _client.SignInAsync(Roles.Dispatcher);      // session established like a browser
    }

    [Fact] public async Task AC_1_creates_shipment()
    {
        var wh = await SeedWarehouseAsync();               // arrange via the API itself
        var (status, body) = await PostAsync(_client, new { originWarehouseId = wh, ... });
        status.Should().Be(HttpStatusCode.Created);        // act + assert
        body.GetProperty("status").GetString().Should().Be("Pending");
    }
}
```

Conventions:

- **Names are acceptance criteria**: `AC-3: server 400 ...`, `x-roles` behavior, BR references —
  executable spec traced to tickets (LOGI-0001…0012).
- **Arrange through the API** (create the warehouse by POSTing) so seed state is always legal.
- **Unique values per test** (`$"WH {Guid.NewGuid():N}"[..12]`) — classes share a database for
  their lifetime, so tests must not collide on unique keys.
- **Direct DB asserts** when the response isn't the whole truth: the test creates a scope from
  `_factory.Services`, resolves `LogiFlowDbContext`, and queries rows (e.g. history entries,
  revoked refresh tokens).
- **400 assertions read the `errors` map** by field name; 409 assertions read `detail` text.

## 5. Test inventory (by concern)

| Area | Files |
|---|---|
| master data endpoints | `WarehouseEndpointsTests`, `VehicleEndpointsTests`, `DriverEndpointsTests` (+ `UnitTest1.cs` legacy placeholder) |
| auth | `AuthEndpointsTests`, `SlaPolicyTests` (pure unit) |
| shipments | `ShipmentCreateTests`, `ShipmentListTests`, `ShipmentEditTests`, `ShipmentCancelTests`, `ShipmentEndpointsTests`, `ShipmentListRouteFilterTests` + `...ParityTests` |
| routes | `RouteCreateTests`, `RouteQueryTests`, `RouteAssignTests`, `RouteShipmentAssignTests`, `RouteShipmentListTests` |
| planning board | `PlanningBoard*Tests` (Read/Column/Contract/Authz) + `PlanningBoardFixture` |
| dashboard | `Dashboard*Tests` (AtRisk/Authz/Contract/StatusCount/Utilization) + `DashboardFixture` |
| misc | `DemoDataTests` |

Contract/parity tests (`*ContractTests`, `*ParityTests`) assert response **shape and semantics**
against the OpenAPI expectations — they are the backend's half of the frontend/backend parity net.

## 6. Running & debugging

```bash
cd src/backend
dotnet test                                    # everything (244)
dotnet test --filter "FullyQualifiedName~ShipmentCreate"   # one class/feature
dotnet test --filter "FullyQualifiedName~AC_1"             # one test
dotnet test --logger "console;verbosity=detailed"
```

Notes:

- First run after a clean pulls/builds all 5 projects; subsequent runs are fast (~9s).
- A failing test usually names the missing piece: an unregistered validator (silently skipped), a
  missing endpoint role, or a unique-key collision from reused data.
- Keep tests deterministic: never depend on wall-clock boundaries for SLA math (seed due dates
  clearly inside/outside the 2h window; the exact boundary is `SlaPolicyTests`' job).

