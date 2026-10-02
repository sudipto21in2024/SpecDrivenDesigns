using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Features.Drivers;
using LogiFlow.Application.Features.Planning;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Application.Features.Vehicles;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Dashboard;

/// <summary>
/// The manager's 60-second morning read (LOGI-0012 / PRD F14, BRD BO-2): what is at risk, how full
/// the fleet is, where the backlog sits. Read-only by design (O2) — the at-risk flag is the BR-2
/// read-time projection, never a stored column, and a status transition or an assignment keeps its
/// own endpoint.
///
/// The filters are the LOGI-0007 shipment-list filters (O4/AC-6) and they are applied through the
/// board's shared <see cref="PlanningBoardFilters"/>, so every tile drills down into
/// <c>GET /shipments</c> with the rows the tile counted.
/// </summary>
public record GetDashboardQuery(
    string? Status = null, string? Priority = null, long? OriginWarehouseId = null,
    long? RouteId = null, int Page = 1, int PageSize = 20) : IQuery<DashboardResponse>;

public class GetDashboardValidator : AbstractValidator<GetDashboardQuery>
{
    public GetDashboardValidator()
    {
        RuleFor(x => x.Page).GreaterThanOrEqualTo(1);
        // AC-8: the contract caps pageSize at 100, the same ceiling as the shipment list — a
        // dashboard page is a screenful of rows, not a data export.
        RuleFor(x => x.PageSize).InclusiveBetween(1, 100);

        // AC-8: an unknown enum value fails loudly rather than silently rendering an empty tile.
        RuleFor(x => x.Status).Must(s => s is null || ShipmentStatusValues.IsKnown(s))
            .WithMessage($"status must be one of: {string.Join(", ", ShipmentStatusValues.All)}.");
        RuleFor(x => x.Priority).Must(p => p is null || SlaPolicy.IsKnownPriority(p))
            .WithMessage($"priority must be one of: {string.Join(", ", SlaPolicy.Priorities)}.");

        RuleFor(x => x.OriginWarehouseId).GreaterThan(0).When(x => x.OriginWarehouseId.HasValue);
        RuleFor(x => x.RouteId).GreaterThan(0).When(x => x.RouteId.HasValue);
    }
}

