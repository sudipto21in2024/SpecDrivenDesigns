using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain.Security;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Integration tests for the vehicle CRUD endpoints (LOGI-0004 AC-1 … AC-9).
/// Mirrors WarehouseEndpointsTests: Admin client; 401/403 spot-checked per AC-9.
/// </summary>
public class VehicleEndpointsTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _client = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public VehicleEndpointsTests(LogiFlowTestFactory factory) => _factory = factory;

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

    private static string UniquePlate(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private async Task<JsonElement> CreateVehicleAsync(
        string? plate = null, string type = "Truck", double capacityKg = 12000, string? status = "Available")
    {
        var response = await _client.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = plate ?? UniquePlate("RT"), type, capacityKg, status }, Json);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    private async Task<long> CountVehiclesAsync()
    {
        var body = await _client.GetFromJsonAsync<JsonElement>("/api/v1/vehicles?page=1&pageSize=1", Json);
        return body.GetProperty("totalCount").GetInt64();
    }

    [Fact]
    public async Task AC1_Create_returns_201_with_id_and_createdAt_and_persists()
    {
        var plate = UniquePlate("RT");
        var response = await _client.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = plate, type = "Truck", capacityKg = 12000, status = "Available" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location.Should().NotBeNull();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("id").GetInt64().Should().BeGreaterThan(0);
        body.GetProperty("plateNumber").GetString().Should().Be(plate);
        body.GetProperty("status").GetString().Should().Be("Available");
        body.GetProperty("createdAt").GetDateTimeOffset().Should().BeOnOrBefore(DateTimeOffset.UtcNow);

        var fetched = await _client.GetAsync($"/api/v1/vehicles/{body.GetProperty("id").GetInt64()}");
        fetched.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AC2_Create_with_empty_plate_returns_400_problem_details()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = "", type = "Truck", capacityKg = 12000, status = "Available" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("title").GetString().Should().Be("Validation failed");
        body.GetProperty("errors").TryGetProperty("plateNumber", out _).Should().BeTrue();
    }

    [Fact]
    public async Task AC3_Create_with_duplicate_plate_returns_409_and_no_second_row()
    {
        var plate = UniquePlate("DUP");
        await CreateVehicleAsync(plate);

        var before = await CountVehiclesAsync();
        var response = await _client.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = plate, type = "Van", capacityKg = 500, status = "Available" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("title").GetString().Should().Be("Conflict");
        body.GetProperty("status").GetInt32().Should().Be(409);

        (await CountVehiclesAsync()).Should().Be(before, "a rejected request must not create a row");
    }

    [Fact]
    public async Task AC3_Update_with_duplicate_plate_returns_409()
    {
        var first = await CreateVehicleAsync();
        var second = await CreateVehicleAsync();
        var firstPlate = first.GetProperty("plateNumber").GetString()!;
        var secondId = second.GetProperty("id").GetInt64();

        var response = await _client.PutAsJsonAsync($"/api/v1/vehicles/{secondId}",
            new { plateNumber = firstPlate, type = "Truck", capacityKg = 12000, status = "Available" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }


    [Fact]
    public async Task AC4_Create_with_unknown_type_returns_400()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = UniquePlate("SP"), type = "Spaceship", capacityKg = 12000, status = "Available" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("errors").TryGetProperty("type", out _).Should().BeTrue();
    }

    [Fact]
    public async Task AC5_Create_with_non_positive_capacity_returns_400()
    {
        foreach (var capacity in new[] { 0.0, -5.0 })
        {
            var response = await _client.PostAsJsonAsync("/api/v1/vehicles",
                new { plateNumber = UniquePlate("CP"), type = "Truck", capacityKg = capacity, status = "Available" }, Json);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
            body.GetProperty("errors").TryGetProperty("capacityKg", out _).Should().BeTrue();
        }
    }

    [Fact]
    public async Task AC6_Omitted_status_defaults_to_Available_and_bad_status_returns_400()
    {
        var defaulted = await _client.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = UniquePlate("DF"), type = "Van", capacityKg = 800 }, Json);
        defaulted.StatusCode.Should().Be(HttpStatusCode.Created);
        (await defaulted.Content.ReadFromJsonAsync<JsonElement>(Json))
            .GetProperty("status").GetString().Should().Be("Available");

        var bad = await _client.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = UniquePlate("BS"), type = "Van", capacityKg = 800, status = "Flying" }, Json);
        bad.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await bad.Content.ReadFromJsonAsync<JsonElement>(Json))
            .GetProperty("errors").TryGetProperty("status", out _).Should().BeTrue();
    }


    [Fact]
    public async Task AC7_List_is_paged_and_filterable_by_status_and_type()
    {
        await CreateVehicleAsync(type: "Truck", status: "Available");
        await CreateVehicleAsync(type: "Van", status: "Maintenance");

        var paged = await _client.GetAsync("/api/v1/vehicles?page=1&pageSize=2");
        paged.StatusCode.Should().Be(HttpStatusCode.OK);
        var page = await paged.Content.ReadFromJsonAsync<JsonElement>(Json);
        page.GetProperty("page").GetInt32().Should().Be(1);
        page.GetProperty("pageSize").GetInt32().Should().Be(2);
        page.GetProperty("totalCount").GetInt64().Should().BeGreaterThanOrEqualTo(2);
        page.GetProperty("totalPages").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        page.GetProperty("items").GetArrayLength().Should().BeLessThanOrEqualTo(2);

        var filtered = await _client.GetFromJsonAsync<JsonElement>(
            "/api/v1/vehicles?page=1&pageSize=100&status=Available&type=Truck", Json);
        foreach (var item in filtered.GetProperty("items").EnumerateArray())
        {
            item.GetProperty("status").GetString().Should().Be("Available");
            item.GetProperty("type").GetString().Should().Be("Truck");
        }
    }


    [Fact]
    public async Task AC8_Get_update_delete_roundtrip_with_404s()
    {
        var created = await CreateVehicleAsync();
        var id = created.GetProperty("id").GetInt64();

        (await _client.GetAsync($"/api/v1/vehicles/{id}")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await _client.GetAsync("/api/v1/vehicles/999999")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        var plate = created.GetProperty("plateNumber").GetString();
        var update = await _client.PutAsJsonAsync($"/api/v1/vehicles/{id}",
            new { plateNumber = plate, type = "Trailer", capacityKg = 20000, status = "Maintenance" }, Json);
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        (await update.Content.ReadFromJsonAsync<JsonElement>(Json))
            .GetProperty("type").GetString().Should().Be("Trailer");

        var missingUpdate = await _client.PutAsJsonAsync("/api/v1/vehicles/999999",
            new { plateNumber = UniquePlate("GH"), type = "Van", capacityKg = 500, status = "Available" }, Json);
        missingUpdate.StatusCode.Should().Be(HttpStatusCode.NotFound);

        (await _client.DeleteAsync($"/api/v1/vehicles/{id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _client.GetAsync($"/api/v1/vehicles/{id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _client.DeleteAsync("/api/v1/vehicles/999999")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AC9_Anonymous_is_401_and_role_matrix_is_enforced()
    {
        using var anon = _factory.CreateClient();
        (await anon.GetAsync("/api/v1/vehicles")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await anon.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = UniquePlate("AN"), type = "Van", capacityKg = 500, status = "Available" }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        using var viewer = _factory.CreateClient();
        await viewer.SignInAsync(Roles.Viewer);
        (await viewer.GetAsync("/api/v1/vehicles")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await viewer.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = UniquePlate("VW"), type = "Van", capacityKg = 500, status = "Available" }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        using var dispatcher = _factory.CreateClient();
        await dispatcher.SignInAsync(Roles.Dispatcher);
        var created = await dispatcher.PostAsJsonAsync("/api/v1/vehicles",
            new { plateNumber = UniquePlate("DP"), type = "Van", capacityKg = 500, status = "Available" }, Json);
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var dispatcherId = (await created.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("id").GetInt64();
        (await dispatcher.DeleteAsync($"/api/v1/vehicles/{dispatcherId}")).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        (await _client.DeleteAsync($"/api/v1/vehicles/{dispatcherId}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
    }
}
