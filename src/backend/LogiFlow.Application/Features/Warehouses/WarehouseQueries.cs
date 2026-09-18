using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Warehouses;

/// <summary>AC-4: paged list; q filters by name contains (case-insensitive).</summary>
public record ListWarehousesQuery(int Page = 1, int PageSize = 25, string? Q = null) : IQuery<PagedResult<WarehouseDto>>;

public class ListWarehousesValidator : AbstractValidator<ListWarehousesQuery>
{
    public ListWarehousesValidator()
    {
        RuleFor(x => x.Page).GreaterThanOrEqualTo(1);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 100);
    }
}

public class ListWarehousesHandler(IAppDbContext db) : IRequestHandler<ListWarehousesQuery, PagedResult<WarehouseDto>>
{
    public async Task<PagedResult<WarehouseDto>> Handle(ListWarehousesQuery request, CancellationToken cancellationToken)
    {
        var query = db.Warehouses.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(request.Q))
        {
            query = query.Where(w => w.Name.ToLower().Contains(request.Q.ToLower()));
        }

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderBy(w => w.Id)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(w => new WarehouseDto(w.Id, w.Name, w.Address, w.Latitude, w.Longitude, w.CreatedAt))
            .ToListAsync(cancellationToken);

        return PagedResult<WarehouseDto>.Create(items, request.Page, request.PageSize, totalCount);
    }
}

/// <summary>AC-5: get by id. Throws NotFoundException (→404) when absent.</summary>
public record GetWarehouseByIdQuery(long Id) : IQuery<WarehouseDto>;

public class GetWarehouseByIdHandler(IAppDbContext db) : IRequestHandler<GetWarehouseByIdQuery, WarehouseDto>
{
    public async Task<WarehouseDto> Handle(GetWarehouseByIdQuery request, CancellationToken cancellationToken)
    {
        var warehouse = await db.Warehouses.AsNoTracking()
            .SingleOrDefaultAsync(w => w.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Warehouse), request.Id);

        return new WarehouseDto(warehouse.Id, warehouse.Name, warehouse.Address, warehouse.Latitude, warehouse.Longitude, warehouse.CreatedAt);
    }
}
