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

public class RouteQueryTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _adminClient = null!;
    private HttpClient _driverClient = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private long _driverId;
    private long _route1Id;
    private long _route2Id;

    public RouteQueryTests(LogiFlowTestFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _adminClient = _factory.CreateClient();
        await _adminClient.SignInAsync(Roles.Admin);

        _driverClient = _factory.CreateClient();
        await _driverClient.SignInAsync(Roles.Driver);

        using var scope = _factory.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();

        var rajUser = await userManager.FindByEmailAsync("raj@logiflow.dev");
        rajUser.Should().NotBeNull();

        var d1 = await db.Drivers.FirstOrDefaultAsync(d => d.UserId == rajUser!.Id);
        if (d1 is null)
        {
            d1 = Driver.Create("Raj Driver", $"LIC-{Guid.NewGuid():N}"[..12], null, "Active", rajUser!.Id);
            db.Drivers.Add(d1);
        }

        var d2 = Driver.Create("Other Driver", $"LIC-{Guid.NewGuid():N}"[..12], null, "Active", null);
        var v1 = Vehicle.Create($"V-{Guid.NewGuid():N}"[..12], "Van", 1000, "Available", DateTime.UtcNow);
        db.Drivers.Add(d2);
        db.Vehicles.Add(v1);
        await db.SaveChangesAsync();

        _driverId = d1.Id;

        var r1 = Route.Create("Alpha Route", DateTime.UtcNow.AddDays(10), DateTime.UtcNow.AddDays(11), v1.Id, d1.Id, DateTime.UtcNow);
        var r2 = Route.Create("Beta Route", DateTime.UtcNow.AddDays(12), DateTime.UtcNow.AddDays(13), v1.Id, d2.Id, DateTime.UtcNow);
        db.Routes.AddRange(r1, r2);
        await db.SaveChangesAsync();

        _route1Id = r1.Id;
        _route2Id = r2.Id;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task AC7_Driver_scoping_and_cross_driver_forbidden()
    {
        // LOGI-0009 AC-7: driver lists only own routes; GET cross-driver route -> 403
        var listRes = await _driverClient.GetAsync("/api/v1/routes");
        listRes.StatusCode.Should().Be(HttpStatusCode.OK);
        var listDoc = await listRes.Content.ReadFromJsonAsync<JsonElement>(Json);
        var items = listDoc.GetProperty("items").EnumerateArray().ToList();
        items.Should().ContainSingle(i => i.GetProperty("id").GetInt64() == _route1Id);
        items.Any(i => i.GetProperty("id").GetInt64() == _route2Id).Should().BeFalse();

        // Detail own route -> 200
        var getOwn = await _driverClient.GetAsync($"/api/v1/routes/{_route1Id}");
        getOwn.StatusCode.Should().Be(HttpStatusCode.OK);

        // Detail other driver route -> 403
        var getOther = await _driverClient.GetAsync($"/api/v1/routes/{_route2Id}");
        getOther.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AC9_List_filters_and_validation()
    {
        // LOGI-0009 AC-9: search q, status, vehicleId, driverId, pagination envelope
        var res = await _adminClient.GetAsync($"/api/v1/routes?q=Alpha&driverId={_driverId}&status=Planned");
        res.StatusCode.Should().Be(HttpStatusCode.OK);
        var doc = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        var items = doc.GetProperty("items").EnumerateArray().ToList();
        items.Should().ContainSingle(i => i.GetProperty("id").GetInt64() == _route1Id);

        // Unknown status enum -> 400
        var badStatus = await _adminClient.GetAsync("/api/v1/routes?status=InvalidStatus");
        badStatus.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
