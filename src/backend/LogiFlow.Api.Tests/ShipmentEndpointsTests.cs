using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Integration tests for the shipment status lifecycle endpoints (LOGI-0006 AC-1 … AC-8).
/// Shipments are seeded directly through the shared test database (creation is LOGI-0007);
/// the BR-7 state machine is exercised end-to-end against the real API + SQLite, and RBAC
/// assertions run against the real JWT pipeline via per-role signed-in clients.
/// </summary>
public class ShipmentEndpointsTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _client = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public ShipmentEndpointsTests(LogiFlowTestFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        await _client.SignInAsync(Roles.Admin);
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private static string UniqueReference() => $"SHP-{Guid.NewGuid():N}"[..16].ToUpperInvariant();

    private static string UniqueName(string prefix) => $"{prefix} {Guid.NewGuid():N}"[..24];

    private async Task<long> SeedWarehouseAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/warehouses",
            new { name = UniqueName("WH"), address = "Test street 1", latitude = 52.0, longitude = 4.9 }, Json);
        response.StatusCode.Should().Be(HttpStatusCode.Created, "test seeding needs a warehouse for the origin FK");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        return body.GetProperty("id").GetInt64();
    }

    private async Task<long> SeedShipmentAsync(long originWarehouseId, string status = "Pending")
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var shipment = Shipment.Create(
            UniqueReference(), originWarehouseId, "Test destination 1", null, null, 1000,
            status, "Standard", slaDueAt: null, DateTime.UtcNow);
        db.Shipments.Add(shipment);
        await db.SaveChangesAsync();
        return shipment.Id;
    }

    /// <summary>Drives one transition and returns (status code, body). Body may be a ProblemDetails document.</summary>
    private async Task<(HttpStatusCode Status, JsonElement Body)> PostTransitionAsync(
        HttpClient client, long id, string? toStatus, string? note = null)
    {
        var response = await client.PostAsJsonAsync(
            $"/api/v1/shipments/{id}/status-transitions", new { toStatus, note }, Json);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        return (response.StatusCode, body);
    }

    private async Task<(HttpStatusCode Status, JsonElement Body)> GetHistoryAsync(HttpClient client, long id, string? query = null)
    {
        var response = await client.GetAsync($"/api/v1/shipments/{id}/status-history{query}");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        return (response.StatusCode, body);
    }

    /// <summary>Walks a shipment along a legal path, asserting 200 on every step.</summary>
    private async Task DriveAsync(long id, params string[] statuses)
    {
        foreach (var to in statuses)
        {
            var (status, body) = await PostTransitionAsync(_client, id, to);
            status.Should().Be(HttpStatusCode.OK, "driving to {0} is a legal transition", to);
            body.GetProperty("toStatus").GetString().Should().Be(to);
        }
    }

    [Fact]
    public async Task AC1_Forward_chain_succeeds_one_step_at_a_time_and_is_audited()
    {
        var id = await SeedShipmentAsync(await SeedWarehouseAsync(), "Pending");

        await DriveAsync(id, "Assigned", "InTransit", "Delivered");

        var (_, history) = await GetHistoryAsync(_client, id);
        history.GetProperty("totalCount").GetInt64().Should().Be(3);
        var items = history.GetProperty("items");
        items.GetArrayLength().Should().Be(3);

        var newest = items[2];
        newest.GetProperty("fromStatus").GetString().Should().Be("InTransit");
        newest.GetProperty("toStatus").GetString().Should().Be("Delivered");
        newest.GetProperty("changedByUserId").GetInt64().Should().BeGreaterThan(0);
        newest.GetProperty("changedAt").GetDateTimeOffset().Should().BeOnOrBefore(DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task AC2_Cancelled_is_legal_from_Pending_and_Assigned_but_409_afterwards()
    {
        var fromPending = await SeedShipmentAsync(await SeedWarehouseAsync(), "Pending");
        var (status, body) = await PostTransitionAsync(_client, fromPending, "Cancelled");
        status.Should().Be(HttpStatusCode.OK);
        body.GetProperty("toStatus").GetString().Should().Be("Cancelled");

        var fromAssigned = await SeedShipmentAsync(await SeedWarehouseAsync(), "Assigned");
        (await PostTransitionAsync(_client, fromAssigned, "Cancelled")).Status
            .Should().Be(HttpStatusCode.OK);

        // After the fact (InTransit / Delivered): 409 with the legal next states.
        foreach (var seeded in new[] { "InTransit", "Delivered" })
        {
            var id = await SeedShipmentAsync(await SeedWarehouseAsync(), seeded);
            var (illegalStatus, illegalBody) = await PostTransitionAsync(_client, id, "Cancelled");
            illegalStatus.Should().Be(HttpStatusCode.Conflict);
            illegalBody.GetProperty("title").GetString().Should().Be("Conflict");
            illegalBody.GetProperty("status").GetInt32().Should().Be(409);
            illegalBody.GetProperty("detail").GetString().Should().Contain("legal next state(s)");
        }

        var (againStatus, _) = await PostTransitionAsync(_client, fromPending, "Cancelled");
        againStatus.Should().Be(HttpStatusCode.Conflict, "Cancelled is terminal");
    }

    [Fact]
    public async Task AC3_Delayed_only_from_InTransit_and_reversible_back_to_InTransit()
    {
        var id = await SeedShipmentAsync(await SeedWarehouseAsync(), "InTransit");
        await DriveAsync(id, "Delayed");
        var (backStatus, backBody) = await PostTransitionAsync(_client, id, "InTransit");
        backStatus.Should().Be(HttpStatusCode.OK);
        backBody.GetProperty("fromStatus").GetString().Should().Be("Delayed");

        var pending = await SeedShipmentAsync(await SeedWarehouseAsync(), "Pending");
        (await PostTransitionAsync(_client, pending, "Delayed")).Status
            .Should().Be(HttpStatusCode.Conflict, "Delayed is InTransit-scoped per BR-7");

        var assigned = await SeedShipmentAsync(await SeedWarehouseAsync(), "Assigned");
        (await PostTransitionAsync(_client, assigned, "Delayed")).Status
            .Should().Be(HttpStatusCode.Conflict);

        var delivered = await SeedShipmentAsync(await SeedWarehouseAsync(), "InTransit");
        await DriveAsync(delivered, "Delivered");
        (await PostTransitionAsync(_client, delivered, "Delayed")).Status
            .Should().Be(HttpStatusCode.Conflict, "Delivered is terminal");
    }

    [Fact]
    public async Task AC4_Illegal_jump_returns_409_with_legal_next_states_and_no_history_row()
    {
        var id = await SeedShipmentAsync(await SeedWarehouseAsync(), "Pending");

        var (status, body) = await PostTransitionAsync(_client, id, "InTransit");
        status.Should().Be(HttpStatusCode.Conflict);
        var detail = body.GetProperty("detail").GetString();
        detail.Should().Contain("legal next state(s)").And.Contain("Assigned");

        // Rejected attempt: status unchanged (no GET /{id} endpoint until LOGI-0007 — proven
        // by the next transition seeing fromStatus Pending) and no audit row.
        var (_, history) = await GetHistoryAsync(_client, id);
        history.GetProperty("totalCount").GetInt64().Should().Be(0);
        var (nextStatus, nextBody) = await PostTransitionAsync(_client, id, "Assigned");
        nextStatus.Should().Be(HttpStatusCode.OK);
        nextBody.GetProperty("fromStatus").GetString().Should().Be("Pending");
    }

    [Fact]
    public async Task AC5_Missing_unknown_toStatus_and_overlong_note_return_400()
    {
        var id = await SeedShipmentAsync(await SeedWarehouseAsync(), "Pending");

        var (missingStatus, missingBody) = await PostTransitionAsync(_client, id, null);
        missingStatus.Should().Be(HttpStatusCode.BadRequest);
        missingBody.GetProperty("errors").TryGetProperty("toStatus", out _).Should().BeTrue();

        var (unknownStatus, unknownBody) = await PostTransitionAsync(_client, id, "Flying");
        unknownStatus.Should().Be(HttpStatusCode.BadRequest);
        unknownBody.GetProperty("errors").TryGetProperty("toStatus", out _).Should().BeTrue();

        var longNote = new string('x', 501);
        var (noteStatus, noteBody) = await PostTransitionAsync(_client, id, "Assigned", longNote);
        noteStatus.Should().Be(HttpStatusCode.BadRequest);
        noteBody.GetProperty("errors").TryGetProperty("note", out _).Should().BeTrue();

        var (_, history) = await GetHistoryAsync(_client, id);
        history.GetProperty("totalCount").GetInt64().Should().Be(0, "rejected transitions are never recorded");
    }

    [Fact]
    public async Task AC6_Unknown_shipment_returns_404_on_both_endpoints()
    {
        var (postStatus, _) = await PostTransitionAsync(_client, 999999, "Assigned");
        postStatus.Should().Be(HttpStatusCode.NotFound);

        var (getStatus, _) = await GetHistoryAsync(_client, 999999);
        getStatus.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AC7_History_is_append_only_paged_and_ordered_oldest_to_newest()
    {
        var id = await SeedShipmentAsync(await SeedWarehouseAsync(), "Pending");
        await DriveAsync(id, "Assigned");
        await PostTransitionAsync(_client, id, "InTransit", "Loaded onto vehicle RT-8421-X");
        await DriveAsync(id, "Delayed");

        // A rejected attempt must never appear in the audit trail.
        await PostTransitionAsync(_client, id, "Cancelled");
        var (_, beforePaging) = await GetHistoryAsync(_client, id);
        beforePaging.GetProperty("totalCount").GetInt64().Should().Be(3);

        var (_, page1) = await GetHistoryAsync(_client, id, "?page=1&pageSize=2");
        page1.GetProperty("page").GetInt32().Should().Be(1);
        page1.GetProperty("pageSize").GetInt32().Should().Be(2);
        page1.GetProperty("totalPages").GetInt32().Should().Be(2);
        var firstPageItems = page1.GetProperty("items");
        firstPageItems.GetArrayLength().Should().Be(2);
        firstPageItems[0].GetProperty("toStatus").GetString().Should().Be("Assigned");
        firstPageItems[0].GetProperty("fromStatus").GetString().Should().Be("Pending");
        firstPageItems[1].GetProperty("toStatus").GetString().Should().Be("InTransit");
        firstPageItems[1].GetProperty("note").GetString().Should().Be("Loaded onto vehicle RT-8421-X");

        var (_, page2) = await GetHistoryAsync(_client, id, "?page=2&pageSize=2");
        page2.GetProperty("items")[0].GetProperty("toStatus").GetString().Should().Be("Delayed");
    }

    [Fact]
    public async Task AC8_Anonymous_gets_401_Viewer_403_on_POST_200_on_GET_Driver_and_Dispatcher_2xx()
    {
        var id = await SeedShipmentAsync(await SeedWarehouseAsync(), "Pending");

        var anonymous = _factory.CreateClient();
        (await PostTransitionAsync(anonymous, id, "Assigned")).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await GetHistoryAsync(anonymous, id)).Status.Should().Be(HttpStatusCode.Unauthorized);
        anonymous.Dispose();

        var viewer = _factory.CreateClient();
        await viewer.SignInAsync(Roles.Viewer);
        (await PostTransitionAsync(viewer, id, "Assigned")).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetHistoryAsync(viewer, id)).Status.Should().Be(HttpStatusCode.OK);
        viewer.Dispose();

        var driver = _factory.CreateClient();
        await driver.SignInAsync(Roles.Driver);
        (await PostTransitionAsync(driver, id, "Assigned")).Status
            .Should().Be(HttpStatusCode.OK, "Driver is in the contract x-roles; own-route scoping lands with LOGI-0009/0010");
        (await GetHistoryAsync(driver, id)).Status.Should().Be(HttpStatusCode.OK);
        driver.Dispose();

        var dispatcher = _factory.CreateClient();
        await dispatcher.SignInAsync(Roles.Dispatcher);
        (await PostTransitionAsync(dispatcher, id, "InTransit")).Status.Should().Be(HttpStatusCode.OK);
        (await GetHistoryAsync(dispatcher, id)).Status.Should().Be(HttpStatusCode.OK);
        dispatcher.Dispose();
    }
}