public class GetDashboardHandler(IAppDbContext db)
    : IRequestHandler<GetDashboardQuery, DashboardResponse>
{
    // The in-use vehicle bucket (the middle value of the authoritative vehicle status list).
    // Declared here rather than indexed into the list so the intent reads plainly; the utilization
    // tests assert the emitted bucket names equal that list, which catches any future divergence.
    private const string InRouteStatus = "InRoute";

    public async Task<DashboardResponse> Handle(GetDashboardQuery request, CancellationToken cancellationToken)
    {
        // ONE instant for the whole response (AC-3): the cutoff bound, every at-risk row's
        // minutesToDue and the echoed generatedAt all read the same truncated "now". Two separate
        // DateTime.UtcNow calls would let a shipment cross the 2h boundary between the tile's count
        // and the list's rows, which is exactly the disagreement AC-3 forbids.
        var now = SlaPolicy.TruncateToSeconds(DateTime.UtcNow);
        var cutoff = SlaPolicy.AtRiskCutoff(now);

        // AC-6: the shared predicate, not a dashboard-specific copy.
        var query = PlanningBoardFilters.Apply(db.Shipments.AsNoTracking(),
            request.Status, request.Priority, request.OriginWarehouseId, request.RouteId,
            q: null, slaRisk: null, cutoff);

        // AC-1: one group-by over the FILTERED set instead of six counts, and over the full set
        // rather than the returned page — the tiles count what exists, not what was fetched.
        var grouped = await query
            .GroupBy(s => s.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Status, g => g.Count, cancellationToken);

        // The six entries and their order come from the lifecycle-ordered status list, so the order
        // is correct by construction and a status with no shipments is present with 0 (AC-1) — a
        // missing tile is a tile the UI would have to invent.
        var statusCounts = ShipmentStatusValues.All
            .Select(status => new StatusCount(status, grouped.GetValueOrDefault(status)))
            .ToList();

        // BR-2 as the same SQL-translatable bound the shipments list uses, over the same filtered
        // query. Delivered/Cancelled are excluded via SlaPolicy.ExemptStatuses, so a Delayed
        // shipment is at risk and cannot escape by being delayed (BR-2 rule 2.4), and a null due
        // date is never at risk (rule 2.7) because the null check is part of the bound.
        var atRisk = query.Where(s =>
            s.SlaDueAt != null && s.SlaDueAt <= cutoff && !SlaPolicy.ExemptStatuses.Contains(s.Status));

        // AC-3: the tile number and the page totalCount are the SAME count over the SAME set, so
        // the tile cannot disagree with the list it links to. One query, one answer.
        var atRiskTotalCount = await atRisk.CountAsync(cancellationToken);

        // Deadline-first, id ascending as the tiebreak: pages never duplicate or skip a row, and
        // two identical requests are byte-comparable apart from generatedAt (AC-8). The BR-2 flag
        // and minutesToDue are projected in memory from the unit-tested SlaPolicy twin — the same
        // seam ListShipmentsHandler uses, so the flag and the bound cannot disagree.
        var rows = await atRisk
            .OrderBy(s => s.SlaDueAt)
            .ThenBy(s => s.Id)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .ToListAsync(cancellationToken);

        var atRiskPage = PagedResult<DashboardAtRiskShipment>.Create(
            rows.Select(s => DashboardAtRiskShipment.From(ShipmentDto.From(s, now), now)).ToList(),
            request.Page, request.PageSize, atRiskTotalCount);

        return new DashboardResponse(
            now,
            new DashboardFilters(request.Status, request.Priority, request.OriginWarehouseId,
                request.RouteId, request.Page, request.PageSize),
            statusCounts,
            atRiskTotalCount,
            atRiskPage,
            await BuildVehicleUtilizationAsync(cancellationToken),
            await BuildDriverUtilizationAsync(cancellationToken));
    }


    /// <summary>
    /// Fleet buckets plus the capacity-weighted view (AC-4). The bucket set is seeded from the
    /// authoritative vehicle status list so an empty bucket is present with 0. Only InRoute
    /// vehicles contribute to in-use capacity: a Maintenance vehicle is in the fleet but is neither
    /// in use nor available, so folding it into either number would misreport the fleet.
    /// </summary>
    private async Task<VehicleUtilization> BuildVehicleUtilizationAsync(CancellationToken cancellationToken)
    {
        var vehicles = await db.Vehicles.AsNoTracking().ToListAsync(cancellationToken);

        var byStatus = SeedBuckets(VehicleValues.Statuses);
        foreach (var vehicle in vehicles)
            byStatus[vehicle.Status] = byStatus.GetValueOrDefault(vehicle.Status) + 1;

        var totalCount = vehicles.Count;
        var totalCapacityKg = vehicles.Sum(v => v.CapacityKg);
        var inUseCapacityKg = vehicles.Where(v => v.Status == InRouteStatus).Sum(v => v.CapacityKg);

        return new VehicleUtilization(
            totalCount,
            byStatus,
            Percent(byStatus.GetValueOrDefault(InRouteStatus), totalCount),
            inUseCapacityKg,
            totalCapacityKg,
            // AC-4: an empty fleet is "no capacity", never "0% used" — a 0 would be
            // indistinguishable from a genuinely idle one.
            Percent(inUseCapacityKg, totalCapacityKg));
    }

    /// <summary>Driver buckets over the driver status enum (AC-5); Suspended is never available
    /// capacity, and the in-use bucket is the default (Active) one.</summary>
    private async Task<DriverUtilization> BuildDriverUtilizationAsync(CancellationToken cancellationToken)
    {
        var drivers = await db.Drivers.AsNoTracking().ToListAsync(cancellationToken);

        var byStatus = SeedBuckets(DriverValues.Statuses);
        foreach (var driver in drivers)
            byStatus[driver.Status] = byStatus.GetValueOrDefault(driver.Status) + 1;

        var totalCount = drivers.Count;
        return new DriverUtilization(
            totalCount,
            byStatus,
            Percent(byStatus.GetValueOrDefault(DriverValues.DefaultStatus), totalCount));
    }

    /// <summary>Every bucket present at 0 before any row is counted, so the response shape does
    /// not depend on the data.</summary>
    private static Dictionary<string, int> SeedBuckets(IReadOnlyList<string> statuses) =>
        statuses.ToDictionary(s => s, _ => 0);

    /// <summary>
    /// Share as a percentage, or <c>null</c> when the denominator is 0 (AC-4/AC-5). Rounded to 2
    /// decimals so two identical requests are byte-comparable (AC-8) and the JSON carries no
    /// float noise.
    /// </summary>
    private static double? Percent(double part, double total) =>
        total <= 0 ? null : Math.Round(part / total * 100, 2);
}

