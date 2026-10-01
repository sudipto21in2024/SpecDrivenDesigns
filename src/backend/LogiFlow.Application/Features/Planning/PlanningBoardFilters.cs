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
        IQueryable<Shipment> query, GetPlanningBoardQuery request, DateTime cutoff)
    {
        if (request.Status is not null)
            query = query.Where(s => s.Status == request.Status);

        if (request.Priority is not null)
            query = query.Where(s => s.Priority == request.Priority);

        if (request.OriginWarehouseId is not null)
            query = query.Where(s => s.OriginWarehouseId == request.OriginWarehouseId);

        // AC-5: an explicit routeId is an equality filter the dispatcher chose. It must NOT be
        // widened to "routeId = 7 OR routeId IS NULL" — that would silently return the unassigned
        // backlog too, the opposite of narrowing.
        if (request.RouteId is not null)
            query = query.Where(s => s.RouteId == request.RouteId);

        if (!string.IsNullOrWhiteSpace(request.Q))
        {
            var q = request.Q;
            query = query.Where(s =>
                s.ReferenceCode.ToLower().Contains(q.ToLower())
                || s.DestinationAddress.ToLower().Contains(q.ToLower()));
        }

        if (request.SlaRisk == true)
            query = query.Where(s =>
                s.SlaDueAt != null && s.SlaDueAt <= cutoff && !SlaPolicy.ExemptStatuses.Contains(s.Status));
        else if (request.SlaRisk == false)
            query = query.Where(s =>
                s.SlaDueAt == null || s.SlaDueAt > cutoff || SlaPolicy.ExemptStatuses.Contains(s.Status));

        return query;
    }
}