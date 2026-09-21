using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain.Security;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Integration tests for the driver CRUD endpoints (LOGI-0005 AC-1 … AC-9).
/// Mirrors VehicleEndpointsTests: Admin client; 401/403 per AC-9; the user-link tests
/// (AC-5/AC-6) resolve a real seeded user id from the login response's user object instead of
/// hard-coding one (the spec's "user id 7" is illustrative).
/// </summary>
public class DriverEndpointsTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _client = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public DriverEndpointsTests(LogiFlowTestFactory factory) => _factory = factory;

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

    private static string UniqueLicense(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private static string UniqueName() => $"Driver-{Guid.NewGuid():N}";

    private async Task<JsonElement> CreateDriverAsync(
        string? fullName = null, string? license = null, string? phone = null, string? status = null, long? userId = null)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/drivers",
            new { fullName = fullName ?? UniqueName(), licenseNumber = license ?? UniqueLicense("DL"), phone, status, userId }, Json);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    private async Task<long> CountDriversAsync()
    {
        var body = await _client.GetFromJsonAsync<JsonElement>("/api/v1/drivers?page=1&pageSize=1", Json);
        return body.GetProperty("totalCount").GetInt64();
    }

    /// <summary>The seeded account id for a role, read from the login response's user object.</summary>
    private async Task<long> SeededUserIdAsync(string role)
    {
        using var client = _factory.CreateClient();
        var body = await client.SignInAsync(role);
        return body.GetProperty("user").GetProperty("id").GetInt64();
    }

    // ---------------------------------------------------------------- AC-1

    [Fact]
    public async Task AC1_Create_returns_201_with_id_and_Active_status_and_persists()
    {
        var name = UniqueName();
        var license = UniqueLicense("DL");
        var before = await CountDriversAsync();

        var response = await _client.PostAsJsonAsync("/api/v1/drivers",
            new { fullName = name, licenseNumber = license, phone = "+31 6 1234 5678" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location.Should().NotBeNull();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        var id = body.GetProperty("id").GetInt64();
        id.Should().BeGreaterThan(0);
        body.GetProperty("fullName").GetString().Should().Be(name);
        body.GetProperty("licenseNumber").GetString().Should().Be(license);
        body.GetProperty("phone").GetString().Should().Be("+31 6 1234 5678");
        body.GetProperty("status").GetString().Should().Be("Active");
        body.GetProperty("userId").ValueKind.Should().Be(JsonValueKind.Null);
        // The response deliberately carries no createdAt (schema §drivers has no created_at column).
        body.TryGetProperty("createdAt", out _).Should().BeFalse();

        (await CountDriversAsync()).Should().Be(before + 1, "the created driver must be listed");
        (await _client.GetAsync($"/api/v1/drivers/{id}")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // ---------------------------------------------------------------- AC-2

    [Fact]
    public async Task AC2_Create_with_empty_or_missing_fullName_returns_400_and_no_row()
    {
        var before = await CountDriversAsync();

        foreach (var fullName in new[] { "", "   " })
        {
            var response = await _client.PostAsJsonAsync("/api/v1/drivers",
                new { fullName, licenseNumber = UniqueLicense("DL") }, Json);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
            body.GetProperty("title").GetString().Should().Be("Validation failed");
            body.GetProperty("errors").TryGetProperty("fullName", out _).Should().BeTrue();
        }

        var missing = await _client.PostAsJsonAsync("/api/v1/drivers",
            new { licenseNumber = UniqueLicense("DL") }, Json);
        missing.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        (await CountDriversAsync()).Should().Be(before, "a rejected request must not create a row");
    }

    // ---------------------------------------------------------------- AC-3

    [Fact]
    public async Task AC3_Create_with_duplicate_license_returns_409_and_no_second_row()
    {
        var license = UniqueLicense("DUP");
        await CreateDriverAsync(license: license);

        var before = await CountDriversAsync();
        var response = await _client.PostAsJsonAsync("/api/v1/drivers",
            new { fullName = UniqueName(), licenseNumber = license }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("title").GetString().Should().Be("Conflict");
        body.GetProperty("status").GetInt32().Should().Be(409);

        (await CountDriversAsync()).Should().Be(before, "a rejected request must not create a row");
    }

    [Fact]
    public async Task AC3_Update_with_duplicate_license_returns_409_and_other_keeps_license()
    {
        var first = await CreateDriverAsync();
        var second = await CreateDriverAsync();
        var firstLicense = first.GetProperty("licenseNumber").GetString()!;
        var secondId = second.GetProperty("id").GetInt64();

        var response = await _client.PutAsJsonAsync($"/api/v1/drivers/{secondId}",
            new { fullName = second.GetProperty("fullName").GetString(), licenseNumber = firstLicense, status = "Active" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await _client.GetFromJsonAsync<JsonElement>($"/api/v1/drivers/{secondId}", Json))
            .GetProperty("licenseNumber").GetString().Should().Be(second.GetProperty("licenseNumber").GetString(),
                "the other driver keeps its license");
    }

    // ---------------------------------------------------------------- AC-4

    [Fact]
    public async Task AC4_Omitted_status_defaults_to_Active_and_bad_status_returns_400()
    {
        var defaulted = await CreateDriverAsync(); // no status sent
        defaulted.GetProperty("status").GetString().Should().Be("Active");

        var bad = await _client.PostAsJsonAsync("/api/v1/drivers",
            new { fullName = UniqueName(), licenseNumber = UniqueLicense("BS"), status = "Sleeping" }, Json);
        bad.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await bad.Content.ReadFromJsonAsync<JsonElement>(Json))
            .GetProperty("errors").TryGetProperty("status", out _).Should().BeTrue();
    }

    // ---------------------------------------------------------------- AC-5

    [Fact]
    public async Task AC5_Create_linked_to_a_seeded_user_echoes_userId()
    {
        var userId = await SeededUserIdAsync(Roles.Driver);
        var created = await CreateDriverAsync(userId: userId);

        created.GetProperty("userId").GetInt64().Should().Be(userId);
        (await _client.GetFromJsonAsync<JsonElement>($"/api/v1/drivers/{created.GetProperty("id").GetInt64()}", Json))
            .GetProperty("userId").GetInt64().Should().Be(userId);
    }

    // ---------------------------------------------------------------- AC-6

    [Fact]
    public async Task AC6_Nonexistent_userId_returns_400_and_no_row()
    {
        var before = await CountDriversAsync();
        var response = await _client.PostAsJsonAsync("/api/v1/drivers",
            new { fullName = UniqueName(), licenseNumber = UniqueLicense("U404"), userId = 999999 }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("errors").TryGetProperty("userId", out _).Should().BeTrue();
        (await CountDriversAsync()).Should().Be(before, "a rejected request must not create a row");
    }

    [Fact]
    public async Task AC6_User_already_linked_to_another_driver_returns_409_on_post_and_put()
    {
        var userId = await SeededUserIdAsync(Roles.Dispatcher);
        await CreateDriverAsync(userId: userId); // the driver that holds the link
        var other = await CreateDriverAsync();
        var otherId = other.GetProperty("id").GetInt64();

        var dupPost = await _client.PostAsJsonAsync("/api/v1/drivers",
            new { fullName = UniqueName(), licenseNumber = UniqueLicense("U1"), userId }, Json);
        dupPost.StatusCode.Should().Be(HttpStatusCode.Conflict);

        var dupPut = await _client.PutAsJsonAsync($"/api/v1/drivers/{otherId}",
            new
            {
                fullName = other.GetProperty("fullName").GetString(),
                licenseNumber = other.GetProperty("licenseNumber").GetString(),
                status = "Active",
                userId,
            }, Json);
        dupPut.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task AC6_Put_with_null_userId_clears_the_link()
    {
        var userId = await SeededUserIdAsync(Roles.Viewer);
        var linked = await CreateDriverAsync(userId: userId);
        var id = linked.GetProperty("id").GetInt64();

        var cleared = await _client.PutAsJsonAsync($"/api/v1/drivers/{id}",
            new
            {
                fullName = linked.GetProperty("fullName").GetString(),
                licenseNumber = linked.GetProperty("licenseNumber").GetString(),
                status = "Active",
                userId = (long?)null,
            }, Json);

        cleared.StatusCode.Should().Be(HttpStatusCode.OK);
        (await cleared.Content.ReadFromJsonAsync<JsonElement>(Json))
            .GetProperty("userId").ValueKind.Should().Be(JsonValueKind.Null);
        (await _client.GetFromJsonAsync<JsonElement>($"/api/v1/drivers/{id}", Json))
            .GetProperty("userId").ValueKind.Should().Be(JsonValueKind.Null);
    }

    // ---------------------------------------------------------------- AC-7

    [Fact]
    public async Task AC7_List_is_paged_and_filterable_by_q_and_status()
    {
        var marker = Guid.NewGuid().ToString("N")[..8];
        await CreateDriverAsync(fullName: $"Alpha {marker}", status: "Active");
        await CreateDriverAsync(fullName: $"Beta {marker}", status: "Suspended");

        var paged = await _client.GetAsync("/api/v1/drivers?page=1&pageSize=1");
        paged.StatusCode.Should().Be(HttpStatusCode.OK);
        var page = await paged.Content.ReadFromJsonAsync<JsonElement>(Json);
        page.GetProperty("page").GetInt32().Should().Be(1);
        page.GetProperty("pageSize").GetInt32().Should().Be(1);
        page.GetProperty("totalCount").GetInt64().Should().BeGreaterThanOrEqualTo(2);
        page.GetProperty("totalPages").GetInt32().Should().BeGreaterThanOrEqualTo(2);
        page.GetProperty("items").GetArrayLength().Should().BeLessThanOrEqualTo(1);

        var q = await _client.GetFromJsonAsync<JsonElement>($"/api/v1/drivers?page=1&pageSize=100&q={marker}", Json);
        q.GetProperty("totalCount").GetInt64().Should().Be(2, "q filters by full name contains, case-insensitive");
        foreach (var item in q.GetProperty("items").EnumerateArray())
        {
            item.GetProperty("fullName").GetString()!.ToLowerInvariant().Should().Contain(marker);
        }

        var suspended = await _client.GetFromJsonAsync<JsonElement>(
            "/api/v1/drivers?page=1&pageSize=100&status=Suspended", Json);
        foreach (var item in suspended.GetProperty("items").EnumerateArray())
        {
            item.GetProperty("status").GetString().Should().Be("Suspended");
        }

        var bad = await _client.GetAsync("/api/v1/drivers?page=1&pageSize=10&status=Flying");
        bad.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await bad.Content.ReadFromJsonAsync<JsonElement>(Json))
            .GetProperty("errors").TryGetProperty("status", out _).Should().BeTrue();
    }

    // ---------------------------------------------------------------- AC-8

    [Fact]
    public async Task AC8_Get_update_delete_roundtrip_with_404s()
    {
        var created = await CreateDriverAsync();
        var id = created.GetProperty("id").GetInt64();
        var license = created.GetProperty("licenseNumber").GetString()!;

        (await _client.GetAsync($"/api/v1/drivers/{id}")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await _client.GetAsync("/api/v1/drivers/999999")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        var update = await _client.PutAsJsonAsync($"/api/v1/drivers/{id}",
            new { fullName = "Renamed Driver", licenseNumber = license, phone = "+31 6 0000 0000", status = "OffDuty" }, Json);
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = await update.Content.ReadFromJsonAsync<JsonElement>(Json);
        updated.GetProperty("fullName").GetString().Should().Be("Renamed Driver");
        updated.GetProperty("status").GetString().Should().Be("OffDuty");

        var missingUpdate = await _client.PutAsJsonAsync("/api/v1/drivers/999999",
            new { fullName = "Ghost", licenseNumber = UniqueLicense("GH"), status = "Active" }, Json);
        missingUpdate.StatusCode.Should().Be(HttpStatusCode.NotFound);

        (await _client.DeleteAsync($"/api/v1/drivers/{id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _client.GetAsync($"/api/v1/drivers/{id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _client.DeleteAsync("/api/v1/drivers/999999")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ---------------------------------------------------------------- AC-9

    [Fact]
    public async Task AC9_Anonymous_is_401_and_role_matrix_is_enforced()
    {
        using var anon = _factory.CreateClient();
        (await anon.GetAsync("/api/v1/drivers")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await anon.GetAsync("/api/v1/drivers/1")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await anon.PostAsJsonAsync("/api/v1/drivers",
            new { fullName = "Anon", licenseNumber = UniqueLicense("AN") }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await anon.PutAsJsonAsync("/api/v1/drivers/1",
            new { fullName = "Anon", licenseNumber = UniqueLicense("AN") }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await anon.DeleteAsync("/api/v1/drivers/1")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Viewer: reads OK, writes 403, and a rejected write must not create a row.
        using var viewer = _factory.CreateClient();
        await viewer.SignInAsync(Roles.Viewer);
        (await viewer.GetAsync("/api/v1/drivers")).StatusCode.Should().Be(HttpStatusCode.OK);
        var before = await CountDriversAsync();
        (await viewer.PostAsJsonAsync("/api/v1/drivers",
            new { fullName = "Viewer Attempt", licenseNumber = UniqueLicense("VW") }, Json))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CountDriversAsync()).Should().Be(before, "a rejected request must not create a row");

        // Driver role: master data is not a driver-persona surface — 403 even on reads.
        using var driver = _factory.CreateClient();
        await driver.SignInAsync(Roles.Driver);
        (await driver.GetAsync("/api/v1/drivers")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await driver.GetAsync("/api/v1/drivers/1")).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // Dispatcher: GET/POST/PUT 2xx, DELETE 403.
        using var dispatcher = _factory.CreateClient();
        await dispatcher.SignInAsync(Roles.Dispatcher);
        (await dispatcher.GetAsync("/api/v1/drivers")).StatusCode.Should().Be(HttpStatusCode.OK);
        var created = await dispatcher.PostAsJsonAsync("/api/v1/drivers",
            new { fullName = "Dispatcher Created", licenseNumber = UniqueLicense("DP") }, Json);
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var createdBody = await created.Content.ReadFromJsonAsync<JsonElement>(Json);
        var dispatcherDriverId = createdBody.GetProperty("id").GetInt64();
        (await dispatcher.PutAsJsonAsync($"/api/v1/drivers/{dispatcherDriverId}",
            new
            {
                fullName = "Dispatcher Updated",
                licenseNumber = createdBody.GetProperty("licenseNumber").GetString(),
                status = "Active",
            }, Json))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await dispatcher.DeleteAsync($"/api/v1/drivers/{dispatcherDriverId}"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // Admin: delete succeeds.
        (await _client.DeleteAsync($"/api/v1/drivers/{dispatcherDriverId}"))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
    }
}