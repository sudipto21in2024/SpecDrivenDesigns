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

/// <summary>List/search tests (LOGI-0007 AC-6..AC-9, AC-10 GET role matrix).</summary>
public class ShipmentListTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly LogiFlowTestFactory _factory;
    private HttpClient _client = null!;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public ShipmentListTests(LogiFlowTestFactory factory) => _factory = factory;

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

    // Each test seeds its own warehouse so exact-count assertions stay stable while the shared
    // in-memory database accumulates rows across tests in this class.
    private async Task<long> SeedWarehouseAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/warehouses",
            new { name = $"WH {Guid.NewGuid():N}"[..12], address = "List street 1", latitude = 51.5, longitude = 4.5 }, Json);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(Json);
        return body.GetProperty("id").GetInt64();
    }

    private async Task<JsonElement> CreateAsync(long warehouseId, string address, string priority)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/shipments",
            new { originWarehouseId = warehouseId, destinationAddress = address, weightKg = 20, priority }, Json);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    private async Task<JsonElement> GetAsync(string query) =>
        await _client.GetFromJsonAsync<JsonElement>($"/api/v1/shipments{query}", Json);

    private async Task<HttpStatusCode> GetStatusAsync(string query) =>
        (await _client.GetAsync($"/api/v1/shipments{query}")).StatusCode;

    private static long[] Ids(JsonElement page) =>
        page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetInt64()).ToArray();

    private async Task<long> SeedShipmentAsync(long warehouseId, string status, string priority, DateTime? slaDueAt)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
        var shipment = Shipment.Create(
            $"SHP-{Guid.NewGuid():N}"[..20], warehouseId, $"Seed {Guid.NewGuid():N}"[..16],
            null, null, 10, status, priority, slaDueAt, DateTime.UtcNow);
        db.Shipments.Add(shipment);
        await db.SaveChangesAsync();
        return shipment.Id;
    }

    [Fact]
    public async Task AC6_paged_envelope_defaults_pagination_and_validation()
    {
        var wh = await SeedWarehouseAsync();
        var a = (await CreateAsync(wh, "First row", "Standard")).GetProperty("id").GetInt64();
        var b = (await CreateAsync(wh, "Second row", "Standard")).GetProperty("id").GetInt64();
        var c = (await CreateAsync(wh, "Third row", "Standard")).GetProperty("id").GetInt64();

        var all = await GetAsync($"?originWarehouseId={wh}");
        all.GetProperty("page").GetInt32().Should().Be(1);
        all.GetProperty("pageSize").GetInt32().Should().Be(25, "contract default");
        all.GetProperty("totalCount").GetInt64().Should().Be(3);
        all.GetProperty("totalPages").GetInt32().Should().Be(1);
        Ids(all).Should().BeEquivalentTo(new[] { a, b, c });

        var paged = await GetAsync($"?originWarehouseId={wh}&page=2&pageSize=1");
        paged.GetProperty("totalCount").GetInt64().Should().Be(3, "totalCount counts every match, not the page");
        paged.GetProperty("totalPages").GetInt32().Should().Be(3);
        Ids(paged).Should().HaveCount(1);

        (await GetStatusAsync("?page=0")).Should().Be(HttpStatusCode.BadRequest);
        (await GetStatusAsync("?pageSize=0")).Should().Be(HttpStatusCode.BadRequest);
        (await GetStatusAsync("?pageSize=101")).Should().Be(HttpStatusCode.BadRequest, "max pageSize is 100");
    }

    [Fact]
    public async Task AC7_filters_combine_with_AND_over_status_priority_origin_and_q()
    {
        var wh1 = await SeedWarehouseAsync();
        var wh2 = await SeedWarehouseAsync();
        var token = $"QSEVEN{Guid.NewGuid():N}"[..14];

        var a = await CreateAsync(wh1, $"{token} alpha", "Standard");
        var aId = a.GetProperty("id").GetInt64();
        var transition = await _client.PostAsJsonAsync($"/api/v1/shipments/{aId}/status-transitions", new { toStatus = "Assigned" }, Json);
        transition.StatusCode.Should().Be(HttpStatusCode.OK);
        var bId = (await CreateAsync(wh1, "Quay beta", "Express")).GetProperty("id").GetInt64();
        var cId = (await CreateAsync(wh2, "Quay gamma", "Standard")).GetProperty("id").GetInt64();

        // status matches exactly — the Assigned row never leaks into status=Pending.
        Ids(await GetAsync($"?originWarehouseId={wh1}&status=Pending")).Should().BeEquivalentTo(new[] { bId });

        // AND across filters: adding filters only ever narrows the set.
        var combined = await GetAsync($"?originWarehouseId={wh1}&status=Pending&priority=Express");
        Ids(combined).Should().BeEquivalentTo(new[] { bId });
        combined.GetProperty("totalCount").GetInt64().Should().Be(1);
        Ids(await GetAsync($"?status=Pending&priority=Standard&originWarehouseId={wh2}")).Should().BeEquivalentTo(new[] { cId });

        // q: contains, case-insensitive, over referenceCode OR destinationAddress (§7 default).
        Ids(await GetAsync($"?originWarehouseId={wh1}&q={token}")).Should().BeEquivalentTo(new[] { aId });
        var code = a.GetProperty("referenceCode").GetString();
        Ids(await GetAsync($"?originWarehouseId={wh1}&q={code}")).Should().BeEquivalentTo(new[] { aId });

        // Unknown filter enum values fail loudly with 400 (§7).
        (await GetStatusAsync($"?originWarehouseId={wh1}&status=Flying")).Should().Be(HttpStatusCode.BadRequest);
        (await GetStatusAsync($"?originWarehouseId={wh1}&priority=Urgent")).Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AC8_sorting_defaults_to_newest_first_and_orders_sla_due_with_nulls_last()
    {
        var wh = await SeedWarehouseAsync();
        var first = (await CreateAsync(wh, "Sort one", "Standard")).GetProperty("id").GetInt64();   // due +48h
        var second = (await CreateAsync(wh, "Sort two", "Express")).GetProperty("id").GetInt64();   // due +12h
        var third = (await CreateAsync(wh, "Sort three", "Standard")).GetProperty("id").GetInt64(); // due +48h
        var nullDue = await SeedShipmentAsync(wh, "Pending", "Standard", null);

        // Default = createdAt desc. createdAt is monotonic in id, so ids arrive newest-first
        // whether or not the three creates straddle a second boundary.
        Ids(await GetAsync($"?originWarehouseId={wh}")).Should().Equal(nullDue, third, second, first);
        Ids(await GetAsync($"?originWarehouseId={wh}&sort=-createdAt")).Should().Equal(nullDue, third, second, first);
        Ids(await GetAsync($"?originWarehouseId={wh}&sort=createdAt")).Should().Equal(first, second, third, nullDue);

        // slaDueAt ascending: Express (+12h) first; the two Standards (equal or ordered dues) fill
        // the middle; null due LAST in this direction.
        var asc = Ids(await GetAsync($"?originWarehouseId={wh}&sort=slaDueAt"));
        asc[0].Should().Be(second, "the Express due date (+12h) precedes the Standard ones (+48h)");
        asc[1..3].Should().BeEquivalentTo(new[] { first, third });
        asc[3].Should().Be(nullDue, "null slaDueAt sorts last in BOTH directions");

        // slaDueAt descending: null due STILL last; Express becomes the smallest non-null.
        var desc = Ids(await GetAsync($"?originWarehouseId={wh}&sort=-slaDueAt"));
        desc[3].Should().Be(nullDue, "null slaDueAt sorts last in BOTH directions");
        desc[2].Should().Be(second, "Express (+12h) is the smallest non-null due");
        desc[..2].Should().BeEquivalentTo(new[] { first, third });

        (await GetStatusAsync($"?originWarehouseId={wh}&sort=weight")).Should().Be(HttpStatusCode.BadRequest, "unknown sort fails loudly");
    }

    [Fact]
    public async Task AC9_atRisk_is_a_read_time_projection_and_slaRisk_partitions_the_list()
    {
        var wh = await SeedWarehouseAsync();
        // BR-sla-rules §3 Example A: due 2026-09-20T08:00Z — already past, hence within the 2h window.
        var exampleDue = new DateTime(2026, 9, 20, 8, 0, 0, DateTimeKind.Utc);
        var riskyPending = await SeedShipmentAsync(wh, "Pending", "Standard", exampleDue);
        var riskyDelivered = await SeedShipmentAsync(wh, "Delivered", "Standard", exampleDue);
        var riskyCancelled = await SeedShipmentAsync(wh, "Cancelled", "Express", exampleDue);
        var nullDue = await SeedShipmentAsync(wh, "Pending", "Standard", null);
        var freshId = (await CreateAsync(wh, "Fresh risk check", "Express")).GetProperty("id").GetInt64();

        var scoped = await GetAsync($"?originWarehouseId={wh}");
        var byId = scoped.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("id").GetInt64());
        byId[riskyPending].GetProperty("atRisk").GetBoolean().Should().BeTrue("Example A: now >= due - 2h and Pending is eligible");
        byId[riskyDelivered].GetProperty("atRisk").GetBoolean().Should().BeFalse("rule 2.3 exempts Delivered");
        byId[riskyCancelled].GetProperty("atRisk").GetBoolean().Should().BeFalse("rule 2.3 exempts Cancelled");
        byId[nullDue].GetProperty("atRisk").GetBoolean().Should().BeFalse("rule 2.4: null due → false");
        byId[freshId].GetProperty("atRisk").GetBoolean().Should().BeFalse("fresh Express is due in 12h, outside the 2h window");

        // slaRisk=true returns exactly the at-risk rows; false the exact complement (AC-9).
        var atRisk = await GetAsync($"?originWarehouseId={wh}&slaRisk=true");
        Ids(atRisk).Should().BeEquivalentTo(new[] { riskyPending });
        atRisk.GetProperty("totalCount").GetInt64().Should().Be(1);
        var notAtRisk = await GetAsync($"?originWarehouseId={wh}&slaRisk=false");
        Ids(notAtRisk).Should().BeEquivalentTo(new[] { riskyDelivered, riskyCancelled, nullDue, freshId });
        notAtRisk.GetProperty("totalCount").GetInt64().Should().Be(4);
    }

    [Fact]
    public async Task AC10_GET_enforces_the_contract_role_matrix()
    {
        var anon = _factory.CreateClient();
        (await anon.GetAsync("/api/v1/shipments")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        foreach (var (role, expected) in new[]
        {
            (Roles.Admin, HttpStatusCode.OK),
            (Roles.Dispatcher, HttpStatusCode.OK),
            (Roles.Viewer, HttpStatusCode.OK),
            (Roles.Driver, HttpStatusCode.Forbidden), // deferral: own-route scoping lands in LOGI-0009/0010 (spec §7)
        })
        {
            using var client = _factory.CreateClient();
            await client.SignInAsync(role);
            (await client.GetAsync("/api/v1/shipments")).StatusCode.Should().Be(expected,
                $"{role} must receive {expected} from GET /shipments per contract x-roles");
        }
    }
}