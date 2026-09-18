using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Warehouses;

/// <summary>Read model returned by all warehouse endpoints (API contract: WarehouseResponse).</summary>
public record WarehouseDto(long Id, string Name, string Address, double? Latitude, double? Longitude, DateTime CreatedAt);

/// <summary>AC-1: create a warehouse. 201 with the created DTO.</summary>
public record CreateWarehouseCommand(string Name, string Address, double? Latitude, double? Longitude)
    : ICommand<WarehouseDto>;

public class CreateWarehouseValidator : AbstractValidator<CreateWarehouseCommand>
{
    public CreateWarehouseValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Address).NotEmpty().MaximumLength(500);
        RuleFor(x => x.Latitude).InclusiveBetween(-90d, 90d).When(x => x.Latitude.HasValue);
        RuleFor(x => x.Longitude).InclusiveBetween(-180d, 180d).When(x => x.Longitude.HasValue);
    }
}

public class CreateWarehouseHandler(IAppDbContext db) : IRequestHandler<CreateWarehouseCommand, WarehouseDto>
{
    public async Task<WarehouseDto> Handle(CreateWarehouseCommand request, CancellationToken cancellationToken)
    {
        var warehouse = Domain.Warehouse.Create(request.Name, request.Address, request.Latitude, request.Longitude, DateTime.UtcNow);
        db.Warehouses.Add(warehouse);
        await db.SaveChangesAsync(cancellationToken);
        return new WarehouseDto(warehouse.Id, warehouse.Name, warehouse.Address, warehouse.Latitude, warehouse.Longitude, warehouse.CreatedAt);
    }
}

/// <summary>AC-6: full update (PUT). Throws NotFoundException (→404) when absent.</summary>
public record UpdateWarehouseCommand(long Id, string Name, string Address, double? Latitude, double? Longitude)
    : ICommand<WarehouseDto>;

public class UpdateWarehouseValidator : AbstractValidator<UpdateWarehouseCommand>
{
    public UpdateWarehouseValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0);
        RuleFor(x => x.Name).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Address).NotEmpty().MaximumLength(500);
        RuleFor(x => x.Latitude).InclusiveBetween(-90d, 90d).When(x => x.Latitude.HasValue);
        RuleFor(x => x.Longitude).InclusiveBetween(-180d, 180d).When(x => x.Longitude.HasValue);
    }
}

public class UpdateWarehouseHandler(IAppDbContext db) : IRequestHandler<UpdateWarehouseCommand, WarehouseDto>
{
    public async Task<WarehouseDto> Handle(UpdateWarehouseCommand request, CancellationToken cancellationToken)
    {
        var warehouse = await db.Warehouses
            .SingleOrDefaultAsync(w => w.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Warehouse), request.Id);

        warehouse.Update(request.Name, request.Address, request.Latitude, request.Longitude);
        await db.SaveChangesAsync(cancellationToken);

        return new WarehouseDto(warehouse.Id, warehouse.Name, warehouse.Address, warehouse.Latitude, warehouse.Longitude, warehouse.CreatedAt);
    }
}

/// <summary>AC-7: hard delete (v1 — no soft-delete column). Throws NotFoundException (→404) when absent.</summary>
public record DeleteWarehouseCommand(long Id) : ICommand;

public class DeleteWarehouseHandler(IAppDbContext db) : IRequestHandler<DeleteWarehouseCommand>
{
    public async Task Handle(DeleteWarehouseCommand request, CancellationToken cancellationToken)
    {
        var warehouse = await db.Warehouses
            .SingleOrDefaultAsync(w => w.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Warehouse), request.Id);

        db.Warehouses.Remove(warehouse);
        await db.SaveChangesAsync(cancellationToken);
    }
}
