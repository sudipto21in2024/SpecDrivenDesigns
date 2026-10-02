using System.Net;
using FluentAssertions;
using LogiFlow.Domain.Security;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0012 backend: the role matrix on the dashboard (AC-7, spec O1) and the read-only
/// guarantee (spec O2 — the dashboard stores nothing and offers no write verb).
///
/// O1 is the interesting case: Driver is 403 on this org-wide read while Viewer is read-allowed,
/// on exactly the LOGI-0011 argument. That asymmetry is deliberate, not an oversight.
/// </summary>
public class DashboardAuthzTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _anonymous = null!;

    public DashboardAuthzTests(LogiFlowTestFactory factory) => _factory = factory;

    public Task InitializeAsync()
    {
        _anonymous = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> SignInAsync(string role)
    {
        var client = _factory.CreateClient();
        await client.SignInAsync(role);
        return client;
    }

    // ---- AC-7: authorization ----------------------------------------------------------------------

    [Fact]
    public async Task AC7_Anonymous_is_401()
    {
        // LOGI-0012 AC-7
        var res = await _anonymous.GetAsync(DashboardFixture.DashboardUrl);

        res.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Theory]
    [InlineData(Roles.Admin)]
    [InlineData(Roles.Dispatcher)]
    [InlineData(Roles.Viewer)]
    public async Task AC7_Admin_Dispatcher_and_Viewer_each_receive_200(string role)
    {
        // LOGI-0012 AC-7 — Viewer is read-allowed like on every other v1 read.
        var client = await SignInAsync(role);

        var res = await client.GetAsync(DashboardFixture.DashboardUrl);

        res.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AC7_Driver_is_403_on_the_org_wide_dashboard()
    {
        // LOGI-0012 AC-7 / O1 — the dashboard is org-wide while BR-6 and F12 scope a Driver to their
        // own route. A 200 here would have to mean "of what you may see", so the counts and the
        // fleet utilization would be quietly wrong rather than merely incomplete.
        var client = await SignInAsync(Roles.Driver);

        var res = await client.GetAsync(DashboardFixture.DashboardUrl);

        res.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ---- spec O2: read-only -----------------------------------------------------------------------

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task O2_No_write_verb_exists_on_the_dashboard(string method)
    {
        // LOGI-0012 O2 — the dashboard is a read projection: there is no aggregate to write, and
        // BR-2 rule 2.5 forbids persisting the at-risk flag. The routing table itself is the proof.
        var client = await SignInAsync(Roles.Admin);
        using var request = new HttpRequestMessage(new HttpMethod(method), DashboardFixture.DashboardUrl)
        {
            Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json"),
        };

        var res = await client.SendAsync(request);

        res.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
    }
}
