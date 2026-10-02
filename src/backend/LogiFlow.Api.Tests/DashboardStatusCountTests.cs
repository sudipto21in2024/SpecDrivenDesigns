using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0012 backend: the status tiles (AC-1) and the tile/list agreement guarantee (AC-3).
///
/// The dashboard is a pure reader of data GET /shipments already owns, so these tests assert the
/// tiles count what EXISTS over the active filters — never what the response happened to return.
/// </summary>
public class DashboardStatusCountTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly DashboardFixture _fixture;

    public DashboardStatusCountTests(LogiFlowTestFactory factory) =>
        _fixture = new DashboardFixture(factory);

    public async Task InitializeAsync() => await _fixture.DispatcherAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    // ---- AC-1: counts by status -------------------------------------------------------------------

    [Fact]
    public async Task AC1_All_six_statuses_are_present_in_lifecycle_order_even_when_empty()
    {
        // LOGI-0012 AC-1 — a status with no shipments is present with 0; entries are never omitted.
        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.StatusCounts(d).Should().HaveCount(6);
        DashboardFixture.StatusOrder(d).Should().Equal(
            nameof(ShipmentStatus.Pending), nameof(ShipmentStatus.Assigned),
            nameof(ShipmentStatus.InTransit), nameof(ShipmentStatus.Delivered),
            nameof(ShipmentStatus.Delayed), nameof(ShipmentStatus.Cancelled));
    }

    [Fact]
    public async Task AC1_Counts_reflect_the_seeded_shipments_per_status()
    {
        // LOGI-0012 AC-1
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 48);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 48);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Delayed), slaDueInHours: 48);

        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.CountFor(d, nameof(ShipmentStatus.Pending)).Should().BeGreaterThanOrEqualTo(1);
        DashboardFixture.CountFor(d, nameof(ShipmentStatus.InTransit)).Should().BeGreaterThanOrEqualTo(1);
        DashboardFixture.CountFor(d, nameof(ShipmentStatus.Delayed)).Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task AC1_Counts_are_untruncated_and_never_capped_by_the_page_size()
    {
        // LOGI-0012 AC-1 — the tile counts what EXISTS. With pageSize=1 the at-risk list carries one
        // row, but the counts must still reflect every seeded shipment.
        const int seeded = 5;
        for (var i = 0; i < seeded; i++)
            await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 48);

        var d = await _fixture.GetDashboardAsync(query: "?pageSize=1");

        DashboardFixture.CountFor(d, nameof(ShipmentStatus.Pending))
            .Should().BeGreaterThanOrEqualTo(seeded);
    }

    [Fact]
    public async Task AC1_Counts_follow_the_active_status_filter()
    {
        // LOGI-0012 AC-1 — "computed over the same filter set the at-risk list uses", so narrowing
        // to one status must collapse the tiles onto that one.
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 48);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Cancelled), slaDueInHours: 48);

        var d = await _fixture.GetDashboardAsync(query: $"?status={nameof(ShipmentStatus.Cancelled)}");

        DashboardFixture.CountFor(d, nameof(ShipmentStatus.Cancelled)).Should().BeGreaterThanOrEqualTo(1);
        DashboardFixture.CountFor(d, nameof(ShipmentStatus.Pending)).Should().Be(0);
    }

    [Fact]
    public async Task AC1_Counts_follow_the_priority_filter()
    {
        // LOGI-0012 AC-1 — the filter must narrow the tiles, not just the at-risk list. Asserted as
        // a DELTA because the class shares one database and siblings already seeded Standard
        // shipments, so an absolute "0" would only hold on an untouched database.
        var before = DashboardFixture.CountFor(
            await _fixture.GetDashboardAsync(query: "?priority=Standard"),
            nameof(ShipmentStatus.Pending));

        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Pending), priority: "Express");

        var standard = DashboardFixture.CountFor(
            await _fixture.GetDashboardAsync(query: "?priority=Standard"),
            nameof(ShipmentStatus.Pending));
        var express = DashboardFixture.CountFor(
            await _fixture.GetDashboardAsync(query: "?priority=Express"),
            nameof(ShipmentStatus.Pending));

        standard.Should().Be(before, "an Express shipment must not appear under the Standard filter");
        express.Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task AC1_Counts_follow_the_route_filter()
    {
        // LOGI-0012 AC-1 — a routeId the seeded shipments do not carry narrows the set to nothing,
        // and the tiles must say so rather than reporting the whole fleet.
        var routeId = await _fixture.SeedRouteAsync();

        var d = await _fixture.GetDashboardAsync(query: $"?routeId={routeId}");

        DashboardFixture.StatusCounts(d).Sum(c => c.GetProperty("count").GetInt32()).Should().Be(0);
    }

    // ---- AC-3: the tile and the list cannot disagree ---------------------------------------------

    [Fact]
    public async Task AC3_AtRiskTotalCount_equals_the_at_risk_page_totalCount()
    {
        // LOGI-0012 AC-3 — the tile number and the list it links to are the same number.
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 1);

        var d = await _fixture.GetDashboardAsync();

        d.GetProperty("atRiskTotalCount").GetInt32()
            .Should().Be(DashboardFixture.AtRiskPage(d).GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task AC3_Every_carried_row_is_itself_at_risk()
    {
        // LOGI-0012 AC-3 — under the response's own generatedAt, no row may be present that the BR-2
        // projection would not select. A negative minutesToDue (overdue) is still at risk; a
        // comfortably-future due date would not be.
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Delayed), slaDueInHours: -1);

        var d = await _fixture.GetDashboardAsync();

        foreach (var row in DashboardFixture.AtRiskRows(d))
            row.GetProperty("minutesToDue").GetInt32()
                .Should().BeLessThanOrEqualTo(120, "BR-2 at risk means due within 2 hours");
    }
}

