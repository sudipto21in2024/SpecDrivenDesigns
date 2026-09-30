using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// The read half of LOGI-0010 (M2): the paged envelope, the BR-5 capacity projection and the
/// BR-6 Driver scoping on the list read. The write half is in
/// <see cref="RouteShipmentAssignTests"/>.
/// </summary>
public class RouteShipmentListTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _dispatcher = null!;
    private HttpClient _driver = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public RouteShipmentListTests(LogiFlowTestFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _dispatcher = _factory.CreateClient();
        await _dispatcher.SignInAsync(Roles.Dispatcher);
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

    private async Task<long> SeedPendingShipmentAsync(double weightKg, string tag, double slaDueInHours = 48)
    {
        await EnsureWarehouseAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var code = $"SHP-{tag}-{Guid.NewGuid():N}"[..20].ToUpperInvariant();
        var s = Shipment.Create(code, _warehouseId, "1 Dest Rd", null, null, weightKg,
            nameof(ShipmentStatus.Pending), "Standard", DateTime.UtcNow.AddHours(slaDueInHours), DateTime.UtcNow);
        db.Shipments.Add(s);
        await db.SaveChangesAsync();
        return s.Id;
    }

    private async Task<long> SeedPlannedRouteAsync(long? vehicleId, long? driverId, string tag)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var start = DateTime.UtcNow.AddDays(7);
        var r = Route.Create($"Route {tag} {Guid.NewGuid():N}"[..24], start, start.AddHours(8), vehicleId, driverId, DateTime.UtcNow);
        db.Routes.Add(r);
        await db.SaveChangesAsync();
        return r.Id;
    }

    /// <summary>The Driver client's own driver row (the seeded raj@logiflow.dev user), created on demand.</summary>
    private async Task<long> SeedOwnDriverAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var user = await userManager.FindByEmailAsync("raj@logiflow.dev");
        user.Should().NotBeNull();

        var driver = await db.Drivers.FirstOrDefaultAsync(d => d.UserId == user!.Id);
        if (driver is null)
        {
            driver = Driver.Create("Raj Driver", $"LIC-{Guid.NewGuid():N}"[..12], null, "Active", user!.Id);
            db.Drivers.Add(driver);
            await db.SaveChangesAsync();
        }
        return driver.Id;
    }

    private async Task<long> SeedOtherDriverAsync(string tag)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var d = Driver.Create($"Driver {tag}", $"LIC-{tag}-{Guid.NewGuid():N}"[..12], null, "Active", null);
        db.Drivers.Add(d);
        await db.SaveChangesAsync();
        return d.Id;
    }

    private async Task AssignAsync(long routeId, long shipmentId)
    {
        var res = await _dispatcher.PostAsJsonAsync($"/api/v1/routes/{routeId}/shipments",
            new { shipmentId }, Json);
        res.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private async Task<JsonElement> GetPageAsync(HttpClient client, long routeId, string query = "")
    {
        var res = await client.GetAsync($"/api/v1/routes/{routeId}/shipments{query}");
        res.StatusCode.Should().Be(HttpStatusCode.OK);
        return await res.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    // ---- AC-8: envelope + capacity projection --------------------------------------------------

    [Fact]
    public async Task AC8_Page_carries_the_standard_envelope_and_the_capacity_projection()
    {
        // LOGI-0010 AC-8
        var vehicleId = await SeedVehicleAsync(1000, "AC8");
        var routeId = await SeedPlannedRouteAsync(vehicleId, null, "AC8");

        // 300 + 300 + 300 = 900 of 1000kg.
        foreach (var w in new[] { 300d, 300d, 300d })
            await AssignAsync(routeId, await SeedPendingShipmentAsync(w, "AC8"));

        var page = await GetPageAsync(_dispatcher, routeId, "?page=1&pageSize=20");

        page.GetProperty("page").GetInt32().Should().Be(1);
        page.GetProperty("pageSize").GetInt32().Should().Be(20);
        page.GetProperty("totalCount").GetInt32().Should().Be(3);
        page.GetProperty("totalPages").GetInt32().Should().Be(1);
        page.GetProperty("items").GetArrayLength().Should().Be(3);

        var capacity = page.GetProperty("capacity");
        capacity.GetProperty("vehicleId").GetInt64().Should().Be(vehicleId);
        capacity.GetProperty("capacityKg").GetDouble().Should().Be(1000);
        capacity.GetProperty("assignedWeightKg").GetDouble().Should().Be(900);
        capacity.GetProperty("remainingCapacityKg").GetDouble().Should().Be(100);
        capacity.GetProperty("shipmentCount").GetInt32().Should().Be(3);
    }

    [Fact]
    public async Task AC8_Vehicleless_route_reports_null_capacity_not_zero()
    {
        // LOGI-0010 AC-8: "unknown capacity" is not "zero capacity" — a 0 here would render a full
        // truck in the UI when nothing is known about the vehicle.
        var routeId = await SeedPlannedRouteAsync(null, null, "AC8NV");
        await AssignAsync(routeId, await SeedPendingShipmentAsync(120, "AC8NV"));

        var capacity = (await GetPageAsync(_dispatcher, routeId)).GetProperty("capacity");
        capacity.GetProperty("capacityKg").ValueKind.Should().Be(JsonValueKind.Null);
        capacity.GetProperty("remainingCapacityKg").ValueKind.Should().Be(JsonValueKind.Null);
        capacity.GetProperty("vehicleId").ValueKind.Should().Be(JsonValueKind.Null);
        // The two always-known numbers are still reported.
        capacity.GetProperty("assignedWeightKg").GetDouble().Should().Be(120);
        capacity.GetProperty("shipmentCount").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task AC8_Paging_slices_rows_while_the_capacity_view_stays_route_wide()
    {
        // LOGI-0010 AC-8: the load bar must describe the whole route, never the current slice.
        var vehicleId = await SeedVehicleAsync(1000, "AC8P");
        var routeId = await SeedPlannedRouteAsync(vehicleId, null, "AC8P");
        foreach (var w in new[] { 100d, 200d, 300d })
            await AssignAsync(routeId, await SeedPendingShipmentAsync(w, "AC8P"));

        var first = await GetPageAsync(_dispatcher, routeId, "?page=1&pageSize=2");
        first.GetProperty("items").GetArrayLength().Should().Be(2);
        first.GetProperty("totalCount").GetInt32().Should().Be(3);
        first.GetProperty("totalPages").GetInt32().Should().Be(2);
        first.GetProperty("capacity").GetProperty("shipmentCount").GetInt32().Should().Be(3);
        first.GetProperty("capacity").GetProperty("assignedWeightKg").GetDouble().Should().Be(600);

        var second = await GetPageAsync(_dispatcher, routeId, "?page=2&pageSize=2");
        second.GetProperty("items").GetArrayLength().Should().Be(1);
        second.GetProperty("capacity").GetProperty("shipmentCount").GetInt32().Should().Be(3);

        // A page past the end is an empty slice, not an error.
        var beyond = await GetPageAsync(_dispatcher, routeId, "?page=9&pageSize=2");
        beyond.GetProperty("items").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task AC8_Invalid_paging_is_400_and_unknown_route_is_404()
    {
        // LOGI-0010 AC-8 (error shapes)
        var routeId = await SeedPlannedRouteAsync(null, null, "AC8E");

        (await _dispatcher.GetAsync($"/api/v1/routes/{routeId}/shipments?page=0")).StatusCode
            .Should().Be(HttpStatusCode.BadRequest);
        (await _dispatcher.GetAsync($"/api/v1/routes/{routeId}/shipments?pageSize=0")).StatusCode
            .Should().Be(HttpStatusCode.BadRequest);
        (await _dispatcher.GetAsync($"/api/v1/routes/{routeId}/shipments?pageSize=101")).StatusCode
            .Should().Be(HttpStatusCode.BadRequest);

        (await _dispatcher.GetAsync("/api/v1/routes/999999/shipments")).StatusCode
            .Should().Be(HttpStatusCode.NotFound);

        // A non-numeric route segment never matches the {id:long} constraint, so no endpoint is
        // selected and ASP.NET answers 404 (no such route) — the same behaviour AC-5's test
        // documents for the POST. Only the body-keyed 400s are ValidationProblem shapes.
        (await _dispatcher.GetAsync("/api/v1/routes/abc/shipments")).StatusCode
            .Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AC8_Viewer_reads_the_list()
    {
        // LOGI-0010 AC-8 via AC-7: Viewer is a read role on this endpoint.
        var viewer = _factory.CreateClient();
        await viewer.SignInAsync(Roles.Viewer);
        var routeId = await SeedPlannedRouteAsync(null, null, "AC8V");
        (await viewer.GetAsync($"/api/v1/routes/{routeId}/shipments")).StatusCode
            .Should().Be(HttpStatusCode.OK);
    }

    // ---- AC-7: BR-6 Driver scoping on the read -------------------------------------------------

    [Fact]
    public async Task AC7_Driver_reads_only_their_own_route()
    {
        // LOGI-0010 AC-7: 200 for the route assigned to this driver, 403 for any other — the list
        // read must carry the same scoping as GET /routes/{id}, not just the writes.
        var ownDriverId = await SeedOwnDriverAsync();
        var otherDriverId = await SeedOtherDriverAsync("AC7O");

        var ownRouteId = await SeedPlannedRouteAsync(null, ownDriverId, "AC7OWN");
        var otherRouteId = await SeedPlannedRouteAsync(null, otherDriverId, "AC7OTH");
        await AssignAsync(ownRouteId, await SeedPendingShipmentAsync(10, "AC7OWN"));

        var own = await _driver.GetAsync($"/api/v1/routes/{ownRouteId}/shipments");
        own.StatusCode.Should().Be(HttpStatusCode.OK);
        var page = await own.Content.ReadFromJsonAsync<JsonElement>(Json);
        page.GetProperty("items").GetArrayLength().Should().Be(1);

        (await _driver.GetAsync($"/api/v1/routes/{otherRouteId}/shipments")).StatusCode
            .Should().Be(HttpStatusCode.Forbidden);
        (await _driver.GetAsync("/api/v1/routes/999999/shipments")).StatusCode
            .Should().Be(HttpStatusCode.NotFound);
    }

    // ---- AC-10: no regression ------------------------------------------------------------------

    [Fact]
    public async Task AC10_List_rows_match_the_LOGI_0007_shipment_read_model()
    {
        // LOGI-0010 AC-10: the list projects through the same ShipmentDto, so a row and the
        // shipment's own GET must be identical — including the read-time atRisk flag (BR-2), which
        // is a projection and never stored.
        var vehicleId = await SeedVehicleAsync(5000, "AC10");
        var routeId = await SeedPlannedRouteAsync(vehicleId, null, "AC10");

        // One comfortably-inside-SLA shipment and one whose SLA is already blown: the two must
        // disagree on atRisk, proving the flag is still computed at read time here.
        var safe = await SeedPendingShipmentAsync(50, "AC10SAFE", slaDueInHours: 48);
        var late = await SeedPendingShipmentAsync(50, "AC10LATE", slaDueInHours: -1);
        await AssignAsync(routeId, safe);
        await AssignAsync(routeId, late);

        var page = await GetPageAsync(_dispatcher, routeId);
        var rows = page.GetProperty("items").EnumerateArray().ToList();

        foreach (var id in new[] { safe, late })
        {
            var direct = await (await _dispatcher.GetAsync($"/api/v1/shipments/{id}"))
                .Content.ReadFromJsonAsync<JsonElement>(Json);
            var row = rows.Single(r => r.GetProperty("id").GetInt64() == id);
            row.GetRawText().Should().Be(direct.GetRawText());
        }

        rows.Single(r => r.GetProperty("id").GetInt64() == safe)
            .GetProperty("atRisk").GetBoolean().Should().BeFalse();
        rows.Single(r => r.GetProperty("id").GetInt64() == late)
            .GetProperty("atRisk").GetBoolean().Should().BeTrue();

        // The list read never mutates anything.
        page.GetProperty("capacity").GetProperty("shipmentCount").GetInt32().Should().Be(2);
    }
}
