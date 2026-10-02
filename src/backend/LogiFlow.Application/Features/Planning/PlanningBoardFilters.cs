using LogiFlow.Application.Features.Shipments;
using LogiFlow.Domain;

namespace LogiFlow.Application.Features.Planning;

/// <summary>
/// The board's filter set, kept as its own unit because it must stay in lockstep with the
/// LOGI-0007 shipment list: the same SQL-translatable BR-2 bound and the same case-insensitive
/// contains over referenceCode/destinationAddress. Mirroring rather than re-inventing is what makes
/// "the board and the list agree" (LOGI-0011 AC-9) stay true when either one changes.
/// </summary>
public static class PlanningBoardFilters
{
    public static IQueryable<Shipment> Apply(
        IQueryable<Shipment> query, GetPlanningBoardQuery request, DateTime cutoff) =>
        Apply(query, request.Status, request.Priority, request.OriginWarehouseId, request.RouteId,
            request.Q, request.SlaRisk, cutoff);

    /// <summary>
    /// The filter set itself, as plain values rather than as a board query. The LOGI-0012 dashboard
    /// applies the SAME predicate through this overload rather than writing its own, because AC-6
    /// makes every dashboard filter a <c>GET /shipments</c> filter — a second copy of these clauses
    /// is precisely how a tile would come to count rows its own drill-down list refuses to show.
    /// A filter the dashboard does not expose (slaRisk, q) simply arrives as null here.
    /// </summary>
    public static IQueryable<Shipment> Apply(
        IQueryable<Shipment> query, string? status, string? priority, long? originWarehouseId,
        long? routeId, string? q, bool? slaRisk, DateTime cutoff)
    {
        if (status is not null)
            query = query.Where(s => s.Status == status);

        if (priority is not null)
            query = query.Where(s => s.Priority == priority);

        if (originWarehouseId is not null)
            query = query.Where(s => s.OriginWarehouseId == originWarehouseId);

        // AC-5: an explicit routeId is an equality filter the dispatcher chose. It must NOT be
        // widened to "routeId = 7 OR routeId IS NULL" — that would silently return the unassigned
        // backlog too, the opposite of narrowing.
        if (routeId is not null)
            query = query.Where(s => s.RouteId == routeId);

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q;
            query = query.Where(s =>
                s.ReferenceCode.ToLower().Contains(term.ToLower())
                || s.DestinationAddress.ToLower().Contains(term.ToLower()));
        }

        if (slaRisk == true)
            query = query.Where(s =>
                s.SlaDueAt != null && s.SlaDueAt <= cutoff && !SlaPolicy.ExemptStatuses.Contains(s.Status));
        else if (slaRisk == false)
            query = query.Where(s =>
                s.SlaDueAt == null || s.SlaDueAt > cutoff || SlaPolicy.ExemptStatuses.Contains(s.Status));

        return query;
    }
}