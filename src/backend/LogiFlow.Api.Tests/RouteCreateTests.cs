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

public class RouteCreateTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _adminClient = null!;
    private HttpClient _dispatcherClient = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public RouteCreateTests(LogiFlowTestFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _adminClient = _factory.CreateClient();
        await _adminClient.SignInAsync(Roles.Admin);
        _dispatcherClient = _factory.CreateClient();
        await _dispatcherClient.SignInAsync(Roles.Dispatcher);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(long VehicleId, long DriverId)> SeedVehicleAndDriverAsync(string tag)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var v = Vehicle.Create($"V-{tag}-{Guid.NewGuid():N}"[..12], "Van", 1000, "Available", DateTime.UtcNow);
        var d = Driver.Create($"Driver {tag}", $"LIC-{tag}-{Guid.NewGuid():N}"[..12], null, "Active", null);
        db.Vehicles.Add(v);
        db.Drivers.Add(d);
        await db.SaveChangesAsync();
        return (v.Id, d.Id);
    }

    [Fact]
    public async Task AC1_Create_happy_path_assigned_and_shipment_unchanged()
    {
        // LOGI-0009 AC-1: POST /api/v1/routes with assigned vehicle/driver creates Planned route
        var (vId, dId) = await SeedVehicleAndDriverAsync("AC1");

        long shipmentId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
            var w = Warehouse.Create("W-AC1", "Addr", 10, 20, DateTime.UtcNow);
            db.Warehouses.Add(w);
            await db.SaveChangesAsync();
            var s = Shipment.Create("REF-AC1-" + Guid.NewGuid().ToString("N")[..8], w.Id, "Dest", null, null, 10, "Created", "Standard", null, DateTime.UtcNow);
            db.Shipments.Add(s);
            await db.SaveChangesAsync();
            shipmentId = s.Id;
        }

        var start = DateTime.UtcNow.AddDays(1);
        var end = start.AddHours(4);
        var payload = new
        {
            name = "North loop",
            plannedStart = start.ToString("O"),
            plannedEnd = end.ToString("O"),
            vehicleId = vId,
            driverId = dId
        };

        var postRes = await _dispatcherClient.PostAsJsonAsync("/api/v1/routes", payload, Json);
        postRes.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await postRes.Content.ReadFromJsonAsync<JsonElement>(Json);
        var routeId = created.GetProperty("id").GetInt64();
        created.GetProperty("status").GetString().Should().Be("Planned");
        created.GetProperty("vehicleId").GetInt64().Should().Be(vId);
        created.GetProperty("driverId").GetInt64().Should().Be(dId);

        var getRes = await _adminClient.GetAsync($"/api/v1/routes/{routeId}");
        getRes.StatusCode.Should().Be(HttpStatusCode.OK);
        var fetched = await getRes.Content.ReadFromJsonAsync<JsonElement>(Json);
        fetched.GetProperty("name").GetString().Should().Be("North loop");

        var listRes = await _adminClient.GetAsync($"/api/v1/routes?q=North");
        listRes.StatusCode.Should().Be(HttpStatusCode.OK);
        var listDoc = await listRes.Content.ReadFromJsonAsync<JsonElement>(Json);
        listDoc.GetProperty("items").EnumerateArray().Any(i => i.GetProperty("id").GetInt64() == routeId).Should().BeTrue();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
            var s = await db.Shipments.SingleAsync(x => x.Id == shipmentId);
            s.RouteId.Should().BeNull();
        }
    }

    [Fact]
    public async Task AC3_Create_validation_field_keyed_400()
    {
        // LOGI-0009 AC-3: name blank, plannedEnd <= plannedStart
        var blankName = await _adminClient.PostAsJsonAsync("/api/v1/routes", new
        {
            name = "   ",
            plannedStart = "2026-10-01T08:00:00Z",
            plannedEnd = "2026-10-01T16:00:00Z"
        }, Json);
        blankName.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var badTime = await _adminClient.PostAsJsonAsync("/api/v1/routes", new
        {
            name = "Bad time",
            plannedStart = "2026-10-01T16:00:00Z",
            plannedEnd = "2026-10-01T08:00:00Z"
        }, Json);
        badTime.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AC4_AC10_Create_unknown_FKs_404_and_server_owned_fields_400()
    {
        // LOGI-0009 AC-4: unknown vehicleId or driverId returns 404
        var res404 = await _adminClient.PostAsJsonAsync("/api/v1/routes", new
        {
            name = "Missing FK",
            plannedStart = "2026-10-01T08:00:00Z",
            plannedEnd = "2026-10-01T16:00:00Z",
            vehicleId = 999999
        }, Json);
        res404.StatusCode.Should().Be(HttpStatusCode.NotFound);

        // LOGI-0009 AC-10: server-owned keys rejected with 400
        var res400 = await _adminClient.PostAsJsonAsync("/api/v1/routes", new
        {
            name = "Hacked route",
            plannedStart = "2026-10-01T08:00:00Z",
            plannedEnd = "2026-10-01T16:00:00Z",
            status = "Completed"
        }, Json);
        res400.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
