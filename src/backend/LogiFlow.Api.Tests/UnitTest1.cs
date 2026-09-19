using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain.Security;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Integration tests for the warehouse CRUD endpoints (LOGI-0001 ACs).
///
/// Since LOGI-0003 these endpoints enforce the contract's x-roles, so the suite signs in as the
/// seeded Admin — the only role permitted the full create/read/update/delete set. Role-restricted
/// behaviour (401 without a token, 403 for a disallowed role) is asserted in
/// <see cref="AuthEndpointsTests"/> rather than duplicated here.
/// </summary>
public class WarehouseEndpointsTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _client = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public WarehouseEndpointsTests(LogiFlowTestFactory factory) => _factory = factory;

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

    private async Task<long> CreateWarehouseAsync(string name = "Central DC", string address = "12 Industrial Rd")
    {
        var response = await _client.PostAsJsonAsync("/api/v1/warehouses",
            new { name, address, latitude = 51.9, longitude = 4.5 }, Json);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        return body.GetProperty("id").GetInt64();
    }

    [Fact]
    public async Task Health_returns_ok()
    {
        var response = await _client.GetAsync("/api/v1/health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("status").GetString().Should().Be("ok");
        body.GetProperty("service").GetString().Should().Be("LogiFlow");
    }

    [Fact]
    public async Task AC1_Create_returns_201_with_id_and_createdAt_and_persists()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/warehouses",
            new { name = "West Hub", address = "1 Harbor Way" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location.Should().NotBeNull();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("id").GetInt64().Should().BeGreaterThan(0);
        body.GetProperty("name").GetString().Should().Be("West Hub");
        body.GetProperty("createdAt").GetDateTimeOffset().Should().BeOnOrBefore(DateTimeOffset.UtcNow);

        var fetched = await _client.GetAsync($"/api/v1/warehouses/{body.GetProperty("id").GetInt64()}");
        fetched.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AC2_Create_with_missing_name_returns_400_problem_details()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/warehouses",
            new { name = "", address = "1 Harbor Way" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("title").GetString().Should().Be("Validation failed");
        body.GetProperty("status").GetInt32().Should().Be(400);
        body.GetProperty("errors").GetProperty("name").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task AC3_Create_with_out_of_range_latitude_returns_400()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/warehouses",
            new { name = "Bad Coords", address = "1 Harbor Way", latitude = 95.0 }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("errors").TryGetProperty("latitude", out _).Should().BeTrue();
    }

    [Fact]
    public async Task AC4_List_is_paged_envelope()
    {
        for (var i = 1; i <= 12; i++)
        {
            await CreateWarehouseAsync($"Bulk {i:00}", $"{i} Bulk St");
        }

        var response = await _client.GetAsync("/api/v1/warehouses?page=2&pageSize=5");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);

        body.GetProperty("page").GetInt32().Should().Be(2);
        body.GetProperty("pageSize").GetInt32().Should().Be(5);
        body.GetProperty("totalPages").GetInt32().Should().BeGreaterThanOrEqualTo(3);
        body.GetProperty("items").GetArrayLength().Should().Be(5);
    }

    [Fact]
    public async Task AC4_List_rejects_pageSize_above_100()
    {
        var response = await _client.GetAsync("/api/v1/warehouses?page=1&pageSize=101");
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AC5_Get_by_id_returns_200_then_missing_returns_404()
    {
        var id = await CreateWarehouseAsync();

        var ok = await _client.GetAsync($"/api/v1/warehouses/{id}");
        ok.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ok.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("id").GetInt64().Should().Be(id);

        var missing = await _client.GetAsync("/api/v1/warehouses/999999");
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var problem = await missing.Content.ReadFromJsonAsync<JsonElement>(Json);
        problem.GetProperty("title").GetString().Should().Be("Resource not found");
    }

    [Fact]
    public async Task AC6_Update_returns_200_with_updated_fields_and_404_for_missing()
    {
        var id = await CreateWarehouseAsync();

        var update = await _client.PutAsJsonAsync($"/api/v1/warehouses/{id}",
            new { name = "Renamed DC", address = "99 New Ave" }, Json);
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await update.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("name").GetString().Should().Be("Renamed DC");
        body.GetProperty("address").GetString().Should().Be("99 New Ave");

        var missing = await _client.PutAsJsonAsync("/api/v1/warehouses/999999",
            new { name = "Ghost", address = "Nowhere" }, Json);
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AC7_Delete_returns_204_then_get_returns_404_and_missing_delete_returns_404()
    {
        var id = await CreateWarehouseAsync();

        var delete = await _client.DeleteAsync($"/api/v1/warehouses/{id}");
        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var after = await _client.GetAsync($"/api/v1/warehouses/{id}");
        after.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var missing = await _client.DeleteAsync("/api/v1/warehouses/999999");
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}

