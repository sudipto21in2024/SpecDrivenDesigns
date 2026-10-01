using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Features.Routes;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Planning;

/// <summary>
/// The dispatcher's whole day in one read (LOGI-0011 / PRD F11): every shipment as a kanban column
/// per BR-7 status plus the route cards with their BR-5 capacity bars. Read-only by design
/// (spec O3) — a status transition and an assignment already own their guards and history rows.
///
/// Filters are the LOGI-0007 shipment-list filters plus routeId, AND-combined, echoed back so the
/// UI can restore them (AC-3).
/// </summary>
public record GetPlanningBoardQuery(
    string? Status = null, string? Priority = null, long? OriginWarehouseId = null,
    bool? SlaRisk = null, long? RouteId = null, string? Q = null, string? Sort = null,
    int MaxPerColumn = 50) : IQuery<PlanningBoardResponse>;

public class GetPlanningBoardValidator : AbstractValidator<GetPlanningBoardQuery>
{
    private static readonly string[] Sorts = ["slaDueAt", "-slaDueAt", "createdAt", "-createdAt"];

    public GetPlanningBoardValidator()
    {
        // AC-8: unknown enum/sort values fail loudly rather than silently returning an empty board.
        RuleFor(x => x.Status).Must(s => s is null || ShipmentStatusValues.IsKnown(s))
            .WithMessage($"status must be one of: {string.Join(", ", ShipmentStatusValues.All)}.");
        RuleFor(x => x.Priority).Must(p => p is null || SlaPolicy.IsKnownPriority(p))
            .WithMessage($"priority must be one of: {string.Join(", ", SlaPolicy.Priorities)}.");
        RuleFor(x => x.Sort).Must(s => s is null || Sorts.Contains(s))
            .WithMessage($"sort must be one of: {string.Join(", ", Sorts)}.");
        RuleFor(x => x.OriginWarehouseId).GreaterThan(0).When(x => x.OriginWarehouseId.HasValue);
        RuleFor(x => x.RouteId).GreaterThan(0).When(x => x.RouteId.HasValue);
        // Contract: maxPerColumn default 50, max 200 (board cards are small, but a 1000-card column
        // would render an unusable wall and blow the payload budget).
        RuleFor(x => x.MaxPerColumn).InclusiveBetween(1, 200);
    }
}

public class GetPlanningBoardHandler(IAppDbContext db)
    : IRequestHandler<GetPlanningBoardQuery, PlanningBoardResponse>
{
    public async Task<PlanningBoardResponse> Handle(GetPlanningBoardQuery request, CancellationToken cancellationToken)
    {
        // One request instant for the whole board (AC-9): the cutoff bound, every card's atRisk flag
        // and generatedAt all read the same truncated "now", so no card can disagree with another
        // or with GET /shipments called at the same moment.
        var now = SlaPolicy.TruncateToSeconds(DateTime.UtcNow);
        var cutoff = SlaPolicy.AtRiskCutoff(now);

        var query = PlanningBoardFilters.Apply(db.Shipments.AsNoTracking(), request, cutoff);

        // AC-5: the unassigned backlog is a count over the FILTERED set, so it follows every filter
        // the cards do.
        var unassignedTotalCount = await query.CountAsync(s => s.RouteId == null, cancellationToken);

        // One group-by for all six counts instead of six paged queries (spec §6 note). Computed over
        // the filtered set so AC-3's "only matching shipments" holds for the counts too, not just
        // for the cards.
        var counts = await query
            .GroupBy(s => s.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Status, x => x.Count, cancellationToken);

        // Default order is slaDueAt ascending with id as the tiebreak (AC-9): equal due dates must
        // never reorder between requests, or the board would shuffle under the dispatcher's cursor.
        // This deliberately differs from GET /shipments (newest first) — the board is deadline-first.
        var ordered = request.Sort switch
        {
            "-slaDueAt" => query.OrderBy(s => s.SlaDueAt == null).ThenByDescending(s => s.SlaDueAt).ThenBy(s => s.Id),
            "createdAt" => query.OrderBy(s => s.CreatedAt).ThenBy(s => s.Id),
            "-createdAt" => query.OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id),
            _ => query.OrderBy(s => s.SlaDueAt == null).ThenBy(s => s.SlaDueAt).ThenBy(s => s.Id),
        };

        // One window across all statuses: per-status paging in SQL would mean six round trips, and
        // the set is already bounded by maxPerColumn x 6.
        var rows = await ordered
            .Take(request.MaxPerColumn * ShipmentStatusValues.All.Count)
            .Select(s => ShipmentDto.From(s, now))
            .ToListAsync(cancellationToken);

        // O2: the column set and its order come from ShipmentStatusValues.All, which is already the
        // BR-7 lifecycle order — so the order is correct by construction rather than by a literal
        // that can drift from the enum. Empty columns are emitted (AC-1): a column the client
        // doesn't know about is a column it can't render as "0".
        var columns = ShipmentStatusValues.All
            .Select(status =>
            {
                // AC-8: cap PER COLUMN here as well as in the SQL window. The window above only
                // bounds the total across all six columns, so a filtered board (say status=Delayed)
                // could otherwise return more than maxPerColumn cards in the one column it has.
                var inColumn = rows.Where(r => r.Status == status).Take(request.MaxPerColumn).ToList();
                var total = counts.GetValueOrDefault(status);
                return new BoardColumn(status, total, total > inColumn.Count,
                    inColumn.Select(BoardShipmentCard.From).ToList());
            })
            .ToList();

        var routes = await BuildRouteCardsAsync(request, cutoff, cancellationToken);

        return new PlanningBoardResponse(
            now,
            new BoardFilters(
                request.Status, request.Priority, request.OriginWarehouseId, request.SlaRisk,
                request.RouteId, request.Q, request.Sort ?? "slaDueAt", request.MaxPerColumn),
            columns,
            unassignedTotalCount,
            routes);
    }
/// <summary>
    /// Route cards for every Planned route, plus any route the filtered cards reference — so the
    /// capacity bar stays visible for an InProgress route that still has cards on it. Capacity
    /// comes from the LOGI-0010 factory (O4): one BR-5 implementation, so this bar cannot disagree
    /// with the guard.
    /// </summary>
    private async Task<IReadOnlyList<BoardRouteCard>> BuildRouteCardsAsync(
        GetPlanningBoardQuery request, DateTime cutoff, CancellationToken cancellationToken)
    {
        var allRoutes = await db.Routes.AsNoTracking()
            .OrderBy(r => r.Id)
            .ToListAsync(cancellationToken);

        var referenced = await PlanningBoardFilters.Apply(db.Shipments.AsNoTracking(), request, cutoff)
            .Where(s => s.RouteId != null)
            .Select(s => s.RouteId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);

        var wanted = referenced.ToHashSet();

        var cards = new List<BoardRouteCard>();
        foreach (var route in allRoutes)
        {
            if (route.Status != RouteStatusValues.Planned && !wanted.Contains(route.Id))
                continue;

            var capacity = await RouteCapacityViewFactory.BuildAsync(db, route, cancellationToken);
            cards.Add(BoardRouteCard.From(route, capacity));
        }

        return cards;
    }
}