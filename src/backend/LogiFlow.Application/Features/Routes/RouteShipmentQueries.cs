using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Routes;

/// <summary>
/// Read-only BR-5 capacity projection for a route (contract: RouteCapacityView).
///
/// <c>capacityKg</c> / <c>vehicleId</c> / <c>remainingCapacityKg</c> are **null** for a route with
/// no vehicle: "unknown capacity" is not "zero capacity", and a UI rendering 0 would tell the
/// Dispatcher the truck is full when nothing is known about it.
/// </summary>
public record RouteCapacityView(
    long? VehicleId,
    double? CapacityKg,
    double AssignedWeightKg,
    double? RemainingCapacityKg,
    int ShipmentCount);

/// <summary>
/// Paged envelope for GET /routes/{id}/shipments (contract: RouteShipmentsPage) — the standard
/// pagination fields plus the capacity projection, so the screen can render the load bar and the
/// list from a single round trip.
/// </summary>
public record RouteShipmentPageDto(
    IReadOnlyList<ShipmentDto> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages,
    RouteCapacityView Capacity);

public record ListRouteShipmentsQuery(long RouteId, int Page = 1, int PageSize = 25)
    : IQuery<RouteShipmentPageDto>;

public class ListRouteShipmentsValidator : AbstractValidator<ListRouteShipmentsQuery>
{
    public ListRouteShipmentsValidator()
    {
        RuleFor(x => x.RouteId).GreaterThan(0);
        RuleFor(x => x.Page).GreaterThanOrEqualTo(1);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 100);
    }
}

public class ListRouteShipmentsHandler(IAppDbContext db, ICurrentUser currentUser)
    : IRequestHandler<ListRouteShipmentsQuery, RouteShipmentPageDto>
{
    public async Task<RouteShipmentPageDto> Handle(ListRouteShipmentsQuery request, CancellationToken cancellationToken)
    {
        var route = await db.Routes
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.Id == request.RouteId, cancellationToken)
            ?? throw new NotFoundException(nameof(Route), request.RouteId);

        // AC-7 / BR-6: a Driver sees only the shipments on their own routes. The same check as
        // GetRouteByIdHandler (LOGI-0009). LOGI-0011 originally looked like the third call site that
        // would justify a shared helper, but its board is 403 for Drivers by decision (spec O1), so
        // it adds none — the helper stays deferred until a genuine third one appears (F12).
        if (currentUser.Role == Roles.Driver)
        {
            var driver = await db.Drivers
                .AsNoTracking()
                .SingleOrDefaultAsync(d => d.UserId == currentUser.UserId, cancellationToken);

            if (driver is null || route.DriverId != driver.Id)
                throw new ForbiddenException("Driver can only access assigned routes.");
        }

        var query = db.Shipments.AsNoTracking().Where(s => s.RouteId == request.RouteId);

        var totalCount = await query.CountAsync(cancellationToken);

        // Now drives the BR-2 atRisk projection, so the list rows are identical in shape to
        // GET /shipments (AC-10).
        var now = SlaPolicy.TruncateToSeconds(DateTime.UtcNow);
        var items = await query
            .OrderBy(s => s.Id)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(s => ShipmentDto.From(s, now))
            .ToListAsync(cancellationToken);

        var capacity = await RouteCapacityViewFactory.BuildAsync(db, route, cancellationToken);

        return new RouteShipmentPageDto(
            items,
            request.Page,
            request.PageSize,
            totalCount,
            request.PageSize > 0 ? (int)Math.Ceiling(totalCount / (double)request.PageSize) : 0,
            capacity);
    }
}

// Visible to Features/Planning (LOGI-0011 O4): the board's route cards reuse this exact projection
// so the board's capacity bar can never disagree with the assignment guard. Widening visibility is
// deliberate — moving or duplicating the calculation would create a second BR-5 implementation.
public static class RouteCapacityViewFactory
{
    /// <summary>
    /// Builds the projection from three cheap reads: the vehicle's capacity (only when the route
    /// has one), the running BR-5 weight sum, and the shipment count. The count is taken
    /// independently of the page so a paged slice never reports a partial load.
    /// </summary>
    public static async Task<RouteCapacityView> BuildAsync(IAppDbContext db, Route route, CancellationToken cancellationToken)
    {
        double? capacityKg = null;
        if (route.VehicleId.HasValue)
        {
            capacityKg = await db.Vehicles
                .AsNoTracking()
                .Where(v => v.Id == route.VehicleId.Value)
                .Select(v => (double?)v.CapacityKg)
                .SingleOrDefaultAsync(cancellationToken);
        }

        var assignedWeightKg = await RouteCapacityGuard.AssignedWeightAsync(db, route.Id, cancellationToken);
        var shipmentCount = await db.Shipments
            .AsNoTracking()
            .CountAsync(s => s.RouteId == route.Id, cancellationToken);

        // remaining is null whenever capacity is unknown; it can never be negative because an
        // over-capacity assignment is rejected rather than persisted.
        double? remaining = capacityKg is null ? null : capacityKg.Value - assignedWeightKg;

        return new RouteCapacityView(
            route.VehicleId.HasValue && capacityKg is not null ? route.VehicleId : null,
            capacityKg,
            assignedWeightKg,
            remaining,
            shipmentCount);
    }
}
