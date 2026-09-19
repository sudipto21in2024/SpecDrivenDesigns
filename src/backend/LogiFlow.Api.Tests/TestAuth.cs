using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Infrastructure;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Signs integration-test clients in against the real /auth/login endpoint (LOGI-0003).
///
/// Tests authenticate the same way a browser does — no token forging, no bypassed middleware — so the
/// RBAC assertions exercise the actual JWT validation and role policies.
/// </summary>
internal static class TestAuth
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The seeded password for every development/test account (SeedData.DevelopmentPassword).</summary>
    public const string Password = SeedData.DevelopmentPassword;

    /// <summary>The seeded account email for a given role, e.g. <c>Roles.Admin</c> → alex@logiflow.dev.</summary>
    public static string EmailFor(string role) =>
        SeedData.Users.Single(u => u.Role == role).Email;

    /// <summary>
    /// Signs <paramref name="client"/> in as the seeded user holding <paramref name="role"/> by
    /// calling /auth/login and attaching the returned access token as a bearer header.
    /// Returns the token response body so tests can assert on its shape.
    /// </summary>
    public static async Task<JsonElement> SignInAsync(this HttpClient client, string role)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email = EmailFor(role), password = Password }, Json);

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "the seeded {0} account must be able to log in", role);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
        return body;
    }
}