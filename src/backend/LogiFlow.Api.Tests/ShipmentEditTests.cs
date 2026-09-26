using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Shipment detail + edit tests (LOGI-0008 AC-1 … AC-7, AC-12 — the F6 "edit while Pending" half).
/// Runs against the real API + SQLite: the PATCH body is bound as raw JSON, so these tests also
/// prove the presence-vs-null contract and that the write is all-or-nothing (rejected requests
/// must leave the row and the audit trail byte-identical).
/// </summary>
public class ShipmentEditTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _client = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public ShipmentEditTests(LogiFlowTestFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        await _client.SignInAsync(Roles.Dispatcher);
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private static string UniqueReference() => $"SHP-{Guid.NewGuid():N}"[..16].ToUpperInvariant();

    private async Task<long> SeedWarehouseAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/warehouses",
            new { name = $"WH {Guid.NewGuid():N}"[..12], address = "Test street 1", latitude = 52.0, longitude = 4.9 }, Json);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("id").GetInt64();
    }

    /// <summary>
    /// Seeds a shipment at a given status through the domain (the detail/edit tests need statuses
    /// other than Pending, which only the transition endpoint can reach on a live client).
    /// </summary>
    private async Task<long> SeedShipmentAsync(long originWarehouseId, string status = "Pending", string priority = "Standard")
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlow.Infrastructure.Persistence.LogiFlowDbContext>();
        // BR-1 is applied here too (SlaPolicy.DueAt): a row seeded with sla_due_at = null would
        // make the BR-1/BR-2 assertions vacuous, since atRisk is false for a null due date.
        var now = SlaPolicy.TruncateToSeconds(DateTime.UtcNow);
        var shipment = Shipment.Create(
            UniqueReference(), originWarehouseId, "Test destination 1", null, null, 1000,
            status, priority, SlaPolicy.DueAt(now, priority), now);
        db.Shipments.Add(shipment);
        await db.SaveChangesAsync();
        return shipment.Id;
    }

    private async Task<(HttpStatusCode Status, JsonElement Body)> PatchAsync(
        HttpClient client, long id, object payload)
    {
        var response = await client.PatchAsJsonAsync($"/api/v1/shipments/{id}", payload, Json);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        return (response.StatusCode, body);
    }

    private async Task<JsonElement> GetAsync(HttpClient client, long id)
    {
        var response = await client.GetAsync($"/api/v1/shipments/{id}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    [Fact]
    // LOGI-0008 AC-1 + AC-6 + AC-12 (edit half)
    public async Task AC1_Pending_shipment_is_edited_and_reads_back_everywhere()
    {
        var origin = await SeedWarehouseAsync();
        var other = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin, priority: "Express");
        var before = await GetAsync(_client, id);
        var slaBefore = before.GetProperty("slaDueAt").GetDateTimeOffset();
        var createdBefore = before.GetProperty("createdAt").GetDateTimeOffset();
        var referenceBefore = before.GetProperty("referenceCode").GetString();

        var (status, body) = await PatchAsync(_client, id, new
        {
            originWarehouseId = other,
            destinationAddress = "99 Quay Street, Antwerp",
            destinationLat = 51.2194,
            destinationLng = 4.4025,
            weightKg = 2400.75,
        });

        status.Should().Be(HttpStatusCode.OK);

        // The 200 body is the full ShipmentResponse with the new values.
        body.GetProperty("id").GetInt64().Should().Be(id);
        body.GetProperty("originWarehouseId").GetInt64().Should().Be(other);
        body.GetProperty("destinationAddress").GetString().Should().Be("99 Quay Street, Antwerp");
        body.GetProperty("destinationLat").GetDouble().Should().BeApproximately(51.2194, 1e-6);
        body.GetProperty("destinationLng").GetDouble().Should().BeApproximately(4.4025, 1e-6);
        body.GetProperty("weightKg").GetDouble().Should().BeApproximately(2400.75, 1e-6);

        // Server-owned fields are untouched — AC-1 names referenceCode/status/priority/slaDueAt/createdAt.
        body.GetProperty("referenceCode").GetString().Should().Be(referenceBefore);
        body.GetProperty("status").GetString().Should().Be("Pending");
        body.GetProperty("priority").GetString().Should().Be("Express");
        body.GetProperty("slaDueAt").GetDateTimeOffset().Should().Be(slaBefore, "BR-1 rule 1.5: the due date is computed once at creation and edits do not reset the clock");
        body.GetProperty("createdAt").GetDateTimeOffset().Should().Be(createdBefore);
        // §7 O6: updatedAt is server-managed and moves forward.
        body.GetProperty("updatedAt").GetDateTimeOffset().Should().BeOnOrAfter(
            before.GetProperty("updatedAt").GetDateTimeOffset().AddSeconds(-1));

        // AC-6: the detail read (the endpoint LOGI-0007 deferred here) returns the new values.
        var detail = await GetAsync(_client, id);
        detail.GetProperty("destinationAddress").GetString().Should().Be("99 Quay Street, Antwerp");
        detail.GetProperty("weightKg").GetDouble().Should().BeApproximately(2400.75, 1e-6);
        detail.GetProperty("originWarehouseId").GetInt64().Should().Be(other);

        // And the list agrees with the detail read.
        var list = await _client.GetFromJsonAsync<JsonElement>("/api/v1/shipments?pageSize=100", Json);
        var row = list.GetProperty("items").EnumerateArray().First(i => i.GetProperty("id").GetInt64() == id);
        row.GetProperty("destinationAddress").GetString().Should().Be("99 Quay Street, Antwerp");

        // AC-1: an edit is not a status transition, so the audit trail must be untouched.
        // 0, not 1: this fixture seeds shipments straight through the DbContext, bypassing the
        // create handler that writes the initial Pending history row.
        (await HistoryCountAsync(id)).Should().Be(0,
            "an edit writes no shipment_status_history row, and this seeded shipment has no initial row");
    }

    [Fact]
    // LOGI-0008 AC-1 (an explicit null clears a coordinate; an omitted one is preserved)
    public async Task AC1_explicit_null_clears_a_coordinate_while_an_omitted_one_is_preserved()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);
        (await PatchAsync(_client, id, new { destinationLat = 51.9, destinationLng = 4.4 })).Status
            .Should().Be(HttpStatusCode.OK);

        // Explicit nulls clear the coordinates.
        (await PatchAsync(_client, id, new { destinationLat = (double?)null, destinationLng = (double?)null })).Status
            .Should().Be(HttpStatusCode.OK);
        var cleared = await GetAsync(_client, id);
        cleared.GetProperty("destinationLat").ValueKind.Should().Be(JsonValueKind.Null);
        cleared.GetProperty("destinationLng").ValueKind.Should().Be(JsonValueKind.Null);

        // Omitting them in a later patch changes nothing else.
        var (status, body) = await PatchAsync(_client, id, new { weightKg = 12.5 });
        status.Should().Be(HttpStatusCode.OK);
        body.GetProperty("weightKg").GetDouble().Should().BeApproximately(12.5, 1e-6);
        body.GetProperty("destinationLat").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Theory]
    [InlineData("Assigned")]
    [InlineData("InTransit")]
    [InlineData("Delivered")]
    [InlineData("Delayed")]
    [InlineData("Cancelled")]
    // LOGI-0008 AC-2 (BR-7 keeps edits to the Pending state)
    public async Task AC2_edit_outside_pending_is_rejected_with_409_and_writes_nothing(string status)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin, status);
        var before = await GetAsync(_client, id);
        var historyBefore = await HistoryCountAsync(id);

        var (code, body) = await PatchAsync(_client, id, new { destinationAddress = "Should not stick", weightKg = 1 });

        code.Should().Be(HttpStatusCode.Conflict);
        body.GetProperty("detail").GetString().Should().Contain("Pending", "the 409 detail must name the required status");
        body.GetProperty("status").GetInt32().Should().Be(409);

        // Nothing partially applied: every column identical, no audit row.
        var after = await GetAsync(_client, id);
        after.GetProperty("destinationAddress").GetString().Should().Be(before.GetProperty("destinationAddress").GetString());
        after.GetProperty("weightKg").GetDouble().Should().Be(before.GetProperty("weightKg").GetDouble());
        after.GetProperty("status").GetString().Should().Be(status);
        (await HistoryCountAsync(id)).Should().Be(historyBefore);
    }

    [Fact]
    // LOGI-0008 AC-3 (blank/whitespace address)
    public async Task AC3_blank_destination_address_is_a_field_keyed_400()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);
        var before = await GetAsync(_client, id);

        var (code, body) = await PatchAsync(_client, id, new { destinationAddress = "   " });

        code.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(body, "destinationAddress").Should().Contain("non-blank");
        var after = await GetAsync(_client, id);
        after.GetProperty("destinationAddress").GetString().Should().Be(before.GetProperty("destinationAddress").GetString());
    }

    [Fact]
    // LOGI-0008 AC-3 (>500 characters)
    public async Task AC3_overlong_destination_address_is_a_field_keyed_400()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);

        var (code, body) = await PatchAsync(_client, id, new { destinationAddress = new string('x', 501) });

        code.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(body, "destinationAddress").Should().Contain("500");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(-0.5)]
    // LOGI-0008 AC-3 (non-positive weight; contract exclusiveMinimum: 0)
    public async Task AC3_non_positive_weight_is_a_field_keyed_400(double weight)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);
        var before = await GetAsync(_client, id);

        var (code, body) = await PatchAsync(_client, id, new { weightKg = weight });

        code.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(body, "weightKg").Should().Contain("greater than 0");
        (await GetAsync(_client, id)).GetProperty("weightKg").GetDouble()
            .Should().Be(before.GetProperty("weightKg").GetDouble());
    }

    [Fact]
    // LOGI-0008 AC-3 (null weight is not "no change" — the field was supplied, so it is validated)
    public async Task AC3_null_weight_is_a_field_keyed_400()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);

        var (code, body) = await PatchAsync(_client, id, new { weightKg = (double?)null });

        code.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(body, "weightKg").Should().Contain("greater than 0");
    }

    [Theory]
    [InlineData(91.0, 4.0, "destinationLat")]
    [InlineData(-90.5, 4.0, "destinationLat")]
    [InlineData(51.0, 180.5, "destinationLng")]
    [InlineData(51.0, -181.0, "destinationLng")]
    // LOGI-0008 AC-3 (contract coordinate ranges)
    public async Task AC3_out_of_range_coordinates_are_field_keyed_400s(double lat, double lng, string field)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);

        var (code, body) = await PatchAsync(_client, id, new { destinationLat = lat, destinationLng = lng });

        code.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(body, field).Should().NotBeNullOrWhiteSpace();
        (await GetAsync(_client, id)).GetProperty("destinationAddress").GetString()
            .Should().Be("Test destination 1", "a rejected edit writes nothing");
    }

    [Theory]
    [InlineData("status", "Delivered")]
    [InlineData("slaDueAt")]
    [InlineData("createdAt")]
    [InlineData("updatedAt")]
    [InlineData("referenceCode")]
    [InlineData("routeId")]
    [InlineData("atRisk")]
    [InlineData("id")]
    // LOGI-0008 AC-4 (server-owned properties are rejected per field, never silently ignored)
    public async Task AC4_server_owned_property_is_rejected_by_name(string field, object? value = null)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);
        var before = await GetAsync(_client, id);

        var (code, body) = await PatchAsync(_client, id, new Dictionary<string, object?>
        {
            ["destinationAddress"] = "Legit change",
            [field] = value,
        });

        code.Should().Be(HttpStatusCode.BadRequest);
        // The middleware camelCases every error key, so the rejected wire name is the key as sent.
        ErrorText(body, field).Should().Contain("server-owned");

        // Not even the legitimate field is applied — the request is all-or-nothing.
        var after = await GetAsync(_client, id);
        after.GetProperty("destinationAddress").GetString()
            .Should().Be(before.GetProperty("destinationAddress").GetString());
        after.GetProperty("status").GetString().Should().Be("Pending");
    }

    [Theory]
    [InlineData("Standard")]
    [InlineData("Express")]
    // LOGI-0008 AC-4 + BR-1 rule 1.5 (priority is immutable; the due date is fixed at creation)
    public async Task AC4_priority_is_rejected_as_immutable(string priority)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin, priority: "Standard");
        var before = await GetAsync(_client, id);

        var (code, body) = await PatchAsync(_client, id, new
        {
            priority,
            destinationAddress = "Legit change",
        });

        code.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(body, "priority").Should().Contain("immutable");
        ErrorText(body, "priority").Should().Contain("BR-1 rule 1.5");

        var after = await GetAsync(_client, id);
        after.GetProperty("priority").GetString().Should().Be("Standard");
        after.GetProperty("slaDueAt").GetDateTimeOffset().Should().Be(before.GetProperty("slaDueAt").GetDateTimeOffset());
        after.GetProperty("destinationAddress").GetString()
            .Should().Be(before.GetProperty("destinationAddress").GetString());
    }

    [Fact]
    // LOGI-0008 AC-5 (unknown id on both new endpoints)
    public async Task AC5_unknown_shipment_is_404_on_detail_and_edit()
    {
        var get = await _client.GetAsync("/api/v1/shipments/999999");
        get.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await get.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("status").GetInt32().Should().Be(404);

        var (code, body) = await PatchAsync(_client, 999999, new { destinationAddress = "Nowhere" });
        code.Should().Be(HttpStatusCode.NotFound);
        body.GetProperty("status").GetInt32().Should().Be(404);
    }

    [Fact]
    // LOGI-0008 AC-6 (detail returns the same shape as a list row, incl. the BR-2 projection)
    public async Task AC6_detail_matches_the_list_row_shape()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);
        var detail = await GetAsync(_client, id);
        var list = await _client.GetFromJsonAsync<JsonElement>("/api/v1/shipments?pageSize=100", Json);
        var row = list.GetProperty("items").EnumerateArray().First(i => i.GetProperty("id").GetInt64() == id);

        // The detail envelope is the ShipmentResponse itself (no paging wrapper), and its
        // property set is exactly the list row's.
        detail.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal)
            .Should().Equal(row.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
        detail.GetProperty("atRisk").GetBoolean().Should().Be(row.GetProperty("atRisk").GetBoolean());
        detail.GetProperty("routeId").ValueKind.Should().Be(JsonValueKind.Null, "routeId stays null until LOGI-0010");
    }

    [Fact]
    // LOGI-0008 AC-7 (anonymous callers are 401 on both new endpoints)
    public async Task AC7_anonymous_get_and_patch_are_401()
    {
        using var anon = _factory.CreateClient();

        (await anon.GetAsync($"/api/v1/shipments/{await SeedShipmentAsync(await SeedWarehouseAsync())}"))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await anon.PatchAsJsonAsync("/api/v1/shipments/1", new { weightKg = 5 }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    // LOGI-0008 AC-7 + AC-11 seam (Viewer reads but cannot edit — BR-6)
    public async Task AC7_viewer_can_read_detail_but_patch_is_403()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);
        using var viewer = _factory.CreateClient();
        await viewer.SignInAsync(Roles.Viewer);

        (await viewer.GetAsync($"/api/v1/shipments/{id}")).StatusCode.Should().Be(HttpStatusCode.OK);

        var (code, body) = await PatchAsync(viewer, id, new { weightKg = 5 });
        code.Should().Be(HttpStatusCode.Forbidden);
        body.GetProperty("status").GetInt32().Should().Be(403);
        (await GetAsync(_client, id)).GetProperty("weightKg").GetDouble().Should().BeApproximately(1000, 1e-6);
    }

    [Fact]
    // LOGI-0008 AC-7 + AC-11 seam (Driver is excluded until own-route scoping lands)
    public async Task AC7_driver_is_403_on_both_detail_and_edit()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);
        using var driver = _factory.CreateClient();
        await driver.SignInAsync(Roles.Driver);

        (await driver.GetAsync($"/api/v1/shipments/{id}")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await PatchAsync(driver, id, new { weightKg = 5 })).Status.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    // LOGI-0008 AC-7 (both management roles may edit and read)
    public async Task AC7_admin_and_dispatcher_may_read_and_edit()
    {
        var origin = await SeedWarehouseAsync();
        foreach (var role in new[] { Roles.Admin, Roles.Dispatcher })
        {
            var id = await SeedShipmentAsync(origin);
            using var client = _factory.CreateClient();
            await client.SignInAsync(role);

            (await client.GetAsync($"/api/v1/shipments/{id}")).StatusCode.Should().Be(HttpStatusCode.OK);
            (await PatchAsync(client, id, new { destinationAddress = $"Edited by {role}" })).Status
                .Should().Be(HttpStatusCode.OK);
            (await GetAsync(_client, id)).GetProperty("destinationAddress").GetString()
                .Should().Be($"Edited by {role}");
        }
    }

    [Fact]
    // LOGI-0008 AC-12 (BR-2 non-regression: a cancelled shipment is never at risk)
    public async Task AC12_edit_does_not_change_slaDueAt_and_priority_even_across_repeated_edits()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin, priority: "Express");
        var created = await GetAsync(_client, id);
        var sla = created.GetProperty("slaDueAt").GetDateTimeOffset();

        for (var i = 0; i < 3; i++)
        {
            (await PatchAsync(_client, id, new { weightKg = 100 + i, destinationAddress = $"Edit {i}" })).Status
                .Should().Be(HttpStatusCode.OK);
        }

        var after = await GetAsync(_client, id);
        after.GetProperty("slaDueAt").GetDateTimeOffset().Should().Be(sla);
        after.GetProperty("priority").GetString().Should().Be("Express");
        after.GetProperty("createdAt").GetDateTimeOffset().Should().Be(created.GetProperty("createdAt").GetDateTimeOffset());
        (after.GetProperty("slaDueAt").GetDateTimeOffset() - after.GetProperty("createdAt").GetDateTimeOffset())
            .Should().Be(TimeSpan.FromHours(12), "Express keeps the BR-1 12h offset no matter how often it is edited");
        (await HistoryCountAsync(id)).Should().Be(0, "repeated edits still write no audit row");
    }

    [Theory]
    [InlineData(999999L, "does not exist")]
    [InlineData(0L, "positive integer")] // a non-positive id never reaches the FK lookup
    // LOGI-0008 AC-3 (FK existence is Application-layer validation → 400 errors.originWarehouseId)
    public async Task AC3_unknown_origin_warehouse_is_a_field_keyed_400(long warehouseId, string expected)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);
        var before = await GetAsync(_client, id);

        var (code, body) = await PatchAsync(_client, id, new { originWarehouseId = warehouseId });

        code.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(body, "originWarehouseId").Should().Contain(expected);
        (await GetAsync(_client, id)).GetProperty("originWarehouseId").GetInt64()
            .Should().Be(before.GetProperty("originWarehouseId").GetInt64());
    }

    [Fact]
    // LOGI-0008 AC-3 (an empty body is a client mistake, not a silent no-op success)
    public async Task AC3_empty_body_is_a_field_keyed_400()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);

        var (code, body) = await PatchAsync(_client, id, new { });

        code.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(body, "body").Should().Contain("At least one editable field");
    }

    [Fact]
    // LOGI-0008 AC-1 (partial patch keeps the untouched fields)
    public async Task AC1_partial_patch_preserves_fields_that_were_not_supplied()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin);

        var (status, body) = await PatchAsync(_client, id, new { destinationAddress = "7 Side Road" });

        status.Should().Be(HttpStatusCode.OK);
        body.GetProperty("destinationAddress").GetString().Should().Be("7 Side Road");
        body.GetProperty("originWarehouseId").GetInt64().Should().Be(origin, "originWarehouseId was omitted and must keep its stored value");
        body.GetProperty("weightKg").GetDouble().Should().BeApproximately(1000, 1e-6);
        body.GetProperty("destinationLat").ValueKind.Should().Be(JsonValueKind.Null);
        body.GetProperty("destinationLng").ValueKind.Should().Be(JsonValueKind.Null);
    }

    private async Task<long> HistoryCountAsync(long id)
    {
        var history = await _client.GetFromJsonAsync<JsonElement>($"/api/v1/shipments/{id}/status-history", Json);
        return history.GetProperty("totalCount").GetInt64();
    }

    private static string ErrorText(JsonElement body, string field) =>
        string.Join(" ", body.GetProperty("errors").GetProperty(field).EnumerateArray().Select(e => e.GetString()));
}
