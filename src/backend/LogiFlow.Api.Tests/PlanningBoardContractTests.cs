using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0011 backend, AC-8 and AC-9: validation bounds, truncation reporting, and determinism
/// plus agreement with the shipment detail endpoint.
/// </summary>
public class PlanningBoardContractTests : IClassFixture<LogiFlowTestFactory>
{
    private readonly PlanningBoardFixture _f;
    public PlanningBoardContractTests(LogiFlowTestFactory factory) => _f = new PlanningBoardFixture(factory);

    // ---- AC-8: validation and truncation -----------------------------------------------------------

    [Theory]
    [InlineData("?maxPerColumn=0")]
    [InlineData("?maxPerColumn=201")]
    [InlineData("?status=Bogus")]
    [InlineData("?priority=Urgent")]
    [InlineData("?sort=weightKg")]
    public async Task AC8_Unknown_or_out_of_range_values_are_400(string query)
    {
        // LOGI-0011 AC-8
        var res = await (await _f.DispatcherAsync()).GetAsync($"{PlanningBoardFixture.BoardUrl}{query}");
        res.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var problem = await res.Content.ReadFromJsonAsync<JsonElement>(PlanningBoardFixture.Json);
        problem.GetProperty("errors").EnumerateObject()
            .Should().Contain(e => e.Value.GetArrayLength() > 0);
    }

    [Fact]
    public async Task AC8_Truncated_column_reports_the_untruncated_total_and_the_flag()
    {
        // LOGI-0011 AC-8
        for (var i = 0; i < 3; i++)
            await _f.SeedShipmentAsync(nameof(ShipmentStatus.Delayed), address: $"TRUNC{i} Dock");

        var column = PlanningBoardFixture.Column(
            await _f.GetBoardAsync(query: "?status=Delayed&maxPerColumn=2"), nameof(ShipmentStatus.Delayed));

        column.GetProperty("cards").GetArrayLength().Should().Be(2);
        column.GetProperty("totalCount").GetInt32().Should().BeGreaterThanOrEqualTo(3);
        column.GetProperty("truncated").GetBoolean().Should().BeTrue();

        // An under-filled column is not flagged.
        PlanningBoardFixture.Column(await _f.GetBoardAsync(query: "?status=Delayed&maxPerColumn=200"),
                nameof(ShipmentStatus.Delayed))
            .GetProperty("truncated").GetBoolean().Should().BeFalse();
    }

    // ---- AC-9: determinism and agreement ------------------------------------------------------------

    [Fact]
    public async Task AC9_Two_identical_calls_are_deterministic()
    {
        // LOGI-0011 AC-9
        for (var i = 0; i < 3; i++)
            await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 10 + i);

        var first = await _f.GetBoardAsync();
        var second = await _f.GetBoardAsync();

        foreach (var status in ShipmentStatusValues.All)
            PlanningBoardFixture.CardIds(first, status).Should()
                .Equal(PlanningBoardFixture.CardIds(second, status),
                    $"the {status} column must be stable across identical calls");
    }

    [Fact]
    public async Task AC9_Card_agrees_with_the_shipment_detail_endpoint()
    {
        // LOGI-0011 AC-9: the board projects through the same read model as GET /shipments.
        var id = await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending), 250, slaDueInHours: 5);

        var card = PlanningBoardFixture.Cards(await _f.GetBoardAsync(), nameof(ShipmentStatus.Pending))
            .FirstOrDefault(c => c.GetProperty("id").GetInt64() == id);
        card.ValueKind.Should().NotBe(JsonValueKind.Undefined);

        var detail = await (await _f.DispatcherAsync())
            .GetFromJsonAsync<JsonElement>($"/api/v1/shipments/{id}", PlanningBoardFixture.Json);
        card.GetProperty("status").GetString().Should().Be(detail.GetProperty("status").GetString());
        card.GetProperty("atRisk").GetBoolean().Should().Be(detail.GetProperty("atRisk").GetBoolean());
        card.GetProperty("routeId").ValueKind.Should().Be(detail.GetProperty("routeId").ValueKind);
        card.GetProperty("slaDueAt").GetString().Should().Be(detail.GetProperty("slaDueAt").GetString());
    }

    [Fact]
    public async Task AC9_Default_order_is_sla_due_ascending_not_newest_first()
    {
        // LOGI-0011 AC-9 / plan §5.2: the board is deadline-first, deliberately unlike GET /shipments.
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 100);
        await _f.SeedShipmentAsync(nameof(ShipmentStatus.Pending), slaDueInHours: 1);

        var due = PlanningBoardFixture.Cards(await _f.GetBoardAsync(), nameof(ShipmentStatus.Pending))
            .Where(c => c.GetProperty("slaDueAt").ValueKind != JsonValueKind.Null)
            .Select(c => c.GetProperty("slaDueAt").GetDateTime())
            .ToList();

        due.Should().BeInAscendingOrder();
    }
}
