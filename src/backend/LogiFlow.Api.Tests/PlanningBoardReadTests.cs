using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0011 backend, AC-4 and AC-5: BR-5 capacity parity with the assignment surface, and the
/// unassigned backlog lane. Validation/determinism live in
/// <see cref="PlanningBoardContractTests"/>.
/// </summary>
public class PlanningBoardReadTests : IClassFixture<LogiFlowTestFactory>
{
    private readonly PlanningBoardFixture _f;
    public PlanningBoardReadTests(LogiFlowTestFactory factory) => _f = new PlanningBoardFixture(factory);

    // ---- AC-4: capacity parity ---------------------------------------------------------------------

    [Fact]
    public async Task AC4_Route_card_capacity_matches_the_route_shipments_endpoint()
    {
        // LOGI-0011 AC-4 (O4: one BR-5 implementation)
        var vehicleId = await _f.SeedVehicleAsync(1000, "AC4");
        var routeId = await _f.SeedPlannedRouteAsync(vehicleId, "AC4");
        foreach (var w in new[] { 300d, 400d })
            await _f.SeedShipmentAsync(nameof(ShipmentStatus.Assigned), w, routeId: routeId);

        var board = await _f.GetBoardAsync(query: $"?routeId={routeId}");
        var capacity = board.GetProperty("routes").EnumerateArray()
            .Single(r => r.GetProperty("id").GetInt64() == routeId)
            .GetProperty("capacity");

        capacity.GetProperty("vehicleId").GetInt64().Should().Be(vehicleId);
        capacity.GetProperty("capacityKg").GetDouble().Should().Be(1000);
        capacity.GetProperty("assignedWeightKg").GetDouble().Should().Be(700);
        capacity.GetProperty("remainingCapacityKg").GetDouble().Should().Be(300);
        capacity.GetProperty("shipmentCount").GetInt32().Should().Be(2);

        // Parity with the surface that enforces BR-5 — the whole point of O4.
        var page = await (await _f.DispatcherAsync())
            .GetFromJsonAsync<JsonElement>($"/api/v1/routes/{routeId}/shipments", PlanningBoardFixture.Json);
        var theirs = page.GetProperty("capacity");
        capacity.GetProperty("assignedWeightKg").GetDouble()
            .Should().Be(theirs.GetProperty("assignedWeightKg").GetDouble());
        capacity.GetProperty("shipmentCount").GetInt32()
            .Should().Be(theirs.GetProperty("shipmentCount").GetInt32());
    }

    [Fact]
    public async Task AC4_Route_without_vehicle_reports_null_capacity_not_zero()
    {
        // LOGI-0011 AC-4 / plan §5.2: "no vehicle" is not "full".
        var routeId = await _f.SeedPlannedRouteAsync(null, "AC4NV");

        var capacity = (await _f.GetBoardAsync(query: $"?routeId={routeId}"))
            .GetProperty("routes").EnumerateArray()
            .Single(r => r.GetProperty("id").GetInt64() == routeId)
            .GetProperty("capacity");

        capacity.GetProperty("capacityKg").ValueKind.Should().Be(JsonValueKind.Null);
        capacity.GetProperty("remainingCapacityKg").ValueKind.Should().Be(JsonValueKind.Null);
        capacity.GetProperty("assignedWeightKg").GetDouble().Should().Be(0);
    }

    // ---- AC-5: unassigned lane ---------------------------------------------------------------------

    [Fact]
    public async Task AC5_Unassigned_backlog_is_counted_and_the_route_filter_does_not_widen()
    {
        // LOGI-0011 AC-5
        var routeId = await _f.SeedPlannedRouteAsync(await _f.SeedVehicleAsync(9000, "AC5"), "AC5");
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Assigned), routeId: routeId);
        var unassigned = await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending));

        (await _f.GetBoardAsync()).GetProperty("unassignedTotalCount").GetInt32()
            .Should().BeGreaterThan(0);

        // Filtering by route narrows to that route and must NOT drag the null-route backlog along.
        var scoped = await _f.GetBoardAsync(query: $"?routeId={routeId}");
        var ids = PlanningBoardFixture.AllCards(scoped).Select(c => c.GetProperty("id").GetInt64()).ToList();
        ids.Should().NotContain(unassigned);
        ids.Should().NotBeEmpty();
    }
}

