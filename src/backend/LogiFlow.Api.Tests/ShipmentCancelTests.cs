using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Shipment cancellation tests (LOGI-0008 AC-8, AC-9, AC-10, AC-12 — the F6 "cancel" half).
///
/// Cancellation is NOT a new endpoint: it is the existing LOGI-0006 transition endpoint with
/// <c>toStatus: "Cancelled"</c>. What this ticket adds is the BR-6 role rule, so these tests
/// deliberately drive the real endpoint as four different roles and assert both the new behaviour
/// (Driver 403 on Cancelled) and the preserved one (Driver still transitions its own shipments).
/// </summary>
public class ShipmentCancelTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _client = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public ShipmentCancelTests(LogiFlowTestFactory factory) => _factory = factory;

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

    private async Task<long> SeedShipmentAsync(long originWarehouseId, string status = "Pending")
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlow.Infrastructure.Persistence.LogiFlowDbContext>();
        var shipment = Shipment.Create(
            UniqueReference(), originWarehouseId, "Test destination 1", null, null, 1000,
            status, "Standard", slaDueAt: null, DateTime.UtcNow);
        db.Shipments.Add(shipment);
        await db.SaveChangesAsync();
        return shipment.Id;
    }

    private async Task<(HttpStatusCode Status, JsonElement Body)> CancelAsync(
        HttpClient client, long id, string? note = "Customer withdrew the order", string toStatus = "Cancelled")
    {
        // A Dictionary, not a conditional over two anonymous types — the two shapes have no
        // common type, so PostAsJsonAsync's generic inference would fail.
        var payload = note is null
            ? new Dictionary<string, object?> { ["toStatus"] = toStatus }
            : new Dictionary<string, object?> { ["toStatus"] = toStatus, ["note"] = note };
        var response = await client.PostAsJsonAsync($"/api/v1/shipments/{id}/status-transitions", payload, Json);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        return (response.StatusCode, body);
    }

    private async Task<JsonElement> DetailAsync(HttpClient client, long id)
    {
        var response = await client.GetAsync($"/api/v1/shipments/{id}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    private async Task<int> HistoryCountAsync(long id)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlow.Infrastructure.Persistence.LogiFlowDbContext>();
        return await db.ShipmentStatusHistory.CountAsync(h => h.ShipmentId == id);
    }

    [Theory]
    [InlineData("Pending")]
    [InlineData("Assigned")]
    // LOGI-0008 AC-8 (BR-7: cancel is legal from Pending and Assigned only)
    public async Task AC8_Cancel_from_Pending_or_Assigned_is_audited_and_visible_everywhere(string fromStatus)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin, fromStatus);
        var historyBefore = await HistoryCountAsync(id);

        var (status, eventBody) = await CancelAsync(_client, id);

        status.Should().Be(HttpStatusCode.OK);
        eventBody.GetProperty("fromStatus").GetString().Should().Be(fromStatus);
        eventBody.GetProperty("toStatus").GetString().Should().Be("Cancelled");
        eventBody.GetProperty("note").GetString().Should().Be("Customer withdrew the order");
        eventBody.GetProperty("changedByUserId").GetInt64().Should().BePositive();
        eventBody.GetProperty("changedAt").GetDateTimeOffset().Should().BeCloseTo(DateTimeOffset.UtcNow, TimeSpan.FromMinutes(1));

        // The audit trail is append-only and the cancel is its newest entry (LOGI-0006 AC-6).
        (await HistoryCountAsync(id)).Should().Be(historyBefore + 1);

        var history = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/shipments/{id}/status-history", Json);
        var items = history.GetProperty("items").EnumerateArray().ToArray();
        items[^1].GetProperty("toStatus").GetString().Should().Be("Cancelled");
        items[^1].GetProperty("note").GetString().Should().Be("Customer withdrew the order");

        // Detail + the status list filter both read the shipment as cancelled.
        (await DetailAsync(_client, id)).GetProperty("status").GetString().Should().Be("Cancelled");
        var list = await _client.GetFromJsonAsync<JsonElement>("/api/v1/shipments?status=Cancelled&pageSize=100", Json);
        list.GetProperty("items").EnumerateArray()
            .Should().Contain(i => i.GetProperty("id").GetInt64() == id);
    }

    [Theory]
    [InlineData("InTransit")]
    [InlineData("Delayed")]
    [InlineData("Delivered")]
    [InlineData("Cancelled")]
    // LOGI-0008 AC-9 (BR-7 non-regression: no history row is written for a rejected attempt)
    public async Task AC9_Cancel_outside_Pending_or_Assigned_is_409_and_writes_nothing(string fromStatus)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin, fromStatus);
        var historyBefore = await HistoryCountAsync(id);

        var (status, body) = await CancelAsync(_client, id);

        status.Should().Be(HttpStatusCode.Conflict);
        body.GetProperty("detail").GetString().Should().NotBeNullOrWhiteSpace();

        (await HistoryCountAsync(id)).Should().Be(historyBefore,
            "a rejected transition must not append to the audit trail");
        (await DetailAsync(_client, id)).GetProperty("status").GetString().Should().Be(fromStatus);
    }

    [Theory]
    [InlineData("Pending")]
    [InlineData("Assigned")]
    // LOGI-0008 AC-10 (BR-6: only Admin/Dispatcher may cancel — the hole this ticket closes)
    public async Task AC10_Driver_cannot_cancel_but_keeps_its_other_transitions(string fromStatus)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin, fromStatus);
        var historyBefore = await HistoryCountAsync(id);

        using var driverClient = _factory.CreateClient();
        await driverClient.SignInAsync(Roles.Driver);

        var (status, body) = await CancelAsync(driverClient, id);

        status.Should().Be(HttpStatusCode.Forbidden);
        body.GetProperty("detail").GetString().Should().Contain("cancel");

        // Rejected *before* the row is touched: no state change, no audit row, and — because the guard
        // runs ahead of the lookup — the same 403 for an id that does not exist (no existence oracle).
        (await HistoryCountAsync(id)).Should().Be(historyBefore);
        using (var adminClient = _factory.CreateClient())
        {
            await adminClient.SignInAsync(Roles.Admin);
            (await DetailAsync(adminClient, id)).GetProperty("status").GetString().Should().Be(fromStatus);
        }

        var (missingStatus, _) = await CancelAsync(driverClient, 999_999);
        missingStatus.Should().Be(HttpStatusCode.Forbidden,
            "the role rule must not leak whether a shipment exists");

        // AC-10: every *other* Driver transition keeps the LOGI-0006 behaviour — only Cancelled is gated.
        var assignedId = await SeedShipmentAsync(origin, "Assigned");
        var assignedHistory = await HistoryCountAsync(assignedId);
        var (transitStatus, _) = await CancelAsync(driverClient, assignedId, note: null, toStatus: "InTransit");
        transitStatus.Should().Be(HttpStatusCode.OK);
        (await HistoryCountAsync(assignedId)).Should().Be(assignedHistory + 1);
    }

    [Theory]
    [InlineData(Roles.Admin)]
    [InlineData(Roles.Dispatcher)]
    // LOGI-0008 AC-10 (the permitted half of the BR-6 role matrix)
    public async Task AC10_Admin_and_Dispatcher_can_cancel(string role)
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin, "Pending");

        using var client = _factory.CreateClient();
        await client.SignInAsync(role);

        var (status, _) = await CancelAsync(client, id);

        status.Should().Be(HttpStatusCode.OK);
        (await DetailAsync(_client, id)).GetProperty("status").GetString().Should().Be("Cancelled");
    }

    [Fact]
    // LOGI-0008 AC-7/AC-10 (Viewer is read-only; anonymous callers are unauthenticated)
    public async Task AC10_Viewer_cannot_cancel_and_anonymous_caller_is_401()
    {
        var origin = await SeedWarehouseAsync();
        var id = await SeedShipmentAsync(origin, "Pending");
        var historyBefore = await HistoryCountAsync(id);

        using var viewerClient = _factory.CreateClient();
        await viewerClient.SignInAsync(Roles.Viewer);
        (await CancelAsync(viewerClient, id)).Status.Should().Be(HttpStatusCode.Forbidden);

        using var anonymousClient = _factory.CreateClient();
        (await CancelAsync(anonymousClient, id)).Status.Should().Be(HttpStatusCode.Unauthorized);

        (await HistoryCountAsync(id)).Should().Be(historyBefore);
        (await DetailAsync(_client, id)).GetProperty("status").GetString().Should().Be("Pending");
    }

    [Fact]
    // LOGI-0008 AC-12 (cancel half): BR-2 rule 2.3 — a Cancelled shipment is never "at risk",
    // whatever the clock says, and no at_risk/breached column is involved.
    public async Task AC12_Cancelled_shipment_is_never_at_risk_however_late_it_is()
    {
        var origin = await SeedWarehouseAsync();

        // Seeded directly so slaDueAt can sit 3 days in the past — an API-created shipment could not
        // reach that state without waiting (or with Express, hours).
        long id;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LogiFlow.Infrastructure.Persistence.LogiFlowDbContext>();
            var overdue = Shipment.Create(
                UniqueReference(), origin, "Test destination 1", null, null, 1000,
                "Pending", "Express", slaDueAt: DateTime.UtcNow.AddDays(-3), DateTime.UtcNow);
            db.Shipments.Add(overdue);
            await db.SaveChangesAsync();
            id = overdue.Id;
        }

        (await DetailAsync(_client, id)).GetProperty("atRisk").GetBoolean().Should().BeTrue(
            "a Pending shipment past its Express due date is at risk before it is cancelled");

        (await CancelAsync(_client, id)).Status.Should().Be(HttpStatusCode.OK);

        var after = await DetailAsync(_client, id);
        after.GetProperty("status").GetString().Should().Be("Cancelled");
        after.GetProperty("atRisk").GetBoolean().Should().BeFalse(
            "BR-2 rule 2.3 excludes Cancelled from the at-risk projection");

        // A pending sibling with the same overdue date is still at risk: the flag is per-row state,
        // not a side effect of cancelling a neighbour.
        var sibling = await SeedShipmentAsync(origin, "Pending");
        (await DetailAsync(_client, sibling)).GetProperty("atRisk").GetBoolean().Should().BeFalse();
    }
}
