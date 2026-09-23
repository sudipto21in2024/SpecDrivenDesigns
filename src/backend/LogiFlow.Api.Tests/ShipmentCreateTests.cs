using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using FluentAssertions;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>Create-shipment tests (LOGI-0007 AC-1..AC-5, AC-10 POST roles, AC-11 lifecycle seam).</summary>
public class ShipmentCreateTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _client = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public ShipmentCreateTests(LogiFlowTestFactory factory) => _factory = factory;

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

    private static string UniqueAddress() => $"Dest {Guid.NewGuid():N}"[..16];

    private async Task<long> SeedWarehouseAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/warehouses",
            new { name = $"WH {Guid.NewGuid():N}"[..12], address = "Test street 1", latitude = 52.0, longitude = 4.9 }, Json);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        return body.GetProperty("id").GetInt64();
    }

    private async Task<(HttpStatusCode Status, JsonElement Body)> PostAsync(HttpClient client, object payload)
    {
        var response = await client.PostAsJsonAsync("/api/v1/shipments", payload, Json);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        return (response.StatusCode, body);
    }

    private async Task<long> ListTotalAsync()
    {
        var body = await _client.GetFromJsonAsync<JsonElement>("/api/v1/shipments", Json);
        return body.GetProperty("totalCount").GetInt64();
    }

    private static string ErrorText(JsonElement body, string field) =>
        string.Join(" ", body.GetProperty("errors").GetProperty(field).EnumerateArray().Select(e => e.GetString()));

    /// <summary>The caller's user id (sub claim) — AC-1/AC-11 assert changedByUserId = creator.</summary>
    private static long SubFrom(HttpClient client)
    {
        var token = client.DefaultRequestHeaders.Authorization!.Parameter!;
        var payload = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
        payload += payload.Length % 4 == 0 ? "" : new string('=', 4 - payload.Length % 4);
        using var doc = JsonDocument.Parse(Convert.FromBase64String(payload));
        var sub = doc.RootElement.GetProperty("sub");
        return long.Parse(sub.ValueKind == JsonValueKind.String ? sub.GetString()! : sub.GetRawText());
    }

    [Fact]
    public async Task AC1_Dispatcher_creates_shipment_with_initial_audit_row_and_list_visibility()
    {
        var warehouseId = await SeedWarehouseAsync();
        var before = DateTimeOffset.UtcNow;
        var (status, body) = await PostAsync(_client, new
        {
            originWarehouseId = warehouseId,
            destinationAddress = "12 Dock Road, Rotterdam",
            weightKg = 1250.5,
            priority = "Express",
        });

        status.Should().Be(HttpStatusCode.Created);
        var id = body.GetProperty("id").GetInt64();
        id.Should().BeGreaterThan(0);
        Regex.IsMatch(body.GetProperty("referenceCode").GetString()!, @"^SHP-[0-9]{6}$").Should().BeTrue();
        body.GetProperty("status").GetString().Should().Be("Pending");
        body.GetProperty("priority").GetString().Should().Be("Express");
        body.GetProperty("weightKg").GetDouble().Should().Be(1250.5);
        body.GetProperty("destinationAddress").GetString().Should().Be("12 Dock Road, Rotterdam");
        body.GetProperty("atRisk").GetBoolean().Should().BeFalse();

        var createdAt = body.GetProperty("createdAt").GetDateTimeOffset();
        createdAt.Should().BeOnOrBefore(DateTimeOffset.UtcNow).And.BeOnOrAfter(before.AddSeconds(-1));
        body.GetProperty("updatedAt").GetDateTimeOffset().Should().BeOnOrAfter(before.AddSeconds(-1));
        (body.GetProperty("slaDueAt").GetDateTimeOffset() - createdAt).Should().Be(TimeSpan.FromHours(12));

        // Exactly one initial history row: fromStatus null, changedBy me, changedAt = createdAt.
        var history = await _client.GetFromJsonAsync<JsonElement>($"/api/v1/shipments/{id}/status-history", Json);
        history.GetProperty("totalCount").GetInt64().Should().Be(1);
        var initial = history.GetProperty("items")[0];
        initial.GetProperty("fromStatus").ValueKind.Should().Be(JsonValueKind.Null);
        initial.GetProperty("toStatus").GetString().Should().Be("Pending");
        initial.GetProperty("changedByUserId").GetInt64().Should().Be(SubFrom(_client));
        initial.GetProperty("changedAt").GetDateTimeOffset().Should().Be(createdAt);

        // Visible in the list.
        var list = await _client.GetFromJsonAsync<JsonElement>("/api/v1/shipments", Json);
        list.GetProperty("items").EnumerateArray().Any(i => i.GetProperty("id").GetInt64() == id).Should().BeTrue();
    }

    [Fact]
    public async Task AC2_due_date_is_server_anchored_and_server_fields_sent_by_the_client_are_ignored()
    {
        var wh = await SeedWarehouseAsync();
        var before = DateTimeOffset.UtcNow;
        var (status, body) = await PostAsync(_client, new
        {
            originWarehouseId = wh,
            destinationAddress = UniqueAddress(),
            weightKg = 1.5,
            priority = "Standard",
            // Hostile client values for server-owned fields — all ignored (BR-1 rule 1.2 / AC-2).
            id = 12345,
            referenceCode = "SHP-999999",
            status = "Delivered",
            createdAt = "2020-01-01T00:00:00Z",
            slaDueAt = "2020-01-02T00:00:00Z",
            updatedAt = "2020-01-03T00:00:00Z",
        });

        status.Should().Be(HttpStatusCode.Created);
        body.GetProperty("status").GetString().Should().Be("Pending");
        var code = body.GetProperty("referenceCode").GetString();
        Regex.IsMatch(code!, @"^SHP-[0-9]{6}$").Should().BeTrue();
        code.Should().NotBe("SHP-999999");
        body.GetProperty("id").GetInt64().Should().NotBe(12345);
        var createdAt = body.GetProperty("createdAt").GetDateTimeOffset();
        createdAt.Should().BeOnOrAfter(before.AddSeconds(-1), "createdAt is the server instant");
        (body.GetProperty("updatedAt").GetDateTimeOffset() - createdAt).Should().Be(TimeSpan.Zero);
        // Standard: sla_due_at = created_at + 48h exactly (whole-second storage, AC-2 / rule 1.4).
        (body.GetProperty("slaDueAt").GetDateTimeOffset() - createdAt).Should().Be(TimeSpan.FromHours(48));
    }

    [Fact]
    public async Task AC3_priority_defaults_to_Standard_and_unknown_or_empty_priority_fails_loudly()
    {
        var wh = await SeedWarehouseAsync();
        var before = await ListTotalAsync();

        var (created, body) = await PostAsync(_client, new { originWarehouseId = wh, destinationAddress = UniqueAddress(), weightKg = 10 });
        created.Should().Be(HttpStatusCode.Created, "omitted priority is valid and defaults");
        body.GetProperty("priority").GetString().Should().Be("Standard");
        (body.GetProperty("slaDueAt").GetDateTimeOffset() - body.GetProperty("createdAt").GetDateTimeOffset())
            .Should().Be(TimeSpan.FromHours(48));

        var (unknown, unknownBody) = await PostAsync(_client, new { originWarehouseId = wh, destinationAddress = UniqueAddress(), weightKg = 10, priority = "Overnight" });
        unknown.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(unknownBody, "priority").Should().Contain("Standard").And.Contain("Express");

        var (empty, emptyBody) = await PostAsync(_client, new { originWarehouseId = wh, destinationAddress = UniqueAddress(), weightKg = 10, priority = "" });
        empty.Should().Be(HttpStatusCode.BadRequest, "an explicit empty priority fails loudly (rule 1.7)");
        ErrorText(emptyBody, "priority").Should().Contain("Standard");

        (await ListTotalAsync()).Should().Be(before + 1, "400 responses must not write a shipment row");
    }

    [Fact]
    public async Task AC4_validation_failures_return_field_keyed_400_and_write_neither_row()
    {
        var wh = await SeedWarehouseAsync();
        var before = await ListTotalAsync();

        var missingWeight = await PostAsync(_client, new { originWarehouseId = wh, destinationAddress = UniqueAddress() });
        missingWeight.Status.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(missingWeight.Body, "weightKg").Should().NotBeNullOrWhiteSpace();

        foreach (var weightKg in new double[] { 0, -5 })
        {
            var (status, body) = await PostAsync(_client, new { originWarehouseId = wh, destinationAddress = UniqueAddress(), weightKg });
            status.Should().Be(HttpStatusCode.BadRequest);
            ErrorText(body, "weightKg").Should().NotBeNullOrWhiteSpace();
        }

        foreach (var destinationAddress in new string?[] { "   ", null })
        {
            var (status, body) = await PostAsync(_client, new { originWarehouseId = wh, destinationAddress, weightKg = 10 });
            status.Should().Be(HttpStatusCode.BadRequest);
            ErrorText(body, "destinationAddress").Should().NotBeNullOrWhiteSpace();
        }

        var unknownWarehouse = await PostAsync(_client, new { originWarehouseId = 999999999, destinationAddress = UniqueAddress(), weightKg = 10 });
        unknownWarehouse.Status.Should().Be(HttpStatusCode.BadRequest);
        ErrorText(unknownWarehouse.Body, "originWarehouseId").Should().Contain("does not exist");

        (await ListTotalAsync()).Should().Be(before, "neither row may be written for a rejected create");
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        (await db.ShipmentStatusHistory.CountAsync(h => h.ShipmentId == 0))
            .Should().Be(0, "no orphan audit row may exist without its shipment");
    }

    [Fact]
    public async Task AC5_concurrent_creates_yield_distinct_well_formed_reference_codes()
    {
        var wh = await SeedWarehouseAsync();
        var tasks = Enumerable.Range(0, 6)
            .Select(_ => PostAsync(_client, new { originWarehouseId = wh, destinationAddress = UniqueAddress(), weightKg = 5 }));
        var results = await Task.WhenAll(tasks);

        results.Should().OnlyContain(r => r.Status == HttpStatusCode.Created);
        var codes = results.Select(r => r.Body.GetProperty("referenceCode").GetString()!).ToArray();
        codes.Should().OnlyContain(c => Regex.IsMatch(c, @"^SHP-[0-9]{6}$"));
        codes.Distinct().Should().HaveCount(codes.Length, "every concurrent create gets its own code");
    }

    [Fact]
    public async Task AC5_reference_code_retry_budget_exhaustion_returns_409()
    {
        var wh = await SeedWarehouseAsync();

        // Deterministic collision: seed a row carrying exactly the code the handler will compute
        // next (max(id)+2 while max(id) itself advances to max+1), so every retry attempt hits
        // the unique index and the bounded budget runs out.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var maxId = await db.Shipments.MaxAsync(s => (long?)s.Id) ?? 0;
        var collisionRow = Shipment.Create(
            $"SHP-{maxId + 2:D6}", wh, UniqueAddress(), null, null, 1, "Pending", "Standard", null, DateTime.UtcNow);
        db.Shipments.Add(collisionRow);
        await db.SaveChangesAsync();

        var before = await ListTotalAsync();
        var (status, body) = await PostAsync(_client, new { originWarehouseId = wh, destinationAddress = UniqueAddress(), weightKg = 5 });
        status.Should().Be(HttpStatusCode.Conflict, "an exhausted retry budget maps to 409, never a duplicate-key 500");
        body.GetProperty("title").GetString().Should().Be("Conflict");
        (await ListTotalAsync()).Should().Be(before, "the exhausted create wrote no shipment row");

        // Remove the poison row: its code is SHP-{id+1}, which would collide with EVERY subsequent
        // create candidate in this shared class database and permanently exhaust the retry budget.
        db.Shipments.Remove(collisionRow);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task AC10_POST_enforces_the_contract_role_matrix()
    {
        var wh = await SeedWarehouseAsync();
        var payload = new { originWarehouseId = wh, destinationAddress = UniqueAddress(), weightKg = 5 };

        var anon = _factory.CreateClient();
        (await anon.PostAsJsonAsync("/api/v1/shipments", payload, Json)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        foreach (var forbidden in new[] { Roles.Viewer, Roles.Driver })
        {
            using var client = _factory.CreateClient();
            await client.SignInAsync(forbidden);
            (await client.PostAsJsonAsync("/api/v1/shipments", payload, Json))
                .StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{forbidden} may not create shipments (BR-6)");
        }

        using var admin = _factory.CreateClient();
        await admin.SignInAsync(Roles.Admin);
        (await admin.PostAsJsonAsync("/api/v1/shipments", payload, Json)).StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task AC11_created_shipment_flows_through_the_LOGI_0006_lifecycle()
    {
        var wh = await SeedWarehouseAsync();
        var (status, body) = await PostAsync(_client, new { originWarehouseId = wh, destinationAddress = UniqueAddress(), weightKg = 10, priority = "Standard" });
        status.Should().Be(HttpStatusCode.Created);
        var id = body.GetProperty("id").GetInt64();
        var createdAt = body.GetProperty("createdAt").GetDateTimeOffset();

        var transition = await _client.PostAsJsonAsync($"/api/v1/shipments/{id}/status-transitions", new { toStatus = "Assigned" }, Json);
        transition.StatusCode.Should().Be(HttpStatusCode.OK, "the created Pending row satisfies the BR-7 state machine");

        var history = await _client.GetFromJsonAsync<JsonElement>($"/api/v1/shipments/{id}/status-history", Json);
        history.GetProperty("totalCount").GetInt64().Should().Be(2, "initial Pending row first, then Assigned");
        var initial = history.GetProperty("items")[0];
        initial.GetProperty("fromStatus").ValueKind.Should().Be(JsonValueKind.Null);
        initial.GetProperty("toStatus").GetString().Should().Be("Pending");
        initial.GetProperty("changedByUserId").GetInt64().Should().Be(SubFrom(_client));
        initial.GetProperty("changedAt").GetDateTimeOffset().Should().Be(createdAt, "the initial row shares the shipment instant");
        var assigned = history.GetProperty("items")[1];
        assigned.GetProperty("fromStatus").GetString().Should().Be("Pending");
        assigned.GetProperty("toStatus").GetString().Should().Be("Assigned");

        var list = await _client.GetFromJsonAsync<JsonElement>($"/api/v1/shipments?originWarehouseId={wh}", Json);
        list.GetProperty("items").EnumerateArray()
            .Single(i => i.GetProperty("id").GetInt64() == id).GetProperty("status").GetString().Should().Be("Assigned");
    }
}