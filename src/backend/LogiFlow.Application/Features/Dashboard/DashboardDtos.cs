using LogiFlow.Application.Common;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Domain;

namespace LogiFlow.Application.Features.Dashboard;

/// <summary>
/// One BR-7 status and its UNTRUNCATED count for the active filters (contract: StatusCount,
/// LOGI-0012 AC-1). The tile counts what EXISTS, never what was returned, so a client rendering
/// "312 pending" is not silently capped by the at-risk page size.
/// </summary>
public record StatusCount(string Status, int Count);

/// <summary>
/// One row of the dashboard's SLA-at-risk list (contract: DashboardAtRiskShipment, AC-2). A
/// PROJECTION of the shipment read model <c>GET /shipments</c> serves, not a second source of
/// truth: <see cref="From"/> copies the same <see cref="ShipmentDto"/> fields, so the tile and the
/// drill-down list can never show different data for the same shipment.
/// </summary>
public record DashboardAtRiskShipment(
    long Id, string ReferenceCode, string Status, string Priority, DateTime? SlaDueAt,
    int? MinutesToDue, long OriginWarehouseId, string DestinationAddress)
{
    public static DashboardAtRiskShipment From(ShipmentDto s, DateTime generatedAt) =>
        new(s.Id, s.ReferenceCode, s.Status, s.Priority, s.SlaDueAt,
            s.SlaDueAt is null ? null : MinutesUntil(s.SlaDueAt.Value, generatedAt),
            s.OriginWarehouseId, s.DestinationAddress);

    /// <summary>
    /// Whole minutes from <paramref name="generatedAt"/> to the due instant, negative once
    /// overdue. Truncated toward zero so a shipment due in 95.9 minutes reports 95 rather than
    /// rounding up to 96 and reading as already-due. The 2h at-risk RULE stays in
    /// <see cref="SlaPolicy"/>; this only renders an already-fetched due date against the already
    /// captured instant, so the number cannot disagree with the flag it sits next to.
    /// </summary>
    private static int MinutesUntil(DateTime slaDueAt, DateTime generatedAt) =>
        (int)(slaDueAt - generatedAt).TotalMinutes;
}

/// <summary>
/// Base status-bucket utilization for a fleet resource (contract: ResourceUtilization, AC-4/AC-5,
/// O3). v1 has no duty-hour data, so "utilization" is the honest count over the resource's own
/// status enum plus a derived percent — never a percentage of hours worked. The bucket set is
/// seeded from the authoritative value list so a bucket with no members is present with 0 rather
/// than missing (a bucket the client cannot find is a bucket it cannot render).
/// </summary>
public record ResourceUtilization(
    int TotalCount, IReadOnlyDictionary<string, int> ByStatus, double? UtilizationPercent);

/// <summary>
/// Fleet utilization (contract: VehicleUtilization, AC-4). Adds the capacity-weighted view on top
/// of the base buckets. A vehicle in Maintenance is in <c>TotalCapacityKg</c> but never in
/// <c>InUseCapacityKg</c>: it is not available capacity and must not be counted as in-use either.
/// </summary>
public record VehicleUtilization(
    int TotalCount, IReadOnlyDictionary<string, int> ByStatus, double? UtilizationPercent,
    double InUseCapacityKg, double TotalCapacityKg, double? CapacityUtilizationPercent)
    : ResourceUtilization(TotalCount, ByStatus, UtilizationPercent);

/// <summary>Driver pool utilization (contract: DriverUtilization, AC-5); a Suspended driver is
/// never counted as available capacity.</summary>
public record DriverUtilization(
    int TotalCount, IReadOnlyDictionary<string, int> ByStatus, double? UtilizationPercent)
    : ResourceUtilization(TotalCount, ByStatus, UtilizationPercent);

/// <summary>
/// Echo of the filter set the server actually applied (contract: appliedFilters), so the UI can
/// render and restore the active filters. Every field here is also a <c>GET /shipments</c> filter
/// (AC-6) — that equivalence is the whole reason this record exists in this shape.
/// </summary>
public record DashboardFilters(
    string? Status, string? Priority, long? OriginWarehouseId, long? RouteId, int Page, int PageSize);

/// <summary>Body of GET /dashboard (contract: DashboardResponse).</summary>
public record DashboardResponse(
    DateTime GeneratedAt,
    DashboardFilters AppliedFilters,
    IReadOnlyList<StatusCount> StatusCounts,
    int AtRiskTotalCount,
    PagedResult<DashboardAtRiskShipment> AtRiskShipments,
    VehicleUtilization VehicleUtilization,
    DriverUtilization DriverUtilization);
