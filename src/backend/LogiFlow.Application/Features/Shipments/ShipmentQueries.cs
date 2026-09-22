using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Shipments;

/// <summary>
/// AC-7: paged, immutable audit trail for one shipment, ordered oldest → newest
/// (changed_at asc, id asc). 404 when the shipment itself does not exist (AC-6).
/// </summary>
public record ListShipmentStatusHistoryQuery(long ShipmentId, int Page = 1, int PageSize = 25)
    : IQuery<PagedResult<ShipmentStatusEventDto>>;

public class ListShipmentStatusHistoryValidator : AbstractValidator<ListShipmentStatusHistoryQuery>
{
    public ListShipmentStatusHistoryValidator()
    {
        RuleFor(x => x.ShipmentId).GreaterThan(0);
        RuleFor(x => x.Page).GreaterThanOrEqualTo(1);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 100);
    }
}

public class ListShipmentStatusHistoryHandler(IAppDbContext db)
    : IRequestHandler<ListShipmentStatusHistoryQuery, PagedResult<ShipmentStatusEventDto>>
{
    public async Task<PagedResult<ShipmentStatusEventDto>> Handle(ListShipmentStatusHistoryQuery request, CancellationToken cancellationToken)
    {
        var shipmentExists = await db.Shipments
            .AnyAsync(s => s.Id == request.ShipmentId, cancellationToken);
        if (!shipmentExists)
        {
            throw new NotFoundException(nameof(Domain.Shipment), request.ShipmentId);
        }

        var query = db.ShipmentStatusHistory.AsNoTracking()
            .Where(h => h.ShipmentId == request.ShipmentId);

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderBy(h => h.ChangedAt)
            .ThenBy(h => h.Id)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(h => new ShipmentStatusEventDto(
                h.Id, h.FromStatus, h.ToStatus, h.ChangedByUserId, h.ChangedAt, h.Note))
            .ToListAsync(cancellationToken);

        return PagedResult<ShipmentStatusEventDto>.Create(items, request.Page, request.PageSize, totalCount);
    }
}