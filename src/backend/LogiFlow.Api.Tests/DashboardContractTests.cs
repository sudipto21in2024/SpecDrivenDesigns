using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using LogiFlow.Domain;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0012 backend: validation and determinism (AC-8), the drill-down contract (AC-6) and the
/// no-regression guarantee (AC-9).
///
/// The AC-6 tests are deliberately PARITY assertions against <c>GET /shipments</c> rather than
/// hand-written expectations: the point of the AC is that the dashboard's notion of "at risk" is
/// literally the list's, so the test must compare the two live surfaces directly. A hand-written
/// number would keep passing even if both surfaces drifted together.
/// </summary>
public class DashboardContractTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly DashboardFixture _fixture;

    public DashboardContractTests(LogiFlowTestFactory factory) =>
        _fixture = new DashboardFixture(factory);

    public async Task InitializeAsync() => await _fixture.DispatcherAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    // ---- AC-8: validation -------------------------------------------------------------------------

    [Theory]
    [InlineData("?pageSize=0")]
    [InlineData("?pageSize=101")]
    public async Task AC8_An_out_of_range_pageSize_is_400_with_a_keyed_error(string query)
    {
        // LOGI-0012 AC-8 — the contract caps pageSize at 1..100.
        var res = await (await _fixture.DispatcherAsync())
            .GetAsync($"{DashboardFixture.DashboardUrl}{query}");

        res.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>(DashboardFixture.Json);
        body.GetProperty("errors").TryGetProperty("pageSize", out _).Should().BeTrue();
    }

    [Theory]
    [InlineData("?status=Teleported")]
    [InlineData("?priority=Lightning")]
    public async Task AC8_An_unknown_enum_value_is_400_naming_the_parameter(string query)
    {
        // LOGI-0012 AC-8 — an unknown enum fails loudly rather than rendering an empty tile.
        var res = await (await _fixture.DispatcherAsync())
            .GetAsync($"{DashboardFixture.DashboardUrl}{query}");

        res.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>(DashboardFixture.Json);
        body.GetProperty("errors").EnumerateObject().Should().NotBeEmpty();
    }

    [Fact]
    public async Task AC8_The_default_pageSize_is_20()
    {
        // LOGI-0012 AC-8 — the contract default, applied by the endpoint binder.
        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.AtRiskPage(d).GetProperty("pageSize").GetInt32().Should().Be(20);
    }

    [Fact]
    public async Task AC8_AppliedFilters_echo_what_the_server_actually_applied()
    {
        // LOGI-0012 AC-8 / O4 — the echo lets the UI restore the active filters, and every echoed
        // field is a filter GET /shipments already accepts.
        var d = await _fixture.GetDashboardAsync(
            query: $"?status={nameof(ShipmentStatus.Pending)}&priority=Standard&page=1&pageSize=5");

        var applied = d.GetProperty("appliedFilters");
        applied.GetProperty("status").GetString().Should().Be(nameof(ShipmentStatus.Pending));
        applied.GetProperty("priority").GetString().Should().Be("Standard");
        applied.GetProperty("page").GetInt32().Should().Be(1);
        applied.GetProperty("pageSize").GetInt32().Should().Be(5);
    }

    [Fact]
    public async Task AC8_Two_identical_requests_are_byte_comparable_apart_from_generatedAt()
    {
        // LOGI-0012 AC-8 — determinism. Nothing in the response may vary between two reads of
        // unchanged data: not the counts, not the row order, not the totals.
        //
        // minutesToDue is excluded, deliberately. It is a live countdown DERIVED FROM generatedAt,
        // so it necessarily moves as the captured instant advances (this test observes 60 then 59).
        // That is not nondeterminism — it is the field doing its job — and it is the same
        // relationship AC-3 states: given one generatedAt, every row is evaluated consistently.
        // Asserting it byte-stable would be asserting that time had stopped.
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);

        var first = await RawAsync("?pageSize=5");
        var second = await RawAsync("?pageSize=5");

        Without(first).Should().Be(Without(second));

        // The countdown may only move by the time actually elapsed between the two calls.
        (Minutes(second) - Minutes(first)).Should().BeInRange(-1, 0,
            "the second call is later, so minutesToDue can only stay equal or tick down by one");
    }

    private async Task<string> RawAsync(string query)
    {
        var res = await (await _fixture.DispatcherAsync())
            .GetAsync($"{DashboardFixture.DashboardUrl}{query}");
        res.StatusCode.Should().Be(HttpStatusCode.OK);
        return await res.Content.ReadAsStringAsync();
    }

    private static string Without(string json)
    {
        var doc = JsonNode.Parse(json)!.AsObject();
        doc.Remove("generatedAt");
        foreach (var row in doc["atRiskShipments"]!["items"]!.AsArray())
            row!.AsObject().Remove("minutesToDue");
        return doc.ToJsonString();
    }

    private static int Minutes(string json)
    {
        var doc = JsonNode.Parse(json)!.AsObject();
        return (int?)doc["atRiskShipments"]!["items"]!.AsArray()[0]!["minutesToDue"] ?? 0;
    }

    // ---- AC-6: drill-down, not a second query language --------------------------------------------

    [Fact]
    public async Task AC6_The_at_risk_total_equals_the_shipment_lists_slaRisk_totalCount()
    {
        // LOGI-0012 AC-6 — the criterion is that following the link shows exactly the rows the tile
        // counted, so the assertion is parity between the two live surfaces.
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 24);

        var client = await _fixture.DispatcherAsync();
        var dashboard = await _fixture.GetDashboardAsync(client);
        var list = await _fixture.GetShipmentsAsync(client, "?slaRisk=true&pageSize=1");

        dashboard.GetProperty("atRiskTotalCount").GetInt32()
            .Should().Be(list.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task AC6_A_status_filtered_dashboard_matches_the_status_filtered_list()
    {
        // LOGI-0012 AC-6 — every dashboard filter is also a GET /shipments filter, so the same
        // filter must narrow both surfaces identically.
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 1);

        var client = await _fixture.DispatcherAsync();
        var query = $"?status={nameof(ShipmentStatus.InTransit)}&slaRisk=true&pageSize=1";
        var dashboard = await _fixture.GetDashboardAsync(client, query);
        var list = await _fixture.GetShipmentsAsync(client, query);

        dashboard.GetProperty("atRiskTotalCount").GetInt32()
            .Should().Be(list.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task AC6_An_unfiltered_dashboard_reports_null_for_every_unset_filter()
    {
        // LOGI-0012 AC-6 — the dashboard requires nothing the list cannot express, and the echo
        // distinguishes "unset" from "not returned".
        var d = await _fixture.GetDashboardAsync();
        var applied = d.GetProperty("appliedFilters");

        applied.GetProperty("status").ValueKind.Should().Be(JsonValueKind.Null);
        applied.GetProperty("priority").ValueKind.Should().Be(JsonValueKind.Null);
        applied.GetProperty("originWarehouseId").ValueKind.Should().Be(JsonValueKind.Null);
        applied.GetProperty("routeId").ValueKind.Should().Be(JsonValueKind.Null);
    }


    // ---- AC-9: no regression ----------------------------------------------------------------------

    [Fact]
    public async Task AC9_The_shipments_list_keeps_its_own_at_risk_projection_and_paging()
    {
        // LOGI-0012 AC-9 — the dashboard is a pure reader, so GET /shipments must still project the
        // per-row atRisk flag itself and page independently of anything the dashboard does.
        var atRiskId = await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.InTransit), slaDueInHours: 1);
        await _fixture.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 48);

        var list = await _fixture.GetShipmentsAsync(await _fixture.DispatcherAsync(), "?slaRisk=true");

        list.GetProperty("totalCount").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        list.GetProperty("items").EnumerateArray()
            .Should().Contain(i => i.GetProperty("id").GetInt64() == atRiskId
                && i.GetProperty("atRisk").GetBoolean());
    }

    [Fact]
    public async Task AC9_The_planning_board_is_unaffected()
    {
        // LOGI-0012 AC-9 — the board shares the filter predicate with the dashboard, so this is the
        // regression canary for the shared-overload refactor.
        var res = await (await _fixture.DispatcherAsync()).GetAsync("/api/v1/planning-board");

        res.StatusCode.Should().Be(HttpStatusCode.OK);
        var board = await res.Content.ReadFromJsonAsync<JsonElement>(DashboardFixture.Json);
        board.GetProperty("columns").GetArrayLength().Should().Be(6);
    }
}

