using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiFlow.Api.Tests;

public class RouteAssignTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _adminClient = null!;
    private HttpClient _dispatcherClient = null!;
    private HttpClient _viewerClient = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public RouteAssignTests(LogiFlowTestFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _adminClient = _factory.CreateClient();
        await _adminClient.SignInAsync(Roles.Admin);
        _dispatcherClient = _factory.CreateClient();
        await _dispatcherClient.SignInAsync(Roles.Dispatcher);
        _viewerClient = _factory.CreateClient();
        await _viewerClient.SignInAsync(Roles.Viewer);
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
    public async Task AC2_Create_unassigned_and_assign_unassign_via_patch()
    {
        // LOGI-0009 AC-2: create unassigned, then assign, then unassign vehicle
        var (vId, dId) = await SeedVehicleAndDriverAsync("AC2");
        var res = await _dispatcherClient.PostAsJsonAsync("/api/v1/routes", new
        {
            name = "Spare run",
            plannedStart = "2026-10-02T08:00:00Z",
            plannedEnd = "2026-10-02T16:00:00Z"
        }, Json);
        res.StatusCode.Should().Be(HttpStatusCode.Created);
        var route = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        var id = route.GetProperty("id").GetInt64();
        route.GetProperty("vehicleId").ValueKind.Should().Be(JsonValueKind.Null);

        var patch1 = await _dispatcherClient.PatchAsJsonAsync($"/api/v1/routes/{id}", new { vehicleId = vId, driverId = dId }, Json);
        patch1.StatusCode.Should().Be(HttpStatusCode.OK);
        var patched1 = await patch1.Content.ReadFromJsonAsync<JsonElement>(Json);
        patched1.GetProperty("vehicleId").GetInt64().Should().Be(vId);

        var patch2 = await _dispatcherClient.PatchAsJsonAsync($"/api/v1/routes/{id}", new { vehicleId = (long?)null }, Json);
        patch2.StatusCode.Should().Be(HttpStatusCode.OK);
        var patched2 = await patch2.Content.ReadFromJsonAsync<JsonElement>(Json);
        patched2.GetProperty("vehicleId").ValueKind.Should().Be(JsonValueKind.Null);
        patched2.GetProperty("driverId").GetInt64().Should().Be(dId);
    }

    [Fact]
    public async Task AC5_Double_booking_guard_BR3_BR4()
    {
        // LOGI-0009 AC-5: overlap returns 409
        var (vId, dId) = await SeedVehicleAndDriverAsync("AC5");
        var r1 = await _dispatcherClient.PostAsJsonAsync("/api/v1/routes", new
        {
            name = "Route A",
            plannedStart = "2026-10-05T08:00:00Z",
            plannedEnd = "2026-10-05T16:00:00Z",
            vehicleId = vId,
            driverId = dId
        }, Json);
        r1.StatusCode.Should().Be(HttpStatusCode.Created);

        var overlapRes = await _dispatcherClient.PostAsJsonAsync("/api/v1/routes", new
        {
            name = "Route Conflict",
            plannedStart = "2026-10-05T12:00:00Z",
            plannedEnd = "2026-10-05T20:00:00Z",
            vehicleId = vId
        }, Json);
        overlapRes.StatusCode.Should().Be(HttpStatusCode.Conflict);

        var touchingRes = await _dispatcherClient.PostAsJsonAsync("/api/v1/routes", new
        {
            name = "Route Touching OK",
            plannedStart = "2026-10-05T16:00:00Z",
            plannedEnd = "2026-10-05T20:00:00Z",
            vehicleId = vId
        }, Json);
        touchingRes.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task AC6_AC7_AC8_Assignment_planned_only_RBAC_and_delete_blockers()
    {
        // LOGI-0009 AC-6: non-planned route PATCH -> 409
        var (vId, dId) = await SeedVehicleAndDriverAsync("AC6");
        long routeId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
            var r = Route.Create("NonPlanned", DateTime.UtcNow.AddDays(1), DateTime.UtcNow.AddDays(2), vId, dId, DateTime.UtcNow);
            typeof(Route).GetProperty("Status")!.SetValue(r, RouteStatusValues.InProgress);
            db.Routes.Add(r);
            await db.SaveChangesAsync();
            routeId = r.Id;
        }

        var patchRes = await _dispatcherClient.PatchAsJsonAsync($"/api/v1/routes/{routeId}", new { name = "Renamed" }, Json);
        patchRes.StatusCode.Should().Be(HttpStatusCode.Conflict);

        // LOGI-0009 AC-7: Viewer 403 on write; Anon 401
        var anon = _factory.CreateClient();
        (await anon.GetAsync("/api/v1/routes")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await _viewerClient.PostAsJsonAsync("/api/v1/routes", new { name = "X", plannedStart = "2026-10-01T08:00:00Z", plannedEnd = "2026-10-01T16:00:00Z" }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // LOGI-0009 AC-8: Vehicle and Driver delete blocked with 409 when referenced
        (await _adminClient.DeleteAsync($"/api/v1/vehicles/{vId}")).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await _adminClient.DeleteAsync($"/api/v1/drivers/{dId}")).StatusCode.Should().Be(HttpStatusCode.Conflict);
    }
}
