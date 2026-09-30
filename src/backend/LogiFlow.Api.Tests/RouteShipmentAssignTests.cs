using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiFlow.Api.Tests;

public class RouteShipmentAssignTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _admin = null!;
    private HttpClient _dispatcher = null!;
    private HttpClient _viewer = null!;
    private HttpClient _driver = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public RouteShipmentAssignTests(LogiFlowTestFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _admin = _factory.CreateClient();
        await _admin.SignInAsync(Roles.Admin);
        _dispatcher = _factory.CreateClient();
        await _dispatcher.SignInAsync(Roles.Dispatcher);
        _viewer = _factory.CreateClient();
        await _viewer.SignInAsync(Roles.Viewer);
        _driver = _factory.CreateClient();
        await _driver.SignInAsync(Roles.Driver);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ---- fixtures -------------------------------------------------------------------------------

    private long _warehouseId;

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

    private async Task<long> SeedVehicleAsync(double capacityKg, string tag)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var v = Vehicle.Create($"V-{tag}-{Guid.NewGuid():N}"[..12], "Van", capacityKg, "Available", DateTime.UtcNow);
        db.Vehicles.Add(v);
        await db.SaveChangesAsync();
        return v.Id;
    }

    /// <summary>Seeds a Pending shipment directly (the assign API needs no warehouse round trip).</summary>
    private async Task<long> SeedPendingShipmentAsync(double weightKg, string tag)
    {
        await EnsureWarehouseAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var code = $"SHP-{tag}-{Guid.NewGuid():N}"[..20].ToUpperInvariant();
        var s = Shipment.Create(code, _warehouseId, "1 Dest Rd", null, null, weightKg,
            nameof(ShipmentStatus.Pending), "Standard", DateTime.UtcNow.AddHours(48), DateTime.UtcNow);
        db.Shipments.Add(s);
        await db.SaveChangesAsync();
        return s.Id;
    }

    private async Task<long> SeedPlannedRouteAsync(long? vehicleId, string tag)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var start = DateTime.UtcNow.AddDays(7);
        var r = Route.Create($"Route {tag} {Guid.NewGuid():N}"[..24], start, start.AddHours(8), vehicleId, null, DateTime.UtcNow);
        db.Routes.Add(r);
        await db.SaveChangesAsync();
        return r.Id;
    }

    private async Task<Shipment> ReloadShipmentAsync(long id)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        return await db.Shipments.AsNoTracking().SingleAsync(s => s.Id == id);
    }

    private async Task<List<ShipmentStatusHistory>> HistoryAsync(long shipmentId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        return await db.ShipmentStatusHistory.AsNoTracking()
            .Where(h => h.ShipmentId == shipmentId).OrderBy(h => h.Id).ToListAsync();
    }

    // ---- AC-1: happy path ---------------------------------------------------------------------

    [Fact]
    public async Task AC1_Assign_sets_routeId_transitions_to_Assigned_and_writes_one_history_row()
    {
        // LOGI-0010 AC-1
        var vehicleId = await SeedVehicleAsync(1000, "AC1");
        var routeId = await SeedPlannedRouteAsync(vehicleId, "AC1");
        var shipmentId = await SeedPendingShipmentAsync(300, "AC1");

        var before = await ReloadShipmentAsync(shipmentId);

        var res = await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments",
            new { shipmentId }, Json);
        res.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("routeId").GetInt64().Should().Be(routeId);
        body.GetProperty("status").GetString().Should().Be("Assigned");
        // Nothing else about the shipment changed — the read model is the LOGI-0007 one.
        body.GetProperty("weightKg").GetDouble().Should().Be(300);
        body.GetProperty("referenceCode").GetString().Should().Be(before.ReferenceCode);

        var after = await ReloadShipmentAsync(shipmentId);
        after.RouteId.Should().Be(routeId);
        after.Status.Should().Be("Assigned");

        // Exactly one audit row, Pending -> Assigned (BO-4).
        var history = await HistoryAsync(shipmentId);
        history.Should().ContainSingle();
        history[0].FromStatus.Should().Be("Pending");
        history[0].ToStatus.Should().Be("Assigned");
        history[0].Note.Should().BeNull();

        // The route row itself is untouched.
        var list = await _dispatcher.GetAsync($"/api/v1/routes/{routeId}/shipments");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var page = await list.Content.ReadFromJsonAsync<JsonElement>(Json);
        page.GetProperty("items").GetArrayLength().Should().Be(1);
        page.GetProperty("capacity").GetProperty("shipmentCount").GetInt32().Should().Be(1);
    }

    // ---- AC-2: BR-5 capacity guard -------------------------------------------------------------

    [Fact]
    public async Task AC2_Capacity_exceeded_is_409_with_the_three_numbers_and_writes_nothing()
    {
        // LOGI-0010 AC-2
        var vehicleId = await SeedVehicleAsync(1000, "AC2");
        var routeId = await SeedPlannedRouteAsync(vehicleId, "AC2");
        var s1 = await SeedPendingShipmentAsync(400, "AC2A");
        var s2 = await SeedPendingShipmentAsync(500, "AC2B");
        var s3 = await SeedPendingShipmentAsync(200, "AC2C");

        (await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId = s1 }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId = s2 }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var res = await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId = s3 }, Json);
        res.StatusCode.Should().Be(HttpStatusCode.Conflict);

        // The UI needs the numbers to render the capacity bar, so the detail carries them.
        var problem = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        var detail = problem.GetProperty("detail").GetString()!;
        detail.Should().Contain("900").And.Contain("200").And.Contain("1000");
        // The detail must BE the guard's sentence, not a unique-key message that merely embeds it.
        // ConflictException has a two-argument (resource, key) overload that formats "X with key
        // 'Y' already exists."; picking it here would still contain all three numbers and let the
        // defect through, so the shape is asserted rather than the substrings alone.
        detail.Should().StartWith("Vehicle capacity exceeded on route");

        // S3 is byte-identical afterwards: no route, no status change, no history row.
        var untouched = await ReloadShipmentAsync(s3);
        untouched.RouteId.Should().BeNull();
        untouched.Status.Should().Be("Pending");
        (await HistoryAsync(s3)).Should().BeEmpty();
    }

    [Fact]
    public async Task AC2_Route_without_a_vehicle_skips_the_capacity_check()
    {
        // LOGI-0010 AC-2 (second half): BR-5 is conditioned on a vehicle's capacity, so a
        // vehicle-less route has nothing to exceed (plan §5.1).
        var routeId = await SeedPlannedRouteAsync(null, "AC2NV");
        var shipmentId = await SeedPendingShipmentAsync(999_999, "AC2NV");

        var res = await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments",
            new { shipmentId }, Json);
        res.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReloadShipmentAsync(shipmentId)).RouteId.Should().Be(routeId);
    }

    // ---- AC-3: route must exist and be Planned -------------------------------------------------

    [Fact]
    public async Task AC3_Unknown_route_is_404_and_non_Planned_route_is_409()
    {
        // LOGI-0010 AC-3
        var shipmentId = await SeedPendingShipmentAsync(10, "AC3");

        (await _dispatcher.PostAsJsonAsync("/api/v1/routes/999999/shipments", new { shipmentId }, Json))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        // A route that has departed is a state conflict, and the detail names the required status.
        long inProgressRouteId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
            var start = DateTime.UtcNow.AddDays(9);
            var r = Route.Create("InProgress route", start, start.AddHours(4), null, null, DateTime.UtcNow);
            typeof(Route).GetProperty("Status")!.SetValue(r, RouteStatusValues.InProgress);
            db.Routes.Add(r);
            await db.SaveChangesAsync();
            inProgressRouteId = r.Id;
        }

        var res = await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{inProgressRouteId}/shipments",
            new { shipmentId }, Json);
        res.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await res.Content.ReadFromJsonAsync<JsonElement>(Json))
            .GetProperty("detail").GetString().Should().Contain("Planned");

        (await ReloadShipmentAsync(shipmentId)).Status.Should().Be("Pending");
    }

    // ---- AC-4: shipment guards -----------------------------------------------------------------

    [Fact]
    public async Task AC4_Unknown_shipment_404_other_route_409_same_route_is_idempotent_200()
    {
        // LOGI-0010 AC-4
        var vehicleId = await SeedVehicleAsync(5000, "AC4");
        var routeA = await SeedPlannedRouteAsync(vehicleId, "AC4A");
        var routeB = await SeedPlannedRouteAsync(vehicleId, "AC4B");
        var shipmentId = await SeedPendingShipmentAsync(100, "AC4");

        // Unknown shipment -> 404
        (await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeA}/shipments", new { shipmentId = 999999 }, Json))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        // Assign to A, then try to move it to B: refused, it still belongs to A.
        (await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeA}/shipments", new { shipmentId }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var move = await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeB}/shipments", new { shipmentId }, Json);
        move.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await ReloadShipmentAsync(shipmentId)).RouteId.Should().Be(routeA);

        // Same route again: idempotent 200, still exactly one history row, capacity not double-counted.
        var again = await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeA}/shipments", new { shipmentId }, Json);
        again.StatusCode.Should().Be(HttpStatusCode.OK);
        (await HistoryAsync(shipmentId)).Should().ContainSingle();

        var page = await (await _dispatcher.GetAsync($"/api/v1/routes/{routeA}/shipments"))
            .Content.ReadFromJsonAsync<JsonElement>(Json);
        page.GetProperty("capacity").GetProperty("assignedWeightKg").GetDouble().Should().Be(100);
    }

    [Fact]
    public async Task AC4_Shipment_not_Pending_is_409_naming_the_required_status()
    {
        // LOGI-0010 AC-4
        var routeId = await SeedPlannedRouteAsync(null, "AC4NP");
        var shipmentId = await SeedPendingShipmentAsync(10, "AC4NP");
        (await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        // Move it on the lifecycle so it is no longer Pending, then try to re-assign it elsewhere.
        (await _dispatcher.PostAsJsonAsync($"/api/v1/shipments/{shipmentId}/status-transitions",
            new { toStatus = "InTransit" }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var otherRoute = await SeedPlannedRouteAsync(null, "AC4NP2");
        var res = await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{otherRoute}/shipments",
            new { shipmentId }, Json);
        res.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await res.Content.ReadFromJsonAsync<JsonElement>(Json))
            .GetProperty("detail").GetString().Should().Contain("Pending");
    }

    // ---- AC-5: validation ----------------------------------------------------------------------

    [Fact]
    public async Task AC5_Invalid_bodies_are_400_keyed_to_shipmentId()
    {
        // LOGI-0010 AC-5
        var routeId = await SeedPlannedRouteAsync(null, "AC5");

        foreach (var body in new object[] { new { }, new { shipmentId = (long?)null }, new { shipmentId = 0L }, new { shipmentId = -5L } })
        {
            var res = await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", body, Json);
            res.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var problem = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
            problem.GetProperty("errors").TryGetProperty("shipmentId", out _).Should().BeTrue();
        }

        // A non-numeric route segment never matches the {id:long} route constraint, so ASP.NET
        // answers 404 (no endpoint) rather than 400. The body-keyed 400s above are the ones the
        // contract's ValidationProblem shape describes.
    }

    // ---- AC-6: unassign -----------------------------------------------------------------------

    [Fact]
    public async Task AC6_Unassign_frees_capacity_returns_the_shipment_to_Pending_and_logs_it()
    {
        // LOGI-0010 AC-6
        var vehicleId = await SeedVehicleAsync(1000, "AC6");
        var routeId = await SeedPlannedRouteAsync(vehicleId, "AC6");
        var s1 = await SeedPendingShipmentAsync(900, "AC6A");
        var s2 = await SeedPendingShipmentAsync(300, "AC6B");

        (await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId = s1 }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        // 900 of 1000 used — the 300kg one does not fit.
        (await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId = s2 }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);

        var del = await _dispatcher.DeleteAsync($"/api/v1/routes/{routeId}/shipments/{s1}");
        del.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var freed = await ReloadShipmentAsync(s1);
        freed.RouteId.Should().BeNull();
        freed.Status.Should().Be("Pending");

        // One Assigned -> Pending row, and NOT via TransitionTo (BR-7 has no such edge).
        var history = await HistoryAsync(s1);
        history.Should().HaveCount(2);
        history[1].FromStatus.Should().Be("Assigned");
        history[1].ToStatus.Should().Be("Pending");

        // The freed weight is genuinely reusable — the same assign now succeeds.
        (await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId = s2 }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AC6_Unassign_404s_and_409s()
    {
        // LOGI-0010 AC-6 (error shapes)
        var routeId = await SeedPlannedRouteAsync(null, "AC6E");
        var otherRouteId = await SeedPlannedRouteAsync(null, "AC6E2");
        var onRoute = await SeedPendingShipmentAsync(10, "AC6E");
        var unassigned = await SeedPendingShipmentAsync(10, "AC6EU");

        (await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId = onRoute }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        // Not on this route at all.
        (await _dispatcher.DeleteAsync($"/api/v1/routes/{routeId}/shipments/{unassigned}"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        // Unknown shipment.
        (await _dispatcher.DeleteAsync($"/api/v1/routes/{routeId}/shipments/999999"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        // Unknown route.
        (await _dispatcher.DeleteAsync($"/api/v1/routes/999999/shipments/{onRoute}"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        // On a different route.
        (await _dispatcher.DeleteAsync($"/api/v1/routes/{otherRouteId}/shipments/{onRoute}"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        // It has left Assigned by another path -> state conflict, not a silent no-op.
        (await _dispatcher.PostAsJsonAsync($"/api/v1/shipments/{onRoute}/status-transitions",
            new { toStatus = "InTransit" }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await _dispatcher.DeleteAsync($"/api/v1/routes/{routeId}/shipments/{onRoute}"))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    // ---- AC-7: authorization -------------------------------------------------------------------

    [Fact]
    public async Task AC7_Viewer_and_Driver_cannot_write_Viewer_can_read_anonymous_is_401()
    {
        // LOGI-0010 AC-7
        var routeId = await SeedPlannedRouteAsync(null, "AC7");
        var shipmentId = await SeedPendingShipmentAsync(10, "AC7");

        var anon = _factory.CreateClient();
        (await anon.GetAsync($"/api/v1/routes/{routeId}/shipments")).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized);
        (await anon.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await anon.DeleteAsync($"/api/v1/routes/{routeId}/shipments/{shipmentId}"))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        (await _viewer.GetAsync($"/api/v1/routes/{routeId}/shipments")).StatusCode
            .Should().Be(HttpStatusCode.OK);
        (await _viewer.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await _viewer.DeleteAsync($"/api/v1/routes/{routeId}/shipments/{shipmentId}"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        (await _driver.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await _driver.DeleteAsync($"/api/v1/routes/{routeId}/shipments/{shipmentId}"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        (await ReloadShipmentAsync(shipmentId)).Status.Should().Be("Pending");
    }

    // ---- AC-9: concurrency ---------------------------------------------------------------------

    [Fact]
    public async Task AC9_Concurrent_boundary_assigns_leave_exactly_one_winner()
    {
        // LOGI-0010 AC-9: two 1000kg shipments race for 1000kg of capacity. Because the running
        // total is re-read inside the write transaction, exactly one wins and the route never
        // carries more than the vehicle can hold.
        var vehicleId = await SeedVehicleAsync(1000, "AC9");
        var routeId = await SeedPlannedRouteAsync(vehicleId, "AC9");
        var a = await SeedPendingShipmentAsync(1000, "AC9A");
        var b = await SeedPendingShipmentAsync(1000, "AC9B");

        var results = await Task.WhenAll(
            Task.Run(() => _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId = a }, Json)),
            Task.Run(() => _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments", new { shipmentId = b }, Json)));

        var codes = results.Select(r => r.StatusCode).OrderBy(c => c).ToList();
        codes.Should().ContainSingle(c => c == HttpStatusCode.OK);
        codes.Should().ContainSingle(c => c == HttpStatusCode.Conflict);

        var winner = (await ReloadShipmentAsync(a)).RouteId == routeId ? a : b;
        var loser = winner == a ? b : a;
        (await ReloadShipmentAsync(winner)).RouteId.Should().Be(routeId);
        (await ReloadShipmentAsync(loser)).RouteId.Should().BeNull();

        var page = await (await _dispatcher.GetAsync($"/api/v1/routes/{routeId}/shipments"))
            .Content.ReadFromJsonAsync<JsonElement>(Json);
        page.GetProperty("capacity").GetProperty("assignedWeightKg").GetDouble().Should().Be(1000);
        page.GetProperty("capacity").GetProperty("shipmentCount").GetInt32().Should().Be(1);
    }
}
