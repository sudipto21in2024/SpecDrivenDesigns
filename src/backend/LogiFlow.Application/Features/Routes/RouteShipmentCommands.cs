using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Routes;

/// <summary>
/// Assigns one shipment to a route (LOGI-0010, PRD F10). The BR-5 capacity guard lives in the
/// handler because it needs the route, its vehicle and the running weight sum — no other aggregate
/// can answer it — while the shipment-side guards live in <c>Shipment.AssignToRoute</c>.
/// </summary>
public record AssignShipmentToRouteCommand(long RouteId, long ShipmentId) : ICommand<ShipmentDto>;

public class AssignShipmentToRouteValidator : AbstractValidator<AssignShipmentToRouteCommand>
{
    public AssignShipmentToRouteValidator()
    {
        // AC-5: both ids must be positive; the route id is bound by the route template, so only
        // the body field is really the caller's to get wrong.
        RuleFor(x => x.RouteId).GreaterThan(0);
        RuleFor(x => x.ShipmentId).GreaterThan(0).WithMessage("shipmentId must be a positive integer.");
    }
}

public class AssignShipmentToRouteHandler(IAppDbContext db, ICurrentUser currentUser)
    : IRequestHandler<AssignShipmentToRouteCommand, ShipmentDto>
{
    public Task<ShipmentDto> Handle(AssignShipmentToRouteCommand request, CancellationToken cancellationToken) =>
        // The whole guard-and-write runs inside one transaction (AC-9): the running total is read
        // after the transaction opens, so two concurrent boundary assigns cannot both observe the
        // same free capacity and both win.
        db.ExecuteInTransactionAsync(ct => AssignAsync(request, ct), cancellationToken);

    private async Task<ShipmentDto> AssignAsync(AssignShipmentToRouteCommand request, CancellationToken ct)
    {
        // AC-3: unknown route is 404 before anything else is inspected.
        var route = await db.Routes
            .SingleOrDefaultAsync(r => r.Id == request.RouteId, ct)
            ?? throw new NotFoundException(nameof(Route), request.RouteId);

        // AC-3 / plan §5.1 O2: a route is a plan until it departs, so only Planned accepts loads.
        if (!string.Equals(route.Status, RouteStatusValues.Planned, StringComparison.Ordinal))
        {
            throw new ConflictException(
                $"Cannot assign shipments to route {request.RouteId} with status '{route.Status}': only Planned routes can be assigned to.");
        }

        // AC-4: unknown shipment is 404.
        var shipment = await db.Shipments
            .SingleOrDefaultAsync(s => s.Id == request.ShipmentId, ct)
            ?? throw new NotFoundException(nameof(Shipment), request.ShipmentId);

        // AC-4 O3: re-assigning to the SAME route is an idempotent no-op — 200, no second history
        // row, and crucially no second contribution to the capacity sum below. It is answered
        // before the status check because an already-assigned shipment is exactly the case where
        // the status check would otherwise produce a confusing "must be Pending" 409.
        if (shipment.RouteId == request.RouteId)
            return ShipmentDto.From(shipment, SlaPolicy.TruncateToSeconds(DateTime.UtcNow));

        await RouteCapacityGuard.EnsureFitsAsync(db, route, shipment.WeightKg, ct);

        // The domain re-checks the shipment-side invariants (Pending, unassigned); its exceptions
        // become 409 with a message naming the required status.
        ShipmentStatusEvent history;
        try
        {
            history = shipment.AssignToRoute(request.RouteId, currentUser.UserId!.Value, DateTime.UtcNow);
        }
        catch (ShipmentNotAssignableException notAssignable)
        {
            throw new ConflictException(notAssignable.Message);
        }
        catch (ShipmentAlreadyAssignedException alreadyAssigned)
        {
            throw new ConflictException(alreadyAssigned.Message);
        }

        // One SaveChanges: shipments.route_id, shipments.status and the history row commit together
        // or not at all (spec §6, AC-9).
        db.ShipmentStatusHistory.Add(new ShipmentStatusHistory
        {
            ShipmentId = shipment.Id,
            FromStatus = history.FromStatus,
            ToStatus = history.ToStatus,
            ChangedByUserId = history.ChangedByUserId,
            ChangedAt = history.ChangedAt,
            Note = history.Note,
        });
        await db.SaveChangesAsync(ct);

        return ShipmentDto.From(shipment, SlaPolicy.TruncateToSeconds(DateTime.UtcNow));
    }
}

/// <summary>
/// Detaches a shipment from a route and returns it to Pending (LOGI-0010 AC-6, plan §5.1 O4).
/// </summary>
public record RemoveShipmentFromRouteCommand(long RouteId, long ShipmentId) : ICommand<Unit>;

