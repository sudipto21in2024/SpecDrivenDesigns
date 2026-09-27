using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Routes;

public record GetRouteByIdQuery(long Id) : IQuery<RouteDto>;

public class GetRouteByIdHandler(IAppDbContext db, ICurrentUser currentUser)
    : IRequestHandler<GetRouteByIdQuery, RouteDto>
{
    public async Task<RouteDto> Handle(GetRouteByIdQuery request, CancellationToken cancellationToken)
    {
        var route = await db.Routes
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Route), request.Id);

        if (currentUser.Role == Roles.Driver)
        {
            var driver = await db.Drivers
                .AsNoTracking()
                .SingleOrDefaultAsync(d => d.UserId == currentUser.UserId, cancellationToken);

            if (driver is null || route.DriverId != driver.Id)
                throw new ForbiddenException("Driver can only access assigned routes.");
        }

        return RouteMapping.ToDto(route);
    }
}

public record ListRoutesQuery(
    int Page = 1,
    int PageSize = 25,
    string? Q = null,
    string? Status = null,
    long? VehicleId = null,
    long? DriverId = null) : IQuery<PagedResult<RouteDto>>;

public class ListRoutesValidator : AbstractValidator<ListRoutesQuery>
{
    public ListRoutesValidator()
    {
        RuleFor(x => x.Page).GreaterThanOrEqualTo(1);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 100);
        RuleFor(x => x.Status)
            .Must(s => s is null || RouteStatusValues.IsKnown(s))
            .WithMessage("Status must be one of: Planned, InProgress, Completed, Cancelled.");
    }
}

public class ListRoutesHandler(IAppDbContext db, ICurrentUser currentUser)
    : IRequestHandler<ListRoutesQuery, PagedResult<RouteDto>>
{
    public async Task<PagedResult<RouteDto>> Handle(ListRoutesQuery request, CancellationToken cancellationToken)
    {
        var query = db.Routes.AsNoTracking();

        if (currentUser.Role == Roles.Driver)
        {
            var driver = await db.Drivers
                .AsNoTracking()
                .SingleOrDefaultAsync(d => d.UserId == currentUser.UserId, cancellationToken);

            if (driver is null)
                return PagedResult<RouteDto>.Create([], request.Page, request.PageSize, 0);

            query = query.Where(r => r.DriverId == driver.Id);
        }
        else if (request.DriverId.HasValue)
        {
            query = query.Where(r => r.DriverId == request.DriverId.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.Q))
        {
            var pattern = $"%{request.Q.Trim()}%";
            query = query.Where(r => EF.Functions.Like(r.Name, pattern));
        }

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            query = query.Where(r => r.Status == request.Status);
        }

        if (request.VehicleId.HasValue)
        {
            query = query.Where(r => r.VehicleId == request.VehicleId.Value);
        }

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(r => RouteMapping.ToDto(r))
            .ToListAsync(cancellationToken);

        return PagedResult<RouteDto>.Create(items, request.Page, request.PageSize, totalCount);
    }
}
