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
    long? OriginWarehouseId = null, long? RouteId = null, bool? SlaRisk = null, string? Q = null,
    string? Sort = null) : IQuery<PagedResult<ShipmentDto>>;

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

        // AC-6: the contract's routeId minimum is 1, so 0/negatives fail loudly rather than
        // quietly matching an empty page — the same lie as an unknown status enum above.
        RuleFor(x => x.RouteId).GreaterThan(0).When(x => x.RouteId.HasValue)
            .WithMessage("routeId must be greater than 0.");
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

        if (request.Status is not null) query = query.Where(s => s.Status == request.Status);

        if (request.Priority is not null) query = query.Where(s => s.Priority == request.Priority);

        if (request.OriginWarehouseId is not null)
            query = query.Where(s => s.OriginWarehouseId == request.OriginWarehouseId);

        // AC-6: an explicit routeId is an equality filter, NOT widened to
        // "routeId = 7 OR routeId IS NULL" — that would smuggle in the unassigned backlog. Same rule
        // and reason as PlanningBoardFilters.Apply: AC-6 makes this the vocabulary the dashboard and
        // the board drill down with, so the two endpoints must not drift.
        if (request.RouteId is not null) query = query.Where(s => s.RouteId == request.RouteId);

        if (!string.IsNullOrWhiteSpace(request.Q))
        {
            // §7 default: contains, case-insensitive, over referenceCode OR destinationAddress.
            var q = request.Q.ToLower();
            query = query.Where(s =>
                s.ReferenceCode.ToLower().Contains(q)
                || s.DestinationAddress.ToLower().Contains(q));
        }

        // BR-2 as a SQL-translatable bound (now >= due - 2h ⇔ due <= cutoff), plus the rule 2.3
        // exempt statuses — due <= cutoff alone would wrongly include Delivered/Cancelled. The
        // false branch is the exact complement, null-due rows included (AC-9).
        if (request.SlaRisk == true)
            query = query.Where(s =>
                s.SlaDueAt != null && s.SlaDueAt <= cutoff && !SlaPolicy.ExemptStatuses.Contains(s.Status));
        else if (request.SlaRisk == false)
            query = query.Where(s =>
                s.SlaDueAt == null || s.SlaDueAt > cutoff || SlaPolicy.ExemptStatuses.Contains(s.Status));

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

/// <summary>
/// AC-5/AC-6: one shipment in the same ShipmentResponse shape the list rows use — including the
/// read-time BR-2 <c>atRisk</c> flag and <c>routeId</c> (null until LOGI-0010) — and 404 when the id
/// is unknown. This is the detail read LOGI-0007 §5 deferred to LOGI-0008 because the edit form
/// needs it.
/// </summary>
public record GetShipmentQuery(long Id) : IQuery<ShipmentDto>;

public class GetShipmentValidator : AbstractValidator<GetShipmentQuery>
{
    public GetShipmentValidator() => RuleFor(x => x.Id).GreaterThan(0);
}

public class GetShipmentHandler(IAppDbContext db) : IRequestHandler<GetShipmentQuery, ShipmentDto>
{
    public async Task<ShipmentDto> Handle(GetShipmentQuery request, CancellationToken cancellationToken)
    {
        // Read-only: AsNoTracking keeps the detail path out of the change tracker entirely.
        var shipment = await db.Shipments.AsNoTracking()
            .SingleOrDefaultAsync(s => s.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Shipment), request.Id);

        // One request instant, truncated to the whole second (BR-sla-rules §3), so the at-risk flag
        // can never disagree with the list endpoint's projection for the same shipment.
        return ShipmentDto.From(shipment, SlaPolicy.TruncateToSeconds(DateTime.UtcNow));
    }
}