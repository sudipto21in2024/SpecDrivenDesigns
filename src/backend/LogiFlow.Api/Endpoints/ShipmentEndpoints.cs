using LogiFlow.Api.Authorization;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Domain.Security;
using MediatR;

namespace LogiFlow.Api.Endpoints;

/// <summary>
/// Shipment status lifecycle endpoints — implementation of the /shipments/{id}/status-transitions
/// and /shipments/{id}/status-history paths in contracts/v1-openapi.yaml.
///
/// Every operation's role requirement mirrors the contract's <c>x-roles</c> annotation exactly:
/// transitions are open to Admin/Dispatcher/Driver, history reads additionally to Viewer.
/// (Driver-role own-route ownership scoping is enforced from LOGI-0009/0010 — documented
/// deferral, LOGI-0006 checkpoint answer 4.) A missing/invalid token yields 401; a valid token
/// with the wrong role yields 403.
/// </summary>
public static class ShipmentEndpoints
{
    public static IEndpointRouteBuilder MapShipmentEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/shipments").WithTags("Shipments");

        // Contract: POST /shipments/{id}/status-transitions — 200 with the event echo; 400 (AC-5),
        // 404 (AC-6), 409 (AC-4 — the ProblemDetails detail names the legal next states per BR-7).
        group.MapPost("/{id:long}/status-transitions", async (long id, TransitionShipmentStatusRequest request, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new TransitionShipmentStatusCommand(id, request.ToStatus, request.Note), ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Driver);

        // Contract: GET /shipments/{id}/status-history — 200 paged, oldest → newest (AC-7);
        // 404 when the shipment does not exist (AC-6).
        group.MapGet("/{id:long}/status-history", async (long id, int? page, int? pageSize, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new ListShipmentStatusHistoryQuery(id, page ?? 1, pageSize ?? 25), ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Driver, Roles.Viewer);

        return app;
    }
}

/// <summary>Request body for a status transition (contract schema: StatusTransitionRequest).</summary>
public record TransitionShipmentStatusRequest(string? ToStatus, string? Note);