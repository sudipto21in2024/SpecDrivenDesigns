using LogiFlow.Application.Features.Routes;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Domain;

namespace LogiFlow.Application.Features.Planning;


/// <summary>
/// One shipment card on the planning board (contract: BoardShipmentCard). A SUBSET of
/// ShipmentResponse, not a second source of truth — <see cref="From"/> projects through the same
/// factory GET /shipments uses, so the BR-2 atRisk flag can never disagree between the board and
/// the list (LOGI-0011 AC-9). The lat/lng and updatedAt fields are dropped: a kanban card and a
/// list row have no use for them.
/// </summary>
public record BoardShipmentCard(
    long Id, string ReferenceCode, string Status, string Priority, double WeightKg,
    long OriginWarehouseId, string DestinationAddress, DateTime? SlaDueAt, long? RouteId,
    bool AtRisk, DateTime CreatedAt)
{
    public static BoardShipmentCard From(ShipmentDto s) =>
        new(s.Id, s.ReferenceCode, s.Status, s.Priority, s.WeightKg, s.OriginWarehouseId,
            s.DestinationAddress, s.SlaDueAt, s.RouteId, s.AtRisk, s.CreatedAt);
}

/// <summary>
/// One route card with its BR-5 capacity bar (contract: BoardRouteCard). The capacity projection is
/// the very same RouteCapacityView that GET /routes/{id}/shipments returns (LOGI-0011 O4), so the
/// board's load bar can never disagree with the guard that enforces it.
/// </summary>
public record BoardRouteCard(
    long Id, string Name, string Status, long? VehicleId, long? DriverId,
    DateTime PlannedStart, DateTime PlannedEnd, RouteCapacityView Capacity)
{
    public static BoardRouteCard From(Route r, RouteCapacityView capacity) =>
        new(r.Id, r.Name, r.Status, r.VehicleId, r.DriverId,
            DateTime.SpecifyKind(r.PlannedStart, DateTimeKind.Utc),
            DateTime.SpecifyKind(r.PlannedEnd, DateTimeKind.Utc),
            capacity);
}

/// <summary>
/// One kanban column (contract: BoardColumn). <c>totalCount</c> is the UNTRUNCATED count for the
/// active filters while <c>cards</c> is capped by maxPerColumn, and <c>truncated</c> is the only
/// honest way to signal that (LOGI-0011 AC-8) — without it a client would render a wrong
/// "50 of 312" and offer a broken "load more".
/// </summary>
public record BoardColumn(string Status, int TotalCount, bool Truncated, IReadOnlyList<BoardShipmentCard> Cards);

/// <summary>
/// Echo of the filter set the server actually applied (contract: BoardFilters). Absent filters are
/// null rather than omitted so the client can always distinguish "unset" from "not returned"
/// (LOGI-0011 AC-3).
/// </summary>
public record BoardFilters(
    string? Status, string? Priority, long? OriginWarehouseId, bool? SlaRisk,
    long? RouteId, string? Q, string Sort, int MaxPerColumn);

/// <summary>Body of GET /planning-board (contract: PlanningBoardResponse).</summary>
public record PlanningBoardResponse(
    DateTime GeneratedAt,
    BoardFilters AppliedFilters,
    IReadOnlyList<BoardColumn> Columns,
    int UnassignedTotalCount,
    IReadOnlyList<BoardRouteCard> Routes);
