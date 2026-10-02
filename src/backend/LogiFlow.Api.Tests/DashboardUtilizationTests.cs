using System.Text.Json;
using FluentAssertions;
using LogiFlow.Application.Features.Drivers;
using LogiFlow.Application.Features.Vehicles;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// LOGI-0012 backend: the fleet and driver utilization snapshots (AC-4, AC-5, spec O3).
///
/// "Utilization" is deliberately the honest count over each resource's own status enum plus a
/// derived percent — v1 has no duty-hour data, so a percentage of hours worked is not something the
/// data can honestly support (O3).
/// </summary>
public class DashboardUtilizationTests : IClassFixture<LogiFlowTestFactory>, IAsyncLifetime
{
    private readonly DashboardFixture _fixture;

    public DashboardUtilizationTests(LogiFlowTestFactory factory) =>
        _fixture = new DashboardFixture(factory);

    public async Task InitializeAsync() => await _fixture.DispatcherAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    // ---- AC-4: vehicle utilization ----------------------------------------------------------------

    [Fact]
    public async Task AC4_Buckets_use_the_vehicle_status_enum_and_include_empty_buckets()
    {
        // LOGI-0012 AC-4 — the bucket set is the schema's own enum, and a bucket with no members is
        // present with 0 rather than missing. This also pins the handler's in-use bucket to the
        // authoritative value list, so a future schema change cannot silently desync it.
        await _fixture.SeedVehicleAsync(VehicleValues.Statuses[0]);

        var d = await _fixture.GetDashboardAsync();
        var buckets = DashboardFixture.Bucket(DashboardFixture.VehicleUtilization(d));

        buckets.Keys.Should().BeEquivalentTo(VehicleValues.Statuses);
        buckets[VehicleValues.Statuses[0]].Should().BeGreaterThanOrEqualTo(1);
        buckets[VehicleValues.Statuses[2]].Should().Be(0);
    }

    [Fact]
    public async Task AC4_TotalCount_and_bucket_counts_agree()
    {
        // LOGI-0012 AC-4
        await _fixture.SeedVehicleAsync(VehicleValues.Statuses[0]);
        await _fixture.SeedVehicleAsync(VehicleValues.Statuses[1]);

        var d = await _fixture.GetDashboardAsync();
        var v = DashboardFixture.VehicleUtilization(d);

        v.GetProperty("totalCount").GetInt32().Should().BeGreaterThanOrEqualTo(2);
        DashboardFixture.Bucket(v).Values.Sum()
            .Should().Be(v.GetProperty("totalCount").GetInt32());
    }


    [Fact]
    public async Task AC4_InUseCapacityKg_counts_only_the_in_route_vehicles()
    {
        // LOGI-0012 AC-4 — a Maintenance vehicle is in the fleet but is neither in use nor
        // available, so folding it into in-use capacity would overstate how busy the fleet is.
        // Asserted as a DELTA: the dashboard aggregates the WHOLE fleet and this class shares one
        // database, so an absolute sum would also include vehicles seeded by sibling tests.
        var before = DashboardFixture.VehicleUtilization(await _fixture.GetDashboardAsync());

        await _fixture.SeedVehicleAsync("InRoute", 1000);
        await _fixture.SeedVehicleAsync("InRoute", 500);
        await _fixture.SeedVehicleAsync("Maintenance", 9000);

        var d = await _fixture.GetDashboardAsync();
        var v = DashboardFixture.VehicleUtilization(d);
        var afterInUse = v.GetProperty("inUseCapacityKg").GetDouble();
        var afterTotal = v.GetProperty("totalCapacityKg").GetDouble();

        (afterInUse - before.GetProperty("inUseCapacityKg").GetDouble())
            .Should().Be(1500, "only the two InRoute vehicles count as in use");
        (afterTotal - before.GetProperty("totalCapacityKg").GetDouble())
            .Should().Be(10500, "every vehicle counts toward total capacity, Maintenance included");
    }

    [Fact]
    public async Task AC4_An_available_vehicle_is_not_in_use_capacity()
    {
        // LOGI-0012 AC-4
        await _fixture.SeedVehicleAsync("Available", 3000);

        var d = await _fixture.GetDashboardAsync();

        DashboardFixture.VehicleUtilization(d)
            .GetProperty("inUseCapacityKg").GetDouble().Should().Be(0);
    }

    [Fact]
    public async Task AC4_CapacityUtilizationPercent_is_the_in_use_share_of_total_capacity()
    {
        // LOGI-0012 AC-4 — the percent must be inUse over total. Computed from the response's own
        // two figures rather than a literal, because the class shares one database and sibling
        // tests contribute vehicles to the fleet-wide totals.
        await _fixture.SeedVehicleAsync("InRoute", 2500);
        await _fixture.SeedVehicleAsync("Available", 7500);

        var v = DashboardFixture.VehicleUtilization(await _fixture.GetDashboardAsync());
        var inUse = v.GetProperty("inUseCapacityKg").GetDouble();
        var total = v.GetProperty("totalCapacityKg").GetDouble();
        var percent = v.GetProperty("capacityUtilizationPercent");

        percent.ValueKind.Should().NotBe(JsonValueKind.Null);
        percent.GetDouble().Should().BeApproximately(inUse / total * 100, 0.01);
        inUse.Should().BeGreaterThan(0, "an InRoute vehicle was seeded, so there is in-use capacity");
        total.Should().BeGreaterThan(inUse, "an Available vehicle was seeded too");
    }

