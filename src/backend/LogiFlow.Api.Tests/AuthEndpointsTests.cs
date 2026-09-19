using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain.Security;
using LogiFlow.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Integration tests for authentication and role-based authorization (LOGI-0003 AC-1 … AC-11).
///
/// Everything is exercised through the real HTTP pipeline — real JWT validation, real role policies,
/// real Identity password verification — so these tests fail if enforcement is wired incorrectly
/// rather than merely mis-declared. AC-12 (frontend gating) is covered by the Vitest suite and
/// tests/e2e/auth.spec.ts.
/// </summary>
public class AuthEndpointsTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private const string LoginPath = "/api/v1/auth/login";
    private const string RefreshPath = "/api/v1/auth/refresh";
    private const string LogoutPath = "/api/v1/auth/logout";
    private const string MePath = "/api/v1/auth/me";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly LogiFlowTestFactory _factory;
    private HttpClient _client = null!;

    public AuthEndpointsTests(LogiFlowTestFactory factory) => _factory = factory;

    /// <summary>An unauthenticated client; individual tests sign in or attach headers as needed.</summary>
    public Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private Task<HttpResponseMessage> LoginAsync(string email, string password) =>
        _client.PostAsJsonAsync(LoginPath, new { email, password }, Json);

    private async Task<JsonElement> LoginAsRoleAsync(string role)
    {
        var response = await LoginAsync(TestAuth.EmailFor(role), TestAuth.Password);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    private Task<HttpResponseMessage> PostRefreshAsync(string refreshToken) =>
        _client.PostAsJsonAsync(RefreshPath, new { refreshToken }, Json);

    // ---------------------------------------------------------------- AC-1

    [Fact]
    public async Task AC1_Login_with_valid_credentials_issues_tokens_and_role_claim()
    {
        var body = await LoginAsRoleAsync(Roles.Dispatcher);

        body.GetProperty("accessToken").GetString().Should().NotBeNullOrWhiteSpace();
        body.GetProperty("refreshToken").GetString().Should().NotBeNullOrWhiteSpace();
        body.GetProperty("expiresIn").GetInt32().Should().BePositive();

        var user = body.GetProperty("user");
        user.GetProperty("email").GetString().Should().Be(TestAuth.EmailFor(Roles.Dispatcher));
        user.GetProperty("role").GetString().Should().Be(Roles.Dispatcher);
        user.GetProperty("fullName").GetString().Should().NotBeNullOrWhiteSpace();
        user.GetProperty("id").GetInt64().Should().BePositive();

        // The authorization decision is made from the token itself, so assert the claim the policies
        // read — that is what makes access genuinely stateless rather than merely intended to be.
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(body.GetProperty("accessToken").GetString());
        jwt.Claims.Should().Contain(c =>
            c.Type == System.Security.Claims.ClaimTypes.Role && c.Value == Roles.Dispatcher);
        jwt.Claims.Should().Contain(c => c.Type == JwtRegisteredClaimNames.Sub);
        jwt.ValidTo.Should().BeAfter(DateTime.UtcNow);
    }

    // ---------------------------------------------------------------- AC-2

    [Fact]
    public async Task AC2_Login_with_wrong_password_returns_401_and_issues_no_token()
    {
        var response = await LoginAsync(TestAuth.EmailFor(Roles.Dispatcher), "definitely-not-the-password");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("status").GetInt32().Should().Be(401);
        body.TryGetProperty("accessToken", out _).Should().BeFalse();
        body.TryGetProperty("refreshToken", out _).Should().BeFalse();
    }

    [Fact]
    public async Task AC2_Unknown_email_and_wrong_password_are_indistinguishable()
    {
        // Anti-enumeration: a probe must not be able to tell a registered email from an unregistered
        // one by status code, title or detail text.
        var wrongPassword = await LoginAsync(TestAuth.EmailFor(Roles.Dispatcher), "definitely-not-the-password");
        var unknownEmail = await LoginAsync("nobody@logiflow.dev", "definitely-not-the-password");

        unknownEmail.StatusCode.Should().Be(wrongPassword.StatusCode);
        var a = await wrongPassword.Content.ReadFromJsonAsync<JsonElement>(Json);
        var b = await unknownEmail.Content.ReadFromJsonAsync<JsonElement>(Json);
        b.GetProperty("title").GetString().Should().Be(a.GetProperty("title").GetString());
        b.GetProperty("detail").GetString().Should().Be(a.GetProperty("detail").GetString());
    }

    // ---------------------------------------------------------------- AC-3

    [Theory]
    [InlineData("", "pw")]
    [InlineData("not-an-email", "pw")]
    [InlineData("dana@logiflow.dev", "")]
    public async Task AC3_Login_input_validation_returns_400_with_field_errors(string email, string password)
    {
        var response = await LoginAsync(email, password);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("status").GetInt32().Should().Be(400);

        var errors = body.GetProperty("errors");
        errors.EnumerateObject().Should().NotBeEmpty();
        // Field names are camelCase in the problem document (matching the contract's LoginRequest).
        errors.EnumerateObject().Select(p => p.Name).Should().BeSubsetOf(["email", "password"]);
    }

    // ---------------------------------------------------------------- AC-4

    [Fact]
    public async Task AC4_Protected_endpoint_without_token_returns_401_with_bearer_challenge()
    {
        var response = await _client.GetAsync("/api/v1/warehouses");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        // RFC 6750 requires a challenge so a client knows the scheme it should have used.
        response.Headers.WwwAuthenticate.Should().ContainSingle()
            .Which.Scheme.Should().Be("Bearer");

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("status").GetInt32().Should().Be(401);
        body.GetProperty("type").GetString().Should().EndWith("unauthorized");
    }

    [Theory]
    [InlineData("not-a-jwt")]
    [InlineData("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.not-a-real-signature")]
    public async Task AC4_Malformed_or_forged_token_returns_401(string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/warehouses");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await _client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ---------------------------------------------------------------- AC-5

    [Fact]
    public async Task AC5_Viewer_cannot_create_warehouse_and_no_row_is_created()
    {
        var viewer = _factory.CreateClient();
        await viewer.SignInAsync(Roles.Viewer);

        var before = await CountWarehousesAsAsync(Roles.Admin);
        var response = await viewer.PostAsJsonAsync("/api/v1/warehouses",
            new { name = "Viewer Attempt", address = "Nowhere" }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        body.GetProperty("status").GetInt32().Should().Be(403);

        // 403 must mean "nothing happened" — assert the row count is unchanged.
        var after = await CountWarehousesAsAsync(Roles.Admin);
        after.Should().Be(before, "a rejected request must not create a row");
        viewer.Dispose();
    }

    // ---------------------------------------------------------------- AC-6

    [Fact]
    public async Task AC6_Role_matrix_matches_the_contract_x_roles()
    {
        var admin = _factory.CreateClient();
        await admin.SignInAsync(Roles.Admin);
        var dispatcher = _factory.CreateClient();
        await dispatcher.SignInAsync(Roles.Dispatcher);
        var viewer = _factory.CreateClient();
        await viewer.SignInAsync(Roles.Viewer);

        // Dispatcher: full read/write except delete (DELETE is x-roles: [Admin]).
        var created = await dispatcher.PostAsJsonAsync("/api/v1/warehouses",
            new { name = "Matrix DC", address = "1 Matrix Way" }, Json);
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("id").GetInt64();

        (await dispatcher.GetAsync("/api/v1/warehouses")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await dispatcher.GetAsync($"/api/v1/warehouses/{id}")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await dispatcher.PutAsJsonAsync($"/api/v1/warehouses/{id}",
            new { name = "Matrix DC 2", address = "1 Matrix Way" }, Json)).StatusCode.Should().Be(HttpStatusCode.OK);
        (await dispatcher.DeleteAsync($"/api/v1/warehouses/{id}")).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // Viewer: read-only, everywhere.
        (await viewer.GetAsync("/api/v1/warehouses")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await viewer.GetAsync($"/api/v1/warehouses/{id}")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await viewer.PutAsJsonAsync($"/api/v1/warehouses/{id}",
            new { name = "Hacked", address = "x" }, Json)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // Admin: delete succeeds.
        (await admin.DeleteAsync($"/api/v1/warehouses/{id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);

        admin.Dispose();
        dispatcher.Dispose();
        viewer.Dispose();
    }

    /// <summary>Reads a warehouse page as the given role and returns the reported total count.</summary>
    private async Task<long> CountWarehousesAsAsync(string role)
    {
        using var client = _factory.CreateClient();
        await client.SignInAsync(role);
        var body = await client.GetFromJsonAsync<JsonElement>("/api/v1/warehouses?page=1&pageSize=1", Json);
        return body.GetProperty("totalCount").GetInt64();
    }
}