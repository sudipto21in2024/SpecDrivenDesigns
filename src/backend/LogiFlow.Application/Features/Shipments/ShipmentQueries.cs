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
                h.Id, h.FromStatus, h.ToStatus, h.ChangedByUserId,
                // Spec §8: SQLite materializes DateTime as Kind=Unspecified — ticks are already
                // UTC, so re-mark the Kind (no conversion) and the API serializes the Z suffix.
                // Needed so changedAt compares equal to createdAt across endpoints (LOGI-0007 AC-1).
                DateTime.SpecifyKind(h.ChangedAt, DateTimeKind.Utc), h.Note))
            .ToListAsync(cancellationToken);

        return PagedResult<ShipmentStatusEventDto>.Create(items, request.Page, request.PageSize, totalCount);
    }
}

/// <summary>
/// AC-6..AC-9: paged shipment list/search (F8). Filters AND together; default order is newest
/// first; <c>slaRisk</c> filters on the BR-2 at-risk set and <c>atRisk</c> is projected per row
/// at read time (never stored — BR-sla-rules rule 2.5).
/// </summary>
public record ListShipmentsQuery(
    int Page = 1, int PageSize = 25, string? Status = null, string? Priority = null,
    long? OriginWarehouseId = null, bool? SlaRisk = null, string? Q = null, string? Sort = null)
    : IQuery<PagedResult<ShipmentDto>>;

public class ListShipmentsValidator : AbstractValidator<ListShipmentsQuery>
{
    private static readonly string[] Sorts = ["createdAt", "-createdAt", "slaDueAt", "-slaDueAt"];

    public ListShipmentsValidator()
    {
        RuleFor(x => x.Page).GreaterThanOrEqualTo(1);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 100);

        // AC-7/§7: unknown filter or sort values fail loudly (400) rather than silently paging
        // nothing. slaRisk itself is a bool? — the endpoint binder rejects non-booleans with 400.
        RuleFor(x => x.Status).Must(status => status is null || ShipmentStatusValues.IsKnown(status))
            .WithMessage($"status must be one of: {string.Join(", ", ShipmentStatusValues.All)}.");
        RuleFor(x => x.Priority).Must(priority => priority is null || SlaPolicy.IsKnownPriority(priority))
            .WithMessage($"priority must be one of: {string.Join(", ", SlaPolicy.Priorities)}.");
        RuleFor(x => x.Sort).Must(sort => sort is null || Sorts.Contains(sort))
            .WithMessage($"sort must be one of: {string.Join(", ", Sorts)}.");
    }
}

public class ListShipmentsHandler(IAppDbContext db)
    : IRequestHandler<ListShipmentsQuery, PagedResult<ShipmentDto>>
{
    public async Task<PagedResult<ShipmentDto>> Handle(ListShipmentsQuery request, CancellationToken cancellationToken)
    {
        // One request instant for both the filter cutoff and the per-row projection (AC-9).
        var now = SlaPolicy.TruncateToSeconds(DateTime.UtcNow);
        var cutoff = SlaPolicy.AtRiskCutoff(now);

        var query = db.Shipments.AsNoTracking();

        if (request.Status is not null)
        {
            query = query.Where(s => s.Status == request.Status);
        }

        if (request.Priority is not null)
        {
            query = query.Where(s => s.Priority == request.Priority);
        }

        if (request.OriginWarehouseId is not null)
        {
            query = query.Where(s => s.OriginWarehouseId == request.OriginWarehouseId);
        }

        if (!string.IsNullOrWhiteSpace(request.Q))
        {
            // §7 default: contains, case-insensitive, over referenceCode OR destinationAddress.
            var q = request.Q;
            query = query.Where(s =>
                s.ReferenceCode.ToLower().Contains(q.ToLower())
                || s.DestinationAddress.ToLower().Contains(q.ToLower()));
        }

        if (request.SlaRisk == true)
        {
            // BR-2 as a SQL-translatable bound (now >= due - 2h ⇔ due <= cutoff), plus the rule 2.3
            // exempt statuses — due <= cutoff alone would wrongly include Delivered/Cancelled.
            query = query.Where(s =>
                s.SlaDueAt != null && s.SlaDueAt <= cutoff && !SlaPolicy.ExemptStatuses.Contains(s.Status));
        }
        else if (request.SlaRisk == false)
        {
            // Exact complement of the at-risk set, null-due rows included (AC-9).
            query = query.Where(s =>
                s.SlaDueAt == null || s.SlaDueAt > cutoff || SlaPolicy.ExemptStatuses.Contains(s.Status));
        }

        var totalCount = await query.CountAsync(cancellationToken);

        // AC-8: newest first by default; slaDueAt sorts put null due dates last in BOTH directions;
        // ties break by id — descending for -createdAt, ascending otherwise — so pages never
        // duplicate or skip a row.
        query = request.Sort switch
        {
            "createdAt" => query.OrderBy(s => s.CreatedAt).ThenBy(s => s.Id),
            "slaDueAt" => query.OrderBy(s => s.SlaDueAt == null).ThenBy(s => s.SlaDueAt).ThenBy(s => s.Id),
            "-slaDueAt" => query.OrderBy(s => s.SlaDueAt == null).ThenByDescending(s => s.SlaDueAt).ThenBy(s => s.Id),
            "-createdAt" => query.OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id),
            _ => query.OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id),
        };

        var shipments = await query
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .ToListAsync(cancellationToken);

        // atRisk is projected in memory from the unit-tested SlaPolicy twin so the flag and the
        // slaRisk filter can never disagree (§5 risk note).
        var items = shipments.Select(s => ShipmentDto.From(s, now)).ToList();
        return PagedResult<ShipmentDto>.Create(items, request.Page, request.PageSize, totalCount);
    }
}