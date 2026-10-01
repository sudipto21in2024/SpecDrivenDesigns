using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using LogiFlow.Domain.Security;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0011 backend: the role matrix on the planning board (AC-6) and the read-only guarantee
/// (AC-7, spec O3). O1 is the interesting one — Driver is 403 on the org-wide board while Viewer
/// is read-allowed, and that asymmetry is deliberate rather than an oversight.
/// </summary>
public class PlanningBoardAuthzTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private HttpClient _admin = null!;
    private HttpClient _dispatcher = null!;
    private HttpClient _viewer = null!;
    private HttpClient _driver = null!;
    private HttpClient _anonymous = null!;

    public PlanningBoardAuthzTests(LogiFlowTestFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _admin = await SignInAsync(Roles.Admin);
        _dispatcher = await SignInAsync(Roles.Dispatcher);
        _viewer = await SignInAsync(Roles.Viewer);
        _driver = await SignInAsync(Roles.Driver);
        _anonymous = _factory.CreateClient();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> SignInAsync(string role)
    {
        var client = _factory.CreateClient();
        await client.SignInAsync(role);
        return client;
    }

    // ---- AC-6: authorization ----------------------------------------------------------------------

    [Fact]
    public async Task AC6_Anonymous_is_401()
    {
        // LOGI-0011 AC-6
        var res = await _anonymous.GetAsync("/api/v1/planning-board");
        res.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Theory]
    [InlineData(Roles.Admin)]
    [InlineData(Roles.Dispatcher)]
    [InlineData(Roles.Viewer)]
    public async Task AC6_Admin_Dispatcher_and_Viewer_read_the_board(string role)
    {
        // LOGI-0011 AC-6 — Viewer is read-allowed like on every other v1 read.
        var client = await SignInAsync(role);
        var res = await client.GetAsync("/api/v1/planning-board");
        res.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AC6_Driver_is_403_on_the_org_wide_board()
    {
        // LOGI-0011 AC-6 / spec O1: the board spans every shipment, while BR-6 and the
        // LOGI-0009/0010 rule scope a Driver to their own route. A 200 would need an implicit
        // filter the contract never describes, and the column counts would be wrong either way.
        var res = await _driver.GetAsync("/api/v1/planning-board");
        res.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var problem = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        problem.GetProperty("status").GetInt32().Should().Be(403);
    }

    [Fact]
    public async Task AC6_Viewer_and_Admin_see_the_same_board_shape()
    {
        // LOGI-0011 AC-6 — Viewer is read-only, not data-restricted.
        var admin = await _admin.GetFromJsonAsync<JsonElement>("/api/v1/planning-board", Json);
        var viewer = await _viewer.GetFromJsonAsync<JsonElement>("/api/v1/planning-board", Json);

        viewer.GetProperty("columns").EnumerateArray()
            .Select(c => c.GetProperty("status").GetString())
            .Should().Equal(admin.GetProperty("columns").EnumerateArray()
                .Select(c => c.GetProperty("status").GetString()));
    }

    // ---- AC-7: the board is read-only ---------------------------------------------------------------

    [Fact]
    public async Task AC7_No_write_verb_is_mapped_on_the_board()
    {
        // LOGI-0011 AC-7 / spec O3. A drag-and-drop board would be a second entry point to BR-7 and
        // BR-5; the routing table is the proof that no such entry point exists.
        foreach (var verb in new[] { HttpMethod.Post, HttpMethod.Put, HttpMethod.Patch, HttpMethod.Delete })
        {
            using var req = new HttpRequestMessage(verb, "/api/v1/planning-board")
            {
                Content = JsonContent.Create(new { status = "Assigned" }, options: Json),
            };
            var res = await _dispatcher.SendAsync(req);
            res.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed,
                $"{verb} must not be mapped on the planning board");
        }
    }

    [Fact]
    public async Task AC7_Board_write_attempt_changes_nothing()
    {
        // LOGI-0011 AC-7 — and the data is untouched, not merely rejected at the router.
        var before = await _dispatcher.GetFromJsonAsync<JsonElement>("/api/v1/planning-board", Json);

        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/planning-board")
        {
            Content = JsonContent.Create(new { status = "Delivered" }, options: Json),
        };
        (await _dispatcher.SendAsync(req)).StatusCode
            .Should().Be(HttpStatusCode.MethodNotAllowed);

        var after = await _dispatcher.GetFromJsonAsync<JsonElement>("/api/v1/planning-board", Json);
        after.GetProperty("columns").EnumerateArray()
            .Select(c => c.GetProperty("totalCount").GetInt32())
            .Should().Equal(before.GetProperty("columns").EnumerateArray()
                .Select(c => c.GetProperty("totalCount").GetInt32()));
    }
}