using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Drivers;

/// <summary>
/// AC-7: paged list; q filters by full name contains (case-insensitive); status exact filter.
/// Ordered by id asc — the resource has no createdAt, so id order is the stable contract order.
/// </summary>
public record ListDriversQuery(int Page = 1, int PageSize = 25, string? Q = null, string? Status = null)
    : IQuery<PagedResult<DriverDto>>;

public class ListDriversValidator : AbstractValidator<ListDriversQuery>
{
    public ListDriversValidator()
    {
        RuleFor(x => x.Page).GreaterThanOrEqualTo(1);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 100);
        RuleFor(x => x.Status).Must(s => s is null || DriverValues.Statuses.Contains(s))
            .WithMessage($"Status must be one of: {string.Join(", ", DriverValues.Statuses)}.");
    }
}

public class ListDriversHandler(IAppDbContext db) : IRequestHandler<ListDriversQuery, PagedResult<DriverDto>>
{
    public async Task<PagedResult<DriverDto>> Handle(ListDriversQuery request, CancellationToken cancellationToken)
    {
        var query = db.Drivers.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(request.Q))
        {
            query = query.Where(d => d.FullName.ToLower().Contains(request.Q.ToLower()));
        }

        if (request.Status is not null)
        {
            query = query.Where(d => d.Status == request.Status);
        }

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderBy(d => d.Id)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(d => new DriverDto(d.Id, d.UserId, d.FullName, d.LicenseNumber, d.Phone, d.Status))
            .ToListAsync(cancellationToken);

        return PagedResult<DriverDto>.Create(items, request.Page, request.PageSize, totalCount);
    }
}

/// <summary>AC-8: get by id. Throws NotFoundException (→404) when absent.</summary>
public record GetDriverByIdQuery(long Id) : IQuery<DriverDto>;

public class GetDriverByIdHandler(IAppDbContext db) : IRequestHandler<GetDriverByIdQuery, DriverDto>
{
    public async Task<DriverDto> Handle(GetDriverByIdQuery request, CancellationToken cancellationToken)
    {
        var driver = await db.Drivers.AsNoTracking()
            .SingleOrDefaultAsync(d => d.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Driver), request.Id);

        return new DriverDto(driver.Id, driver.UserId, driver.FullName, driver.LicenseNumber, driver.Phone, driver.Status);
    }
}