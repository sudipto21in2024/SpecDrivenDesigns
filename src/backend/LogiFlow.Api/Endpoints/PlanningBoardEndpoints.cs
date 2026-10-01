using LogiFlow.Api.Authorization;
using LogiFlow.Application.Features.Planning;
using LogiFlow.Domain.Security;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace LogiFlow.Api.Endpoints;

/// <summary>
/// LOGI-0011: the dispatcher's planning board (PRD F11). One read-only GET (spec O3) — a status
/// transition and an assignment keep their own endpoints, so this adds no write verb at all.
/// </summary>
public static class PlanningBoardEndpoints
{
    public static IEndpointRouteBuilder MapPlanningBoardEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/planning-board")
            .RequireAuthorization();

        // Roles are Admin, Dispatcher, Viewer (spec O1): Driver is deliberately absent. The board is
        // org-wide, while BR-6 and the LOGI-0009/0010 rule scope a Driver to their own route — and
        // the column counts would be wrong for them under any implicit filter. Omitting the role
        // here is the whole enforcement; there is no handler branch to keep in sync.
        //
        // Parameters are bound explicitly rather than via [AsParameters]: every one is optional and
        // the endpoint must apply the contract defaults (maxPerColumn 50, sort slaDueAt) itself, so
        // the record is constructed here rather than bound wholesale.
        group.MapGet("/", async (
            string? status,
            string? priority,
            long? originWarehouseId,
            bool? slaRisk,
            long? routeId,
            string? q,
            string? sort,
            int? maxPerColumn,
            ISender sender,
            CancellationToken ct) =>
        {
            var result = await sender.Send(
                new GetPlanningBoardQuery(status, priority, originWarehouseId, slaRisk,
                    routeId, q, sort, maxPerColumn ?? 50), ct);
            return Results.Ok(result);
        }).RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        return app;
    }
}