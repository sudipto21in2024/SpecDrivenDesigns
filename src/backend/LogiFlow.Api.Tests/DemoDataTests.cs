using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using LogiFlow.Infrastructure;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Guards the bulk demo dataset (<c>DemoData</c>).
///
/// This exists because the seeder's first draft chose each shipment's target state with nested
/// random thresholds, two of which were unreachable — Assigned, InTransit and Delayed silently came
/// out empty while startup still logged a cheerful "600 shipments seeded". Nothing else in the
/// suite would have caught it: the integration tests never enable DemoData, and the E2E suite
/// creates its own data. These assertions run the seeder directly and check the *shape* of the
/// result rather than one magic total.
/// </summary>
public class DemoDataTests
{
    private static async Task<(LogiFlowDbContext Db, SqliteConnection Connection)> NewDatabaseAsync()
    {
        // Same shared-cache in-memory pattern the WebApplicationFactory uses: EF opens a connection
        // per scope, so a private ":memory:" connection would lose the schema immediately.
        var connection = new SqliteConnection(
            $"Data Source=DemoDataTests-{Guid.NewGuid():N};Mode=Memory;Cache=Shared");
        connection.Open();

        var options = new DbContextOptionsBuilder<LogiFlowDbContext>()
            .UseSqlite(connection)
            .Options;

        var db = new LogiFlowDbContext(options);
        await db.Database.EnsureCreatedAsync();

        // DemoData attributes history rows to the Admin persona, so that user must exist first.
        var admin = SeedData.Users.First(u => u.Role == Roles.Admin).Email;
        db.Users.Add(new AppUser
        {
            UserName = admin,
            Email = admin,
            EmailConfirmed = true,
            FullName = "Alex Adams",
            Role = Roles.Admin,
            NormalizedEmail = admin.ToUpperInvariant(),
            NormalizedUserName = admin.ToUpperInvariant(),
        });
        await db.SaveChangesAsync();

        return (db, connection);
    }

    private static IConfiguration Config(bool enabled, int shipments) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [DemoData.EnabledKey] = enabled ? "true" : "false",
                [DemoData.ShipmentCountKey] = shipments.ToString(),
            })
            .Build();

    /// <summary>
    /// The core regression: every BR-7 state must have rows. A cohort collapsing to zero is the
    /// exact failure this test exists for.
    /// </summary>
    [Fact]
    public async Task EveryShipmentStatus_Is_Populated()
    {
        var (db, connection) = await NewDatabaseAsync();
        await using var _ = connection;
        await using var __ = db;

        await DemoData.EnsureSeededAsync(db, Config(enabled: true, shipments: 120), NullLogger.Instance);

        var byStatus = await db.Shipments
            .GroupBy(s => s.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync();

        foreach (var status in ShipmentStatusValues.All)
        {
            var count = byStatus.FirstOrDefault(r => r.Status == status)?.Count ?? 0;
            Assert.True(
                count > 0,
                $"No shipments reached status '{status}'. "
                + $"Populated: {string.Join(", ", byStatus.Select(r => $"{r.Status}={r.Count}"))}");
        }
    }

    /// <summary>
    /// The status written on the shipment and the audit trail must agree. If the seeder set a status
    /// without recording the transition, the shipment detail page and the history would disagree.
    /// </summary>
    [Fact]
    public async Task ShipmentStatus_MatchesItsLatestHistoryRow()
    {
        var (db, connection) = await NewDatabaseAsync();
        await using var _ = connection;
        await using var __ = db;

        await DemoData.EnsureSeededAsync(db, Config(enabled: true, shipments: 120), NullLogger.Instance);

        var mismatches = await (
            from shipment in db.Shipments
            let last = db.ShipmentStatusHistory
                .Where(h => h.ShipmentId == shipment.Id)
                .OrderByDescending(h => h.Id)
                .Select(h => h.ToStatus)
                .FirstOrDefault()
            where last != shipment.Status
            select new { shipment.ReferenceCode, shipment.Status, Last = last })
            .Take(5)
            .ToListAsync();

        Assert.True(
            mismatches.Count == 0,
            "Shipment status does not match its latest history row: "
            + string.Join("; ", mismatches.Select(m => $"{m.ReferenceCode} status={m.Status} history={m.Last}")));
    }

    /// <summary>Every shipment needs an initial history row (FromStatus null), as creation writes.</summary>
    [Fact]
    public async Task EveryShipment_HasAnInitialHistoryRow()
    {
        var (db, connection) = await NewDatabaseAsync();
        await using var _ = connection;
        await using var __ = db;

        await DemoData.EnsureSeededAsync(db, Config(enabled: true, shipments: 120), NullLogger.Instance);

        var missing = await (
            from shipment in db.Shipments
            where !db.ShipmentStatusHistory.Any(h => h.ShipmentId == shipment.Id && h.FromStatus == null)
            select shipment.ReferenceCode)
            .Take(5)
            .ToListAsync();

        Assert.True(
            missing.Count == 0,
            "Shipments with no initial history row: " + string.Join(", ", missing));
    }

    /// <summary>Opt-in gate: disabled configuration must not touch the database.</summary>
    [Fact]
    public async Task Disabled_WritesNothing()
    {
        var (db, connection) = await NewDatabaseAsync();
        await using var _ = connection;
        await using var __ = db;

        await DemoData.EnsureSeededAsync(db, Config(enabled: false, shipments: 500), NullLogger.Instance);

        Assert.Empty(await db.Warehouses.ToListAsync());
        Assert.Empty(await db.Shipments.ToListAsync());
    }

    /// <summary>
    /// Second call must be a no-op. The compose stack mounts a persistent volume, so without this the
    /// dataset would double on every restart — and reference_code / plate_number are unique.
    /// </summary>
    [Fact]
    public async Task RunningTwice_DoesNotDuplicate()
    {
        var (db, connection) = await NewDatabaseAsync();
        await using var _ = connection;
        await using var __ = db;

        var config = Config(enabled: true, shipments: 120);
        await DemoData.EnsureSeededAsync(db, config, NullLogger.Instance);
        var afterFirst = await db.Shipments.CountAsync();

        await DemoData.EnsureSeededAsync(db, config, NullLogger.Instance);

        Assert.Equal(afterFirst, await db.Shipments.CountAsync());
    }

    /// <summary>
    /// Uniqueness of the columns the schema constrains. A collision would abort the seed on a real
    /// (non-in-memory) database.
    /// </summary>
    [Fact]
    public async Task UniqueColumns_AreUnique()
    {
        var (db, connection) = await NewDatabaseAsync();
        await using var _ = connection;
        await using var __ = db;

        await DemoData.EnsureSeededAsync(db, Config(enabled: true, shipments: 200), NullLogger.Instance);

        Assert.Equal(
            await db.Shipments.CountAsync(),
            await db.Shipments.Select(s => s.ReferenceCode).Distinct().CountAsync());
        Assert.Equal(
            await db.Vehicles.CountAsync(),
            await db.Vehicles.Select(v => v.PlateNumber).Distinct().CountAsync());
        Assert.Equal(
            await db.Drivers.CountAsync(),
            await db.Drivers.Select(d => d.LicenseNumber).Distinct().CountAsync());
    }
}