public class RemoveShipmentFromRouteValidator : AbstractValidator<RemoveShipmentFromRouteCommand>
{
    public RemoveShipmentFromRouteValidator()
    {
        RuleFor(x => x.RouteId).GreaterThan(0);
        RuleFor(x => x.ShipmentId).GreaterThan(0);
    }
}

public class RemoveShipmentFromRouteHandler(IAppDbContext db, ICurrentUser currentUser)
    : IRequestHandler<RemoveShipmentFromRouteCommand, Unit>
{
    public Task<Unit> Handle(RemoveShipmentFromRouteCommand request, CancellationToken cancellationToken) =>
        db.ExecuteInTransactionAsync(async ct =>
        {
            if (!await db.Routes.AnyAsync(r => r.Id == request.RouteId, ct))
                throw new NotFoundException(nameof(Route), request.RouteId);

            var shipment = await db.Shipments
                .SingleOrDefaultAsync(s => s.Id == request.ShipmentId, ct)
                ?? throw new NotFoundException(nameof(Shipment), request.ShipmentId);

            ShipmentStatusEvent history;
            try
            {
                history = shipment.UnassignFromRoute(request.RouteId, currentUser.UserId!.Value, DateTime.UtcNow);
            }
            catch (ShipmentNotOnRouteException)
            {
                // "That shipment is not on this route" means there is nothing to remove — a 404,
                // matching the contract. This also covers "assigned to a different route".
                throw new NotFoundException(nameof(Shipment), request.ShipmentId);
            }
            catch (ShipmentNotAssignableException notAssignable)
            {
                // It has left Assigned by another path (InTransit/Delivered/Cancelled) — a state
                // conflict, so 409.
                throw new ConflictException(notAssignable.Message);
            }

            db.ShipmentStatusHistory.Add(new ShipmentStatusHistory
            {
                ShipmentId = shipment.Id,
                FromStatus = history.FromStatus,
                ToStatus = history.ToStatus,
                ChangedByUserId = history.ChangedByUserId,
                ChangedAt = history.ChangedAt,
                Note = history.Note,
            });
            await db.SaveChangesAsync(ct);
            return Unit.Value;
        }, cancellationToken);
}

/// <summary>
/// The BR-5 capacity rule, isolated because both the assign command and the list projection need
/// the same "what is already loaded on this route" question. The sum is computed in SQL over the
/// same storage type (<c>weight_kg</c> is REAL) the weights are written in, so the comparison is
/// exactly consistent with what is persisted (see backend plan §5).
/// </summary>
public static class RouteCapacityGuard
{
    /// <summary>
    /// Throws <see cref="ConflictException"/> when adding <paramref name="addingWeightKg"/> to the
    /// route's current load would exceed the assigned vehicle's capacity. A route with **no**
    /// vehicle has no capacity to check, so the rule is vacuously satisfied and the load is allowed
    /// (plan §5.1 — BR-5 is conditioned on "the assigned vehicle's capacity_kg"; LOGI-0009 O3
    /// deliberately allows a vehicle-less route so planning can happen before the truck is chosen).
    /// </summary>
    public static async Task EnsureFitsAsync(IAppDbContext db, Route route, double addingWeightKg, CancellationToken cancellationToken)
    {
        if (!route.VehicleId.HasValue)
            return;

        var capacityKg = await db.Vehicles
            .AsNoTracking()
            .Where(v => v.Id == route.VehicleId.Value)
            .Select(v => (double?)v.CapacityKg)
            .SingleOrDefaultAsync(cancellationToken);

        if (capacityKg is null)
            return;

        var assignedWeightKg = await AssignedWeightAsync(db, route.Id, cancellationToken);

        if (assignedWeightKg + addingWeightKg > capacityKg.Value)
        {
            // The three numbers go into the ProblemDetails detail: the UI needs them to render the
            // capacity bar and tell the Dispatcher how much room is actually left (AC-2).
            throw new ConflictException(
                $"Vehicle capacity exceeded on route {route.Id}: currently assigned {assignedWeightKg}kg, adding {addingWeightKg}kg, vehicle capacity {capacityKg.Value}kg.");
        }
    }

    /// <summary>Running BR-5 total for a route — the shipments whose route_id points at it.</summary>
    public static Task<double> AssignedWeightAsync(IAppDbContext db, long routeId, CancellationToken cancellationToken) =>
        db.Shipments
            .AsNoTracking()
            .Where(s => s.RouteId == routeId)
            .SumAsync(s => s.WeightKg, cancellationToken);
}
