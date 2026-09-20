using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Vehicles;

/// <summary>AC-7: paged list; q filters by plate contains (case-insensitive); status/type exact filters.</summary>
public record ListVehiclesQuery(int Page = 1, int PageSize = 25, string? Q = null, string? Status = null, string? Type = null)
    : IQuery<PagedResult<VehicleDto>>;

public class ListVehiclesValidator : AbstractValidator<ListVehiclesQuery>
{
    public ListVehiclesValidator()
    {
        RuleFor(x => x.Page).GreaterThanOrEqualTo(1);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 100);
        RuleFor(x => x.Status).Must(s => s is null || VehicleValues.Statuses.Contains(s))
            .WithMessage($"Status must be one of: {string.Join(", ", VehicleValues.Statuses)}.");
        RuleFor(x => x.Type).Must(t => t is null || VehicleValues.Types.Contains(t))
            .WithMessage($"Type must be one of: {string.Join(", ", VehicleValues.Types)}.");
    }
}

public class ListVehiclesHandler(IAppDbContext db) : IRequestHandler<ListVehiclesQuery, PagedResult<VehicleDto>>
{
    public async Task<PagedResult<VehicleDto>> Handle(ListVehiclesQuery request, CancellationToken cancellationToken)
    {
        var query = db.Vehicles.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(request.Q))
        {
            query = query.Where(v => v.PlateNumber.ToLower().Contains(request.Q.ToLower()));
        }

        if (request.Status is not null)
        {
            query = query.Where(v => v.Status == request.Status);
        }

        if (request.Type is not null)
        {
            query = query.Where(v => v.Type == request.Type);
        }

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderBy(v => v.Id)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(v => new VehicleDto(v.Id, v.PlateNumber, v.Type, v.CapacityKg, v.Status, v.CreatedAt))
            .ToListAsync(cancellationToken);

        return PagedResult<VehicleDto>.Create(items, request.Page, request.PageSize, totalCount);
    }
}

/// <summary>AC-8: get by id. Throws NotFoundException (→404) when absent.</summary>
public record GetVehicleByIdQuery(long Id) : IQuery<VehicleDto>;

public class GetVehicleByIdHandler(IAppDbContext db) : IRequestHandler<GetVehicleByIdQuery, VehicleDto>
{
    public async Task<VehicleDto> Handle(GetVehicleByIdQuery request, CancellationToken cancellationToken)
    {
        var vehicle = await db.Vehicles.AsNoTracking()
            .SingleOrDefaultAsync(v => v.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Vehicle), request.Id);

        return new VehicleDto(vehicle.Id, vehicle.PlateNumber, vehicle.Type, vehicle.CapacityKg, vehicle.Status, vehicle.CreatedAt);
    }
}
