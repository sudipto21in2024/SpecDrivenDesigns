using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Shared seeding + dashboard-reading helpers for the LOGI-0012 tests. Extracted so each AC group
/// stays inside the 150-line governance gate.
///
/// Due dates are seeded as offsets from now so a case can sit clearly INSIDE or clearly OUTSIDE the
/// 2h BR-2 window: a shipment exactly on the boundary would be a coin flip between two runs, which
/// is the one thing the determinism assertion (AC-8) cannot tolerate.
/// </summary>
public class DashboardFixture
{
    public const string DashboardUrl = "/api/v1/dashboard";
    public const string ShipmentsUrl = "/api/v1/shipments";

    private const long SeededUserId = 1;

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly LogiFlowTestFactory _factory;
    private HttpClient _dispatcher = null!;
    private long _warehouseId;

    public DashboardFixture(LogiFlowTestFactory factory) => _factory = factory;

    public async Task<HttpClient> SignInAsync(string role)
    {
        var client = _factory.CreateClient();
        await client.SignInAsync(role);
        return client;
    }

    public async Task<HttpClient> DispatcherAsync()
    {
        if (_dispatcher is not null) return _dispatcher;
        _dispatcher = await SignInAsync(Roles.Dispatcher);
        return _dispatcher;
    }

    public HttpClient Anonymous() => _factory.CreateClient();

    public async Task<JsonElement> GetDashboardAsync(HttpClient? client = null, string query = "")
    {
        var res = await (client ?? await DispatcherAsync()).GetAsync($"{DashboardUrl}{query}");
        res.StatusCode.Should().Be(HttpStatusCode.OK);
        return await res.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    // ---- seeding -----------------------------------------------------------------------------------

    private async Task EnsureWarehouseAsync()
    {
        if (_warehouseId != 0) return;
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var w = Warehouse.Create($"WH-{Guid.NewGuid():N}"[..12], "1 Test Rd", 0, 0, DateTime.UtcNow);
        db.Warehouses.Add(w);
        await db.SaveChangesAsync();
        _warehouseId = w.Id;
    }

    public async Task<long> SeedVehicleAsync(string status, double capacityKg = 1000)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var v = Vehicle.Create($"V-{Guid.NewGuid():N}"[..12], "Van", capacityKg, status, DateTime.UtcNow);
        db.Vehicles.Add(v);
        await db.SaveChangesAsync();
        return v.Id;
    }

    public async Task<long> SeedDriverAsync(string status)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var d = Driver.Create($"Driver {Guid.NewGuid():N}"[..20],
            $"L-{Guid.NewGuid():N}"[..12], null, status, null);
        db.Drivers.Add(d);
        await db.SaveChangesAsync();
        return d.Id;
    }

    public async Task<long> SeedRouteAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var start = DateTime.UtcNow.AddDays(7);
        var r = Route.Create($"Route {Guid.NewGuid():N}"[..24], start, start.AddHours(8),
            null, null, DateTime.UtcNow);
        db.Routes.Add(r);
        await db.SaveChangesAsync();
        return r.Id;
    }

    /// <summary>
    /// Seeds one shipment. <c>slaDueInHours</c> places the BR-2 due date relative to now: anything
    /// at or under 2 is at risk (unless the status is exempt), anything beyond is not. Passing
    /// <c>nullDueAt</c> models BR-2 rule 2.7 — a shipment with no promise is never at risk.
    /// </summary>
    public async Task<long> SeedShipmentAsync(
        string status, double slaDueInHours = 48, string priority = "Standard",
        long? routeId = null, bool nullDueAt = false, string address = "1 Dest Rd")
    {
        await EnsureWarehouseAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var code = $"SHP-{Guid.NewGuid():N}"[..16].ToUpperInvariant();
        var dueAt = nullDueAt ? (DateTime?)null : DateTime.UtcNow.AddHours(slaDueInHours);
        var s = Shipment.Create(code, _warehouseId, address, null, null, 100,
            status, priority, dueAt, DateTime.UtcNow);

        // BR-7/logic: assignment is Pending-only and auto-transitions, so a seeded shipment can
        // only carry a route when it was created Pending (the LOGI-0011 fixture does the same).
        if (routeId.HasValue)
        {
            if (status != nameof(ShipmentStatus.Pending))
            {
                s = Shipment.Create(code, _warehouseId, address, null, null, 100,
                    nameof(ShipmentStatus.Pending), priority, dueAt, DateTime.UtcNow);
            }
            s.AssignToRoute(routeId.Value, SeededUserId, DateTime.UtcNow);
        }

        db.Shipments.Add(s);
        await db.SaveChangesAsync();
        return s.Id;
    }

    // ---- JSON navigation ---------------------------------------------------------------------------

    public static JsonElement[] StatusCounts(JsonElement d) =>
        d.GetProperty("statusCounts").EnumerateArray().ToArray();

    public static int CountFor(JsonElement d, string status) =>
        StatusCounts(d).Single(c => c.GetProperty("status").GetString() == status)
            .GetProperty("count").GetInt32();

    public static IEnumerable<string> StatusOrder(JsonElement d) =>
        StatusCounts(d).Select(c => c.GetProperty("status").GetString()!);

    public static JsonElement AtRiskPage(JsonElement d) => d.GetProperty("atRiskShipments");

    public static IEnumerable<JsonElement> AtRiskRows(JsonElement d) =>
        AtRiskPage(d).GetProperty("items").EnumerateArray();

    public static IEnumerable<long> AtRiskIds(JsonElement d) =>
        AtRiskRows(d).Select(r => r.GetProperty("id").GetInt64());

    public static JsonElement VehicleUtilization(JsonElement d) => d.GetProperty("vehicleUtilization");

    public static JsonElement DriverUtilization(JsonElement d) => d.GetProperty("driverUtilization");

    /// <summary>
    /// A factory with its own empty database. The dashboard aggregates the WHOLE fleet, so the
    /// "no vehicles / no drivers at all" cases (AC-4, AC-5) cannot be asserted against the shared
    /// per-class database, where earlier tests in the same class have already seeded rows. A
    /// private factory is the only way to observe a genuinely empty fleet or driver pool.
    /// </summary>
    public static async Task<JsonElement> GetDashboardOnEmptyDatabaseAsync()
    {
        await using var fresh = new LogiFlowTestFactory();
        var fixture = new DashboardFixture(fresh);
        return await fixture.GetDashboardAsync();
    }

    /// <summary>Reads the at-risk row for one seeded shipment id, ignoring page ordering.</summary>
    public static JsonElement AtRiskRowFor(JsonElement d, long id) =>
        AtRiskRows(d).Single(r => r.GetProperty("id").GetInt64() == id);


    public static Dictionary<string, int> Bucket(JsonElement utilization) =>
        utilization.GetProperty("byStatus").EnumerateObject()
            .ToDictionary(p => p.Name, p => p.Value.GetInt32());

    /// <summary>Reads the shipment list as the same caller, for the AC-6 parity assertions.</summary>
    public async Task<JsonElement> GetShipmentsAsync(HttpClient client, string query)
    {
        var res = await client.GetAsync($"{ShipmentsUrl}{query}");
        res.StatusCode.Should().Be(HttpStatusCode.OK);
        return await res.Content.ReadFromJsonAsync<JsonElement>(Json);
    }
}

