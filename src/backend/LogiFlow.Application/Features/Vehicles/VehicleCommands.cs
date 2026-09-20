using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Vehicles;

/// <summary>Read model returned by all vehicle endpoints (API contract: VehicleResponse).</summary>
public record VehicleDto(long Id, string PlateNumber, string Type, double CapacityKg, string Status, DateTime CreatedAt);

/// <summary>Closed value sets from 04-database-schema.md §vehicles (contract enums).</summary>
public static class VehicleValues
{
    public const string DefaultStatus = "Available";
    public static readonly IReadOnlyList<string> Types = ["Van", "Truck", "Trailer"];
    public static readonly IReadOnlyList<string> Statuses = ["Available", "InRoute", "Maintenance"];
}

/// <summary>AC-1: create a vehicle. 201 with the created DTO; duplicate plate → 409 (AC-3).</summary>
public record CreateVehicleCommand(string PlateNumber, string Type, double CapacityKg, string? Status)
    : ICommand<VehicleDto>;

public class CreateVehicleValidator : AbstractValidator<CreateVehicleCommand>
{
    public CreateVehicleValidator()
    {
        RuleFor(x => x.PlateNumber).NotEmpty().MaximumLength(20);
        RuleFor(x => x.Type).NotEmpty().Must(VehicleValues.Types.Contains)
            .WithMessage("Type must be one of: Van, Truck, Trailer.");
        RuleFor(x => x.CapacityKg).GreaterThan(0);
        RuleFor(x => x.Status).Must(s => s is null || VehicleValues.Statuses.Contains(s))
            .WithMessage("Status must be one of: Available, InRoute, Maintenance.");
    }
}

public class CreateVehicleHandler(IAppDbContext db) : IRequestHandler<CreateVehicleCommand, VehicleDto>
{
    public async Task<VehicleDto> Handle(CreateVehicleCommand request, CancellationToken cancellationToken)
    {
        // Omitted status defaults to Available (AC-6); the validator rejected bad values.
        var status = string.IsNullOrWhiteSpace(request.Status) ? VehicleValues.DefaultStatus : request.Status;
        var plate = request.PlateNumber.Trim();

        if (await db.Vehicles.AnyAsync(v => v.PlateNumber == plate, cancellationToken))
        {
            throw new ConflictException(nameof(Domain.Vehicle), plate);
        }

        var vehicle = Domain.Vehicle.Create(plate, request.Type, request.CapacityKg, status, DateTime.UtcNow);
        db.Vehicles.Add(vehicle);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Race backstop: concurrent creates can both pass the pre-check; the unique
            // index on plate_number arbitrates and the loser surfaces as 409, not 500.
            throw new ConflictException(nameof(Domain.Vehicle), plate);
        }

        return new VehicleDto(vehicle.Id, vehicle.PlateNumber, vehicle.Type, vehicle.CapacityKg, vehicle.Status, vehicle.CreatedAt);
    }

    internal static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is not null && ex.InnerException.Message.Contains("UNIQUE", StringComparison.OrdinalIgnoreCase);
}

/// <summary>AC-8: full update (PUT). NotFoundException (→404) when absent; duplicate plate → 409.</summary>
public record UpdateVehicleCommand(long Id, string PlateNumber, string Type, double CapacityKg, string? Status)
    : ICommand<VehicleDto>;

public class UpdateVehicleValidator : AbstractValidator<UpdateVehicleCommand>
{
    public UpdateVehicleValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0);
        RuleFor(x => x.PlateNumber).NotEmpty().MaximumLength(20);
        RuleFor(x => x.Type).NotEmpty().Must(VehicleValues.Types.Contains)
            .WithMessage("Type must be one of: Van, Truck, Trailer.");
        RuleFor(x => x.CapacityKg).GreaterThan(0);
        RuleFor(x => x.Status).Must(s => s is null || VehicleValues.Statuses.Contains(s))
            .WithMessage("Status must be one of: Available, InRoute, Maintenance.");
    }
}

public class UpdateVehicleHandler(IAppDbContext db) : IRequestHandler<UpdateVehicleCommand, VehicleDto>
{
    public async Task<VehicleDto> Handle(UpdateVehicleCommand request, CancellationToken cancellationToken)
    {
        var vehicle = await db.Vehicles
            .SingleOrDefaultAsync(v => v.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Vehicle), request.Id);

        var plate = request.PlateNumber.Trim();
        var status = string.IsNullOrWhiteSpace(request.Status) ? VehicleValues.DefaultStatus : request.Status;

        if (await db.Vehicles.AnyAsync(v => v.Id != request.Id && v.PlateNumber == plate, cancellationToken))
        {
            throw new ConflictException(nameof(Domain.Vehicle), plate);
        }

        vehicle.Update(plate, request.Type, request.CapacityKg, status);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (CreateVehicleHandler.IsUniqueViolation(ex))
        {
            throw new ConflictException(nameof(Domain.Vehicle), plate);
        }

        return new VehicleDto(vehicle.Id, vehicle.PlateNumber, vehicle.Type, vehicle.CapacityKg, vehicle.Status, vehicle.CreatedAt);
    }
}

/// <summary>AC-8: hard delete (v1 — no soft-delete column). NotFoundException (→404) when absent.</summary>
public record DeleteVehicleCommand(long Id) : ICommand;

public class DeleteVehicleHandler(IAppDbContext db) : IRequestHandler<DeleteVehicleCommand>
{
    public async Task Handle(DeleteVehicleCommand request, CancellationToken cancellationToken)
    {
        var vehicle = await db.Vehicles
            .SingleOrDefaultAsync(v => v.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Vehicle), request.Id);

        db.Vehicles.Remove(vehicle);
        await db.SaveChangesAsync(cancellationToken);
    }
}
