using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0012 backend follow-up, AC-6 (part 2): the <c>routeId</c> filter's validation and its
/// agreement with the planning board.
///
/// Split from <see cref="ShipmentListRouteFilterTests"/>, which covers the narrowing semantics, so
/// neither file grows past the 150-line governance gate.
/// </summary>
public class ShipmentListRouteFilterParityTests : IClassFixture<LogiFlowTestFactory>
{
    private readonly PlanningBoardFixture _f;
    private static readonly JsonSerializerOptions Json = PlanningBoardFixture.Json;

    public ShipmentListRouteFilterParityTests(LogiFlowTestFactory factory) =>
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

    // ---- validation ----------------------------------------------------------------------------

    [Fact]
    public async Task AC6_Non_positive_route_id_is_a_keyed_400()
    {
        // LOGI-0012 AC-6 + the contract's minimum: 1. Failing loudly matters here specifically
        // because the pre-fix behaviour for an unknown value was to ignore the parameter entirely.
        foreach (var bad in new[] { "routeId=0", "routeId=-1" })
        {
            var (status, body) = await TryListAsync($"?{bad}");

            status.Should().Be(HttpStatusCode.BadRequest, $"'{bad}' is below the contract minimum");
            // camelCase key, matching the contract's parameter name (AC-8's keyed errors map).
            body.GetProperty("errors").TryGetProperty("routeId", out _).Should().BeTrue();
        }
    }

    [Fact]
    public async Task AC6_A_valid_route_id_is_honoured_rather_than_merely_validated()
    {
        // LOGI-0012 AC-6: pins the difference between "the parameter is understood" and "the
        // parameter is rejected when nonsensical". A 400-only suite would still have passed against
        // the pre-fix code, which ignored routeId entirely.
        var routeId = await _f.SeedPlannedRouteAsync(await _f.SeedVehicleAsync(9000, "AC6V"), "AC6V");
        var onRoute = await _f.SeedShipmentAsync(nameof(ShipmentStatus.Assigned), routeId: routeId);
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending));

        var filtered = await ListAsync($"?routeId={routeId}&pageSize=100");
        var unfiltered = await ListAsync("?pageSize=100");

        Ids(filtered).Should().Contain(onRoute);
        unfiltered.GetProperty("totalCount").GetInt32()
            .Should().BeGreaterThan(filtered.GetProperty("totalCount").GetInt32());
    }

    // ---- the cross-endpoint guarantee AC-6 actually exists for ---------------------------------

    [Fact]
    public async Task AC6_Same_route_filter_returns_the_same_shipments_on_board_and_list()
    {
        // LOGI-0012 AC-6: the board and the list are two separate filter chains — this list builds
        // its predicates inline while the board goes through PlanningBoardFilters. Nothing but this
        // assertion stops them drifting, which is exactly the drift AC-6 forbids: the dashboard
        // counts rows with the board's filter and drills into the list's, and if the two disagree
        // the tile and the page it links to show different numbers.
        var routeId = await _f.SeedPlannedRouteAsync(
            await _f.SeedVehicleAsync(9000, "AC6X"), "AC6X");
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Assigned), routeId: routeId);
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending), routeId: routeId);

        // maxPerColumn=200 is the contract ceiling, so no column truncates and the comparison is
        // over complete sets rather than a cap.
        var board = await _f.GetBoardAsync(query: $"?routeId={routeId}&maxPerColumn=200");
        var boardIds = PlanningBoardFixture.AllCards(board)
            .Select(c => c.GetProperty("id").GetInt64()).OrderBy(id => id).ToArray();

        var listIds = Ids(await ListAsync($"?routeId={routeId}&pageSize=100"))
            .OrderBy(id => id).ToArray();

        listIds.Should().NotBeEmpty();
        boardIds.Should().Equal(listIds);
    }
}