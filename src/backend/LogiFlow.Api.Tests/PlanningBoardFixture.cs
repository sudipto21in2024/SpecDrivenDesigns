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
/// Shared seeding + board-reading helpers for the LOGI-0011 planning-board tests. Extracted so
/// each AC group stays inside the 150-line governance gate instead of one file growing to hold
/// every case.
///
/// Route assignment is written straight onto the row (as the LOGI-0010 tests do) so a board can be
/// loaded with a given shape without running the assignment endpoint for every case.
/// </summary>
public class PlanningBoardFixture
{
    public const string BoardUrl = "/api/v1/planning-board";

    /// <summary>
    /// Seed rows carry a synthetic actor id: the board never reads who assigned a shipment (it
    /// projects routeId, not the history), so this only satisfies the domain signature.
    /// </summary>
    private const long SeededUserId = 1;

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly LogiFlowTestFactory _factory;
    private HttpClient _dispatcher = null!;
    private long _warehouseId;

    public PlanningBoardFixture(LogiFlowTestFactory factory) => _factory = factory;

    /// <summary>A signed-in Dispatcher client — the role the board is designed for.</summary>
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

    public async Task<JsonElement> GetBoardAsync(HttpClient? client = null, string query = "")
    {
        var res = await (client ?? await DispatcherAsync()).GetAsync($"{BoardUrl}{query}");
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

    public async Task<long> SeedVehicleAsync(double capacityKg, string tag)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var v = Vehicle.Create($"V-{tag}-{Guid.NewGuid():N}"[..12], "Van", capacityKg, "Available", DateTime.UtcNow);
        db.Vehicles.Add(v);
        await db.SaveChangesAsync();
        return v.Id;
    }

    public async Task<long> SeedPlannedRouteAsync(long? vehicleId, string tag)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var start = DateTime.UtcNow.AddDays(7);
        var r = Route.Create($"Route {tag} {Guid.NewGuid():N}"[..24], start, start.AddHours(8),
            vehicleId, null, DateTime.UtcNow);
        db.Routes.Add(r);
        await db.SaveChangesAsync();
        return r.Id;
    }

    public async Task<long> SeedShipmentAsync(
        string status, double weightKg = 100, string priority = "Standard",
        double slaDueInHours = 48, long? routeId = null, string address = "1 Dest Rd")
    {
        await EnsureWarehouseAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var code = $"SHP-{Guid.NewGuid():N}"[..16].ToUpperInvariant();
        var s = Shipment.Create(code, _warehouseId, address, null, null, weightKg,
            status, priority, DateTime.UtcNow.AddHours(slaDueInHours), DateTime.UtcNow);
        if (routeId.HasValue)
        {
            // BR-7/logic: assignment is Pending-only and auto-transitions to Assigned, so a seeded
            // shipment can only be placed on a route by seeding it Pending first.
            if (status != nameof(ShipmentStatus.Pending))
                s = Shipment.Create(code, _warehouseId, address, null, null, weightKg,
                    nameof(ShipmentStatus.Pending), priority,
                    DateTime.UtcNow.AddHours(slaDueInHours), DateTime.UtcNow);
            s.AssignToRoute(routeId.Value, SeededUserId, DateTime.UtcNow);
        }
        db.Shipments.Add(s);
        await db.SaveChangesAsync();
        return s.Id;
    }

    // ---- JSON navigation ---------------------------------------------------------------------------

    public static JsonElement[] Columns(JsonElement board) =>
        board.GetProperty("columns").EnumerateArray().ToArray();

    public static JsonElement Column(JsonElement board, string status) =>
        Columns(board).Single(c => c.GetProperty("status").GetString() == status);

    public static IEnumerable<JsonElement> Cards(JsonElement board, string status) =>
        Column(board, status).GetProperty("cards").EnumerateArray();

    public static IEnumerable<JsonElement> AllCards(JsonElement board) =>
        Columns(board).SelectMany(c => c.GetProperty("cards").EnumerateArray());

    public static IEnumerable<long> CardIds(JsonElement board, string status) =>
        Cards(board, status).Select(c => c.GetProperty("id").GetInt64());

    public static IEnumerable<string> ColumnOrder(JsonElement board) =>
        Columns(board).Select(c => c.GetProperty("status").GetString()!);
}