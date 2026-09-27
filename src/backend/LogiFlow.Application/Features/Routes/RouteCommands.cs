using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Routes;

public record RouteDto(
    long Id,
    string Name,
    DateTime PlannedStart,
    DateTime PlannedEnd,
    long? VehicleId,
    long? DriverId,
    string Status,
    DateTime CreatedAt,
    DateTime? UpdatedAt);

public static class RouteMapping
{
    public static RouteDto ToDto(Route r) =>
        new(r.Id, r.Name, r.PlannedStart, r.PlannedEnd, r.VehicleId, r.DriverId, r.Status, r.CreatedAt, r.UpdatedAt);
}

public record CreateRouteCommand(
    string Name,
    DateTime PlannedStart,
    DateTime PlannedEnd,
    long? VehicleId,
    long? DriverId) : ICommand<RouteDto>;

public class CreateRouteValidator : AbstractValidator<CreateRouteCommand>
{
    public CreateRouteValidator()
    {
        RuleFor(x => x.Name)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Name is required.")
            .Must(n => !string.IsNullOrWhiteSpace(n)).WithMessage("Name cannot be whitespace-only.")
            .MaximumLength(200).WithMessage("Name must not exceed 200 characters.");

        RuleFor(x => x.PlannedStart).NotEmpty().WithMessage("Planned start is required.");
        RuleFor(x => x.PlannedEnd)
            .NotEmpty().WithMessage("Planned end is required.")
            .GreaterThan(x => x.PlannedStart).WithMessage("Planned end must be after planned start.");

        RuleFor(x => x.VehicleId)
            .GreaterThan(0).When(x => x.VehicleId.HasValue)
            .WithMessage("VehicleId must be greater than zero.");

        RuleFor(x => x.DriverId)
            .GreaterThan(0).When(x => x.DriverId.HasValue)
            .WithMessage("DriverId must be greater than zero.");
    }
}

public class CreateRouteHandler(IAppDbContext db) : IRequestHandler<CreateRouteCommand, RouteDto>
{
    public async Task<RouteDto> Handle(CreateRouteCommand request, CancellationToken cancellationToken)
    {
        if (request.VehicleId.HasValue && !await db.Vehicles.AnyAsync(v => v.Id == request.VehicleId.Value, cancellationToken))
            throw new NotFoundException(nameof(Vehicle), request.VehicleId.Value);

        if (request.DriverId.HasValue && !await db.Drivers.AnyAsync(d => d.Id == request.DriverId.Value, cancellationToken))
            throw new NotFoundException(nameof(Driver), request.DriverId.Value);

        await RouteConflictCheck.EnsureNoDoubleBookingAsync(
            db, null, request.VehicleId, request.DriverId, request.PlannedStart, request.PlannedEnd, cancellationToken);

        var route = Route.Create(request.Name, request.PlannedStart, request.PlannedEnd, request.VehicleId, request.DriverId, DateTime.UtcNow);
        db.Routes.Add(route);
        await db.SaveChangesAsync(cancellationToken);

        return RouteMapping.ToDto(route);
    }
}

public record UpdateRouteCommand(
    long Id,
    string? Name,
    DateTime? PlannedStart,
    DateTime? PlannedEnd,
    long? VehicleId,
    bool VehicleIdSpecified,
    long? DriverId,
    bool DriverIdSpecified) : ICommand<RouteDto>;

public class UpdateRouteValidator : AbstractValidator<UpdateRouteCommand>
{
    public UpdateRouteValidator()
    {
        RuleFor(x => x.Name!)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Name cannot be empty.")
            .Must(n => !string.IsNullOrWhiteSpace(n)).WithMessage("Name cannot be whitespace-only.")
            .MaximumLength(200).WithMessage("Name must not exceed 200 characters.")
            .When(x => x.Name is not null);

        RuleFor(x => x.VehicleId)
            .GreaterThan(0).When(x => x.VehicleIdSpecified && x.VehicleId.HasValue)
            .WithMessage("VehicleId must be greater than zero.");

        RuleFor(x => x.DriverId)
            .GreaterThan(0).When(x => x.DriverIdSpecified && x.DriverId.HasValue)
            .WithMessage("DriverId must be greater than zero.");
    }
}

public class UpdateRouteHandler(IAppDbContext db) : IRequestHandler<UpdateRouteCommand, RouteDto>
{
    public async Task<RouteDto> Handle(UpdateRouteCommand request, CancellationToken cancellationToken)
    {
        var route = await db.Routes.SingleOrDefaultAsync(r => r.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Route), request.Id);

        if (!string.Equals(route.Status, RouteStatusValues.Planned, StringComparison.Ordinal))
            throw new ConflictException(nameof(Route), $"Cannot edit route {request.Id} with status '{route.Status}': only Planned routes can be edited.");

        var newName = request.Name ?? route.Name;
        var newStart = request.PlannedStart ?? route.PlannedStart;
        var newEnd = request.PlannedEnd ?? route.PlannedEnd;
        if (newEnd <= newStart)
            throw new ValidationException(new[] { new FluentValidation.Results.ValidationFailure("plannedEnd", "Planned end must be after planned start.") });

        var newVehicleId = request.VehicleIdSpecified ? request.VehicleId : route.VehicleId;
        var newDriverId = request.DriverIdSpecified ? request.DriverId : route.DriverId;

        if (request.VehicleIdSpecified && newVehicleId.HasValue && !await db.Vehicles.AnyAsync(v => v.Id == newVehicleId.Value, cancellationToken))
            throw new NotFoundException(nameof(Vehicle), newVehicleId.Value);

        if (request.DriverIdSpecified && newDriverId.HasValue && !await db.Drivers.AnyAsync(d => d.Id == newDriverId.Value, cancellationToken))
            throw new NotFoundException(nameof(Driver), newDriverId.Value);

        await RouteConflictCheck.EnsureNoDoubleBookingAsync(
            db, route.Id, newVehicleId, newDriverId, newStart, newEnd, cancellationToken);

        route.AssignOrUpdate(newName, newStart, newEnd, newVehicleId, newDriverId, DateTime.UtcNow);
        await db.SaveChangesAsync(cancellationToken);

        return RouteMapping.ToDto(route);
    }
}
