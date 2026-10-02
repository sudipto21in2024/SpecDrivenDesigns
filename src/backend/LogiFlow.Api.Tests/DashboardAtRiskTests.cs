using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0012 backend: the SLA-at-risk list (AC-2). The list is the BR-2 projection evaluated at the
/// response's own generatedAt — the same rule, the same exempt statuses and the same 2h window
/// <c>GET /shipments?slaRisk=true</c> applies, so the tile and its drill-down agree by construction.
/// </summary>
public class DashboardAtRiskTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly DashboardFixture _fixture;

    public DashboardAtRiskTests(LogiFlowTestFactory factory) =>
        _fixture = new DashboardFixture(factory);

    public async Task InitializeAsync() => await _fixture.DispatcherAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    // ---- AC-2: which shipments are at risk ---------------------------------------------------------

    [Fact]
    public async Task AC2_A_shipment_due_within_two_hours_is_at_risk()
    {
        // LOGI-0012 AC-2 — BR-2 rule 2.2 is a 2-hour warning window.
        var id = await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);

        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.AtRiskIds(d).Should().Contain(id);
    }

    [Fact]
    public async Task AC2_A_shipment_due_beyond_two_hours_is_not_at_risk()
    {
        // LOGI-0012 AC-2 — seeded clearly outside the window, not on the boundary.
        var id = await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 24);

        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.AtRiskIds(d).Should().NotContain(id);
    }

    [Fact]
    public async Task AC2_Delivered_and_Cancelled_are_never_at_risk()
    {
        // LOGI-0012 AC-2 / BR-2 rule 2.3 — the two exempt statuses.
        var delivered = await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Delivered), slaDueInHours: 1);
        var cancelled = await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Cancelled), slaDueInHours: 1);

        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.AtRiskIds(d).Should().NotContain(delivered).And.NotContain(cancelled);
    }

    [Fact]
    public async Task AC2_A_delayed_shipment_is_at_risk_and_cannot_escape_by_being_delayed()
    {
        // LOGI-0012 AC-2 / BR-2 rule 2.4 — only Delivered and Cancelled are exempt.
        var id = await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Delayed), slaDueInHours: 1);

        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.AtRiskIds(d).Should().Contain(id);
    }

    [Fact]
    public async Task AC2_A_shipment_with_no_sla_due_at_is_never_at_risk()
    {
        // LOGI-0012 AC-2 / BR-2 rule 2.7.
        var id = await _fixture.SeedShipmentAsync(
            nameof(ShipmentStatus.InTransit), nullDueAt: true);

        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.AtRiskIds(d).Should().NotContain(id);
    }

    // ---- ordering, projection and the paging envelope ----------------------------------------------

    [Fact]
    public async Task AC2_Rows_are_ordered_by_sla_due_date_ascending()
    {
        // LOGI-0012 AC-2 — deadline-first: the most overdue shipment is the first thing a manager
        // should see, which is the whole purpose of this list.
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: -3);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: -1);

        var d = await _fixture.GetDashboardAsync();
        var minutes = DashboardFixture.AtRiskRows(d)
            .Select(r => r.GetProperty("minutesToDue").GetInt32()).ToList();

        minutes.Should().BeInAscendingOrder();
    }

    [Fact]
    public async Task AC2_Each_row_carries_the_fields_the_contract_promises()
    {
        // LOGI-0012 AC-2 — referenceCode, status, priority, slaDueAt and minutesToDue, plus the
        // projection fields the manager needs to recognise the shipment. The row is looked up by id
        // rather than taken as "the first one": the list is ordered by due date, and sibling tests
        // in this class seed their own at-risk shipments into the same database.
        var id = await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit),
            slaDueInHours: 1, priority: "Express");

        var d = await _fixture.GetDashboardAsync(query: "?pageSize=100");
        var row = DashboardFixture.AtRiskRowFor(d, id);

        row.GetProperty("referenceCode").GetString().Should().StartWith("SHP-");
        row.GetProperty("status").GetString().Should().Be(nameof(ShipmentStatus.InTransit));
        row.GetProperty("priority").GetString().Should().Be("Express");
        row.GetProperty("slaDueAt").ValueKind.Should().NotBe(JsonValueKind.Null);
        row.GetProperty("minutesToDue").GetInt32().Should().BeLessThanOrEqualTo(120);
        row.TryGetProperty("originWarehouseId", out _).Should().BeTrue();
        row.TryGetProperty("destinationAddress", out _).Should().BeTrue();
    }

    [Fact]
    public async Task AC2_MinutesToDue_is_negative_once_overdue()
    {
        // LOGI-0012 AC-2 — a breached promise reads as a negative distance, not as absent.
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Delayed), slaDueInHours: -5);

        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.AtRiskRows(d)
            .Should().Contain(r => r.GetProperty("minutesToDue").GetInt32() < 0);
    }

    [Fact]
    public async Task AC2_The_page_uses_the_standard_paging_envelope()
    {
        // LOGI-0012 AC-2 — page, pageSize, totalCount, totalPages, so the UI reuses its own pager.
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);

        var d = await _fixture.GetDashboardAsync(query: "?page=1&pageSize=5");
        var page = DashboardFixture.AtRiskPage(d);

        page.GetProperty("page").GetInt32().Should().Be(1);
        page.GetProperty("pageSize").GetInt32().Should().Be(5);
        page.GetProperty("totalCount").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        page.GetProperty("totalPages").GetInt32().Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task AC2_Paging_a_second_page_returns_different_rows_and_keeps_the_same_total()
    {
        // LOGI-0012 AC-2 — a total that changed with the page would break the pager's page count.
        for (var i = 0; i < 3; i++)
            await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);

        var first = DashboardFixture.AtRiskPage(await _fixture.GetDashboardAsync(query: "?pageSize=1"));
        var second = DashboardFixture.AtRiskPage(await _fixture.GetDashboardAsync(query: "?page=2&pageSize=1"));

        second.GetProperty("totalCount").GetInt32().Should().Be(first.GetProperty("totalCount").GetInt32());
        second.GetProperty("items").GetArrayLength().Should().Be(1);
        second.GetProperty("items")[0].GetProperty("id").GetInt64()
            .Should().NotBe(first.GetProperty("items")[0].GetProperty("id").GetInt64());
    }
}