    [Fact]
    public async Task AC4_An_empty_fleet_reports_no_capacity_rather_than_zero_percent()
    {
        // LOGI-0012 AC-4 — "an empty fleet is no capacity, never 0% used": a 0 would be
        // indistinguishable from a genuinely idle one. Needs a private factory because the
        // dashboard aggregates the whole fleet and this class seeds vehicles of its own.
        var d = await DashboardFixture.GetDashboardOnEmptyDatabaseAsync();
        var v = DashboardFixture.VehicleUtilization(d);

        v.GetProperty("totalCount").GetInt32().Should().Be(0);
        v.GetProperty("totalCapacityKg").GetDouble().Should().Be(0);
        v.GetProperty("inUseCapacityKg").GetDouble().Should().Be(0);
        v.GetProperty("capacityUtilizationPercent").ValueKind.Should().Be(JsonValueKind.Null);
        v.GetProperty("utilizationPercent").ValueKind.Should().Be(JsonValueKind.Null);
        DashboardFixture.Bucket(v).Should().OnlyContain(b => b.Value == 0);
    }

    // ---- AC-5: driver utilization -----------------------------------------------------------------

    [Fact]
    public async Task AC5_Buckets_use_the_driver_status_enum_and_include_empty_buckets()
    {
        // LOGI-0012 AC-5
        await _fixture.SeedDriverAsync(DriverValues.Statuses[0]);

        var d = await _fixture.GetDashboardAsync();
        var buckets = DashboardFixture.Bucket(DashboardFixture.DriverUtilization(d));

        buckets.Keys.Should().BeEquivalentTo(DriverValues.Statuses);
        buckets[DriverValues.Statuses[0]].Should().BeGreaterThanOrEqualTo(1);
        buckets[DriverValues.Statuses[2]].Should().Be(0, "no Suspended driver was seeded");
    }

    [Fact]
    public async Task AC5_UtilizationPercent_is_the_active_share_of_all_drivers()
    {
        // LOGI-0012 AC-5
        await _fixture.SeedDriverAsync(DriverValues.DefaultStatus);
        await _fixture.SeedDriverAsync(DriverValues.Statuses[1]);
        await _fixture.SeedDriverAsync(DriverValues.Statuses[1]);

        var d = await _fixture.GetDashboardAsync();
        var dr = DashboardFixture.DriverUtilization(d);
        var buckets = DashboardFixture.Bucket(dr);

        buckets[DriverValues.DefaultStatus].Should().BeGreaterThanOrEqualTo(1);
        buckets[DriverValues.Statuses[1]].Should().BeGreaterThanOrEqualTo(2);
        dr.GetProperty("utilizationPercent").GetDouble()
            .Should().BeApproximately(
                buckets[DriverValues.DefaultStatus] * 100.0 / dr.GetProperty("totalCount").GetInt32(),
                0.01);
    }

    [Fact]
    public async Task AC5_A_suspended_driver_is_never_counted_as_available_capacity()
    {
        // LOGI-0012 AC-5 — only Active counts toward the utilization share. Asserted on a private
        // factory: sibling tests in this class seed Active drivers, and the dashboard aggregates the
        // WHOLE pool, so the Active bucket can only be 0 on an untouched database.
        await using var fresh = new LogiFlowTestFactory();
        var fixture = new DashboardFixture(fresh);
        await fixture.SeedDriverAsync(DriverValues.Statuses[2]);
        await fixture.SeedDriverAsync(DriverValues.Statuses[2]);

        var dr = DashboardFixture.DriverUtilization(await fixture.GetDashboardAsync());

        DashboardFixture.Bucket(dr)[DriverValues.Statuses[2]].Should().Be(2);
        DashboardFixture.Bucket(dr)[DriverValues.DefaultStatus].Should().Be(0);
        dr.GetProperty("utilizationPercent").GetDouble().Should().Be(0);
    }

    [Fact]
    public async Task AC5_No_drivers_at_all_reports_a_null_percent()
    {
        // LOGI-0012 AC-5 — the denominator is 0, so the figure is absent rather than 0. Needs a
        // private factory: this class seeds drivers of its own.
        var dr = DashboardFixture.DriverUtilization(
            await DashboardFixture.GetDashboardOnEmptyDatabaseAsync());

        dr.GetProperty("totalCount").GetInt32().Should().Be(0);
        dr.GetProperty("utilizationPercent").ValueKind.Should().Be(JsonValueKind.Null);
    }
}

