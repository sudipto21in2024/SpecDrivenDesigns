using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0011 backend, AC-1..AC-3: the kanban column contract, the empty board, and filter
/// composition with the applied-filter echo. Role and read-only coverage is in
/// <see cref="PlanningBoardAuthzTests"/>; capacity/determinism in <see cref="PlanningBoardReadTests"/>.
/// </summary>
public class PlanningBoardColumnTests : IClassFixture<LogiFlowTestFactory>
{
    private readonly PlanningBoardFixture _f;
    public PlanningBoardColumnTests(LogiFlowTestFactory factory) => _f = new PlanningBoardFixture(factory);

    [Fact]
    public async Task AC1_Columns_are_always_all_six_in_lifecycle_order()
    {
        // LOGI-0011 AC-1
        var routeId = await _f.SeedPlannedRouteAsync(await _f.SeedVehicleAsync(5000, "AC1"), "AC1");
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending));
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Assigned), routeId: routeId);
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Cancelled));

        var board = await _f.GetBoardAsync();

        // Never omitted — an empty column still reports 0 so the client can render it.
        PlanningBoardFixture.ColumnOrder(board).Should().ContainInOrder(ShipmentStatusValues.All);
        foreach (var status in new[]
                 {
                     nameof(ShipmentStatus.Pending), nameof(ShipmentStatus.Assigned),
                     nameof(ShipmentStatus.Cancelled)
                 })
            PlanningBoardFixture.Cards(board, status).Should().NotBeEmpty($"a {status} shipment was seeded");

        // Every shipment in exactly one column, in its own status.
        var ids = PlanningBoardFixture.AllCards(board).Select(c => c.GetProperty("id").GetInt64()).ToList();
        ids.Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public async Task AC1_Card_status_always_matches_the_column_it_sits_in()
    {
        // LOGI-0011 AC-1 — the "exactly one column" claim, checked against each card's own status.
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Delayed));
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.InTransit));

        var board = await _f.GetBoardAsync();
        foreach (var column in PlanningBoardFixture.Columns(board))
        {
            var status = column.GetProperty("status").GetString();
            foreach (var card in column.GetProperty("cards").EnumerateArray())
                card.GetProperty("status").GetString().Should().Be(status);
        }
    }

    [Fact]
    public async Task AC2_Empty_board_returns_six_zero_columns_not_an_error()
    {
        // LOGI-0011 AC-2 — filtered to an impossible value so the result is deterministic regardless
        // of what other tests have seeded into the shared database.
        var board = await _f.GetBoardAsync(query: "?q=ZZZ-NO-SUCH-SHIPMENT-ZZZ");

        PlanningBoardFixture.Columns(board).Should().HaveCount(6);
        PlanningBoardFixture.Columns(board)
            .Select(c => c.GetProperty("totalCount").GetInt32()).Should().AllBeEquivalentTo(0);
        board.GetProperty("unassignedTotalCount").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task AC3_Filters_compose_with_AND_and_are_echoed_back()
    {
        // LOGI-0011 AC-3
        var target = await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending), priority: "Express",
            address: "Findme Dock 9");
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending), priority: "Express", address: "Other Dock 1");
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending), priority: "Express", address: "Elsewhere");

        var board = await _f.GetBoardAsync(query: "?status=Pending&priority=Express&q=Findme");

        PlanningBoardFixture.CardIds(board, nameof(ShipmentStatus.Pending))
            .Should().ContainSingle().Which.Should().Be(target);

        // The echo reports exactly what was applied, including defaults for unsupplied values.
        var applied = board.GetProperty("appliedFilters");
        applied.GetProperty("status").GetString().Should().Be("Pending");
        applied.GetProperty("priority").GetString().Should().Be("Express");
        applied.GetProperty("q").GetString().Should().Be("Findme");
        applied.GetProperty("sort").GetString().Should().Be("slaDueAt");
        applied.GetProperty("maxPerColumn").GetInt32().Should().Be(50);
        applied.GetProperty("routeId").ValueKind.Should().Be(JsonValueKind.Null);

        // Counts must follow the filter too, not just the cards.
        PlanningBoardFixture.Column(board, nameof(ShipmentStatus.Pending))
            .GetProperty("totalCount").GetInt32().Should().Be(1);
    }
}