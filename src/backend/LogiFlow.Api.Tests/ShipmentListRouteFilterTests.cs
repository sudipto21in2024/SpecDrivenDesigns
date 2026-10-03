using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0012 backend follow-up, AC-6: the <c>routeId</c> filter on <c>GET /shipments</c>.
///
/// The architect follow-up added <c>routeId</c> to the <c>listShipments</c> operation so the
/// dashboard's filter vocabulary is genuinely shared with the shipment list. This suite proves the
/// implementation actually honours it. Before this, the parameter bound to nothing and a
/// <c>?routeId=7</c> request silently returned the UNFILTERED list — the worst shape a filter can
/// take, because it looks like it worked.
///
/// The decisive test is <see cref="AC6_Same_route_filter_returns_the_same_shipments_on_board_and_list"/>:
/// the board and the list are two separate filter chains, and AC-6 only holds while they agree.
/// </summary>
public class ShipmentListRouteFilterTests : IClassFixture<LogiFlowTestFactory>
{
    private readonly PlanningBoardFixture _f;
    private static readonly JsonSerializerOptions Json = PlanningBoardFixture.Json;

    public ShipmentListRouteFilterTests(LogiFlowTestFactory factory) =>
        _f = new PlanningBoardFixture(factory);

    private async Task<JsonElement> ListAsync(string query = "")
    {
        var res = await (await _f.DispatcherAsync()).GetAsync($"/api/v1/shipments{query}");
        res.StatusCode.Should().Be(HttpStatusCode.OK);
        return await res.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    private async Task<(HttpStatusCode Status, JsonElement Body)> TryListAsync(string query)
    {
        var res = await (await _f.DispatcherAsync()).GetAsync($"/api/v1/shipments{query}");
        return (res.StatusCode, await res.Content.ReadFromJsonAsync<JsonElement>(Json));
    }

    private static long[] Ids(JsonElement page) =>
        page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetInt64()).ToArray();

    // ---- the filter narrows, and only narrows ------------------------------------------------

    [Fact]
    public async Task AC6_Route_filter_returns_only_the_shipments_on_that_route()
    {
        // LOGI-0012 AC-6
        var vehicleId = await _f.SeedVehicleAsync(9000, "AC6");
        var routeId = await _f.SeedPlannedRouteAsync(vehicleId, "AC6");
        var onRoute = await _f.SeedShipmentAsync(nameof(ShipmentStatus.Assigned), routeId: routeId);
        var otherRoute = await _f.SeedPlannedRouteAsync(await _f.SeedVehicleAsync(9000, "AC6B"), "AC6B");
        var elsewhere = await _f.SeedShipmentAsync(nameof(ShipmentStatus.Assigned), routeId: otherRoute);

        var page = await ListAsync($"?routeId={routeId}&pageSize=100");

        Ids(page).Should().Contain(onRoute).And.NotContain(elsewhere);
        page.GetProperty("totalCount").GetInt32().Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task AC6_Route_filter_does_not_widen_to_include_the_unassigned_backlog()
    {
        // LOGI-0012 AC-6: a routeId filter is an equality the dispatcher chose. Widening it to
        // "routeId = 7 OR routeId IS NULL" would smuggle in the unassigned backlog — a silent extra
        // filter nobody asked for. Same rule the planning board records (LOGI-0011 AC-5).
        var routeId = await _f.SeedPlannedRouteAsync(await _f.SeedVehicleAsync(9000, "AC6U"), "AC6U");
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Assigned), routeId: routeId);
        var unassigned = await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending));

        var page = await ListAsync($"?routeId={routeId}&pageSize=100");

        Ids(page).Should().NotContain(unassigned);
        page.GetProperty("items").EnumerateArray()
            .Should().OnlyContain(i => i.GetProperty("routeId").GetInt64() == routeId);
    }

    [Fact]
    public async Task AC6_Unknown_route_returns_an_empty_page_not_a_404()
    {
        // LOGI-0012 AC-6: this is a filtered view, not a lookup. A route that matches nothing is an
        // empty result; a 404 here would wrongly imply the route itself must exist.
        var page = await ListAsync("?routeId=987654321");

        Ids(page).Should().BeEmpty();
        page.GetProperty("totalCount").GetInt32().Should().Be(0);
        page.GetProperty("totalPages").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task AC6_Route_filter_composes_with_status_rather_than_replacing_it()
    {
        // LOGI-0012 AC-6: the filters AND together (LOGI-0007 §7). routeId must narrow an already
        // status-filtered set, not undo it.
        var routeId = await _f.SeedPlannedRouteAsync(await _f.SeedVehicleAsync(9000, "AC6C"), "AC6C");
        var assigned = await _f.SeedShipmentAsync(nameof(ShipmentStatus.Assigned), routeId: routeId);
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending), routeId: routeId);

        var page = await ListAsync(
            $"?routeId={routeId}&status={nameof(ShipmentStatus.Assigned)}&pageSize=100");

        Ids(page).Should().Contain(assigned);
        page.GetProperty("items").EnumerateArray()
            .Should().OnlyContain(i => i.GetProperty("status").GetString() == nameof(ShipmentStatus.Assigned));
    }
}