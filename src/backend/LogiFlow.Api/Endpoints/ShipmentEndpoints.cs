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

        // Contract: GET /shipments — 200 paged envelope (AC-6..AC-9); invalid page/pageSize or an
        // unknown filter/sort enum → 400 (spec §7). Driver is excluded until own-route scoping
        // lands (LOGI-0009/0010, spec §7 / AC-10).
        group.MapGet("/", async ([AsParameters] ListShipmentsQuery query, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(query, ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        // Contract: POST /shipments — 201 with ShipmentResponse (AC-1); 400 field-keyed validation
        // (AC-3/AC-4), 409 when the reference-code retry budget is exhausted (AC-5).
        group.MapPost("/", async (CreateShipmentRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(new CreateShipmentCommand(
                request.OriginWarehouseId, request.DestinationAddress, request.WeightKg,
                request.Priority, request.DestinationLat, request.DestinationLng), ct);
            return Results.Created($"/api/v1/shipments/{dto.Id}", dto);
        })
            .RequireRoles(Roles.Admin, Roles.Dispatcher);

        return app;
    }
}

/// <summary>Request body for a status transition (contract schema: StatusTransitionRequest).</summary>
public record TransitionShipmentStatusRequest(string? ToStatus, string? Note);

/// <summary>
/// Request body for create (contract schema: ShipmentRequest). Server-owned fields —
/// referenceCode, status, slaDueAt, createdAt/updatedAt, id — are never accepted from the client
/// and are ignored when supplied (BR-1 rule 1.2 / AC-2).
/// </summary>
public record CreateShipmentRequest(
    long OriginWarehouseId, string? DestinationAddress, double WeightKg, string? Priority,
    double? DestinationLat, double? DestinationLng);