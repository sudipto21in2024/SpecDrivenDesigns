# 06 — Persistence (EF Core + SQLite)

How entities become tables, how requests become transactions, and how the database is created.

## 1. The DbContext

```csharp
// Infrastructure/Persistence/LogiFlowDbContext.cs
public class LogiFlowDbContext(DbContextOptions<LogiFlowDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<long>, long>(options), IAppDbContext
{
    public DbSet<Warehouse> Warehouses => Set<Warehouse>();
    public DbSet<Vehicle> Vehicles => Set<Vehicle>();
    public DbSet<Driver> Drivers => Set<Driver>();
    public DbSet<Shipment> Shipments => Set<Shipment>();
    public DbSet<ShipmentStatusHistory> ShipmentStatusHistory => Set<ShipmentStatusHistory>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Route> Routes => Set<Route>();
    // ExecuteInTransactionAsync(...) + OnModelCreating(...)
}
```

- **`IAppDbContext`** is the Application-facing seam: the same `DbSet`s + `SaveChangesAsync` +
  `ExecuteInTransactionAsync`, with zero EF types leaking into handlers (implemented by explicit
  interface or passthrough in this file).
- Inheritance from `IdentityDbContext` gives the AspNet Identity tables (`users`, `roles`,
  `user_roles`, ...) mapped with `long` keys, reusing the same `AppUser` domain entity.

## 2. Mapping: snake_case, configured in one place

All mapping is Fluent API in `OnModelCreating` (plus `Configurations/RouteConfiguration.cs` for
routes) — no data annotations on entities:

```csharp
modelBuilder.Entity<Vehicle>(entity =>
{
    entity.ToTable("vehicles");
    entity.Property(v => v.Id).HasColumnName("id").ValueGeneratedOnAdd();
    entity.Property(v => v.PlateNumber).HasColumnName("plate_number").IsRequired().HasMaxLength(20);
    entity.Property(v => v.CapacityKg).HasColumnName("capacity_kg").IsRequired();
    entity.HasIndex(v => v.PlateNumber).IsUnique();      // AC-3 uniqueness + list filter key
});
```

Conventions:

- Tables/columns are **snake_case** per `Docs/ProjectTechGuidence/04-database-schema.md`.
- Unique indexes encode business uniqueness: `vehicles.plate_number`, `drivers.license_number`.
- Status columns are TEXT; the closed value sets are enforced in code, not DB CHECKs (SQLite
  portability; ADR-005 keeps this).
- Changes to the model require a migration (§4) — `dotnet build` + `ef migrations has-pending-
  model-changes` style checks are part of the repo's gates.

## 3. Transactions: `ExecuteInTransactionAsync`

```csharp
public async Task<T> ExecuteInTransactionAsync<T>(Func<CancellationToken, Task<T>> work, ...)
{
    await using var transaction =
        await Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
    try { var result = await work(ct); await transaction.CommitAsync(ct); return result; }
    catch { await transaction.RollbackAsync(ct); throw; }
}
```

**Why Serializable is load-bearing (BR-5):** SQLite defaults to a DEFERRED transaction that takes
no write lock until the first write — two concurrent "does this shipment fit?" guards could both
read the same free capacity and both commit an over-capacity load. Serializable maps to SQLite's
IMMEDIATE transaction (write lock at BEGIN), so the second caller waits and re-reads committed
state. PostgreSQL maps it to true SERIALIZABLE, so ADR-005's port keeps the guarantee.

Used by `AssignShipmentToRouteHandler`: guard + mutate + audit-row append all inside one
transaction, one `SaveChanges` — "commit together or not at all" (LOGI-0010 AC-9).

## 4. Migrations

- Committed under `Persistence/Migrations/`, named by ticket:
  `20260918100153_LOGI-0001_AddWarehouses`, `..._LOGI-0003_AddIdentityAndRefreshTokens`,
  `..._LOGI-0004_AddVehicles`, `..._LOGI-0005_AddDrivers`, `..._LOGI-0006_AddShipmentStatusHistory`,
  `..._LOGI-0009_AddRoutes` (+ `LogiFlowDbContextModelSnapshot.cs`).
- **Applied automatically at startup** (`db.Database.Migrate()` in `Program.cs`) — except in the
  **Testing** environment, where the test factory owns schema creation.
- Create one: `dotnet ef migrations add LOGI-00XX_Thing -p LogiFlow.Infrastructure -s LogiFlow.Api`.
- Database file: `logiflow.db` (SQLite) unless `Database:ConnectionString` says otherwise.

## 5. Seeding

Two startup steps, both **Development-only** (`Program.cs`):

| Seeder | When | What |
|---|---|---|
| `SeedData.EnsureSeededAsync` | always in Development | the four role users (alex/dana/raj/vera @logiflow.dev, password `logiflow-dev-password`); idempotent — skips existing emails, throws loudly on failure |
| `DemoData.EnsureSeededAsync` | only when `DemoData:Enabled` | bulk warehouses/vehicles/drivers/shipments/routes for local UI work; **no-op if business data already exists** (can't double-seed or disturb tests) |

The **test factory seeds through the same `SeedData`**, so test credentials can never drift from
the documented dev credentials — and the frontend MSW mocks mirror the same four users/password
(`src/mocks/handlers.ts`).

## 6. Environment matrix

| Environment | Schema | Seed |
|---|---|---|
| Development | `Migrate()` at startup | `SeedData` + optional `DemoData` |
| Testing (test factory) | `EnsureCreatedAsync` on shared in-memory DB | `SeedData` via hosted initializer |
| Production | `Migrate()` at startup | none |

## 7. The PostgreSQL port (ADR-005)

v1 is SQLite, single-node. The seams that matter for the port are already in place: provider is
chosen in **one line** (`options.UseSqlite(connectionString)` in
`Infrastructure/DependencyInjection.cs`), transactions are expressed with ADO isolation levels that
map cleanly, and identifiers/queries avoid SQLite-only syntax. Keep that in mind when adding raw
SQL or provider-specific behaviors.
