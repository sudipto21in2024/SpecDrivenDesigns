using LogiFlow.Api.Authorization;
using LogiFlow.Application.Features.Dashboard;
using LogiFlow.Domain.Security;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace LogiFlow.Api.Endpoints;

/// <summary>
/// LOGI-0012: the operations dashboard (PRD F14). One read-only GET — the at-risk flag is the
/// read-time BR-2 projection, not stored state, so there is nothing here that could be written.
/// </summary>
public static class DashboardEndpoints
{
    public static IEndpointRouteBuilder MapDashboardEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/dashboard")
            .RequireAuthorization();

        // Roles are Admin, Dispatcher, Viewer (spec O1): Driver is deliberately absent, on exactly
        // the LOGI-0011 O1 argument — the dashboard is org-wide while BR-6 and F12 scope a Driver to
        // their own route. A 200 would have to mean "of what you may see", and the utilization
        // figures would become "of the fleet you can see" rather than "of the fleet". Omitting the
        // role here is the whole enforcement; there is no handler branch to keep in sync.
        //
        // Parameters are bound explicitly rather than via [AsParameters]: every one is optional and
        // the endpoint must apply the contract defaults (page 1, pageSize 20) itself, so the record
        // is constructed here rather than bound wholesale.
        group.MapGet("/", async (
            string? status,
            string? priority,
            long? originWarehouseId,
            long? routeId,
            int? page,
            int? pageSize,
            ISender sender,
            CancellationToken ct) =>
        {
            var result = await sender.Send(
                new GetDashboardQuery(status, priority, originWarehouseId, routeId,
                    page ?? 1, pageSize ?? 20), ct);
            return Results.Ok(result);
        }).RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        return app;
    }
}