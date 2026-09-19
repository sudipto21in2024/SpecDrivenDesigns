using LogiFlow.Api.Authorization;
using LogiFlow.Application.Features.Warehouses;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain.Security;
using MediatR;

namespace LogiFlow.Api.Endpoints;

/// <summary>
/// Warehouse endpoints — implementation of the /warehouses paths in contracts/v1-openapi.yaml.
///
/// Every operation's role requirement mirrors the contract's <c>x-roles</c> annotation exactly
/// (LOGI-0003 AC-5, AC-6): reads are open to Admin/Dispatcher/Viewer, writes to Admin/Dispatcher,
/// and deletion is Admin-only. A missing/invalid token yields 401; a valid token with the wrong
/// role yields 403.
/// </summary>
public static class WarehouseEndpoints
{
    public static IEndpointRouteBuilder MapWarehouseEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/warehouses").WithTags("Warehouses");

        group.MapGet("/", async ([AsParameters] ListWarehousesQuery query, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(query, ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        group.MapGet("/{id:long}", async (long id, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new GetWarehouseByIdQuery(id), ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        group.MapPost("/", async (CreateWarehouseRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(
                new CreateWarehouseCommand(request.Name, request.Address, request.Latitude, request.Longitude), ct);
            return Results.Created($"/api/v1/warehouses/{dto.Id}", dto);
        })
            .RequireRoles(Roles.Admin, Roles.Dispatcher);

        group.MapPut("/{id:long}", async (long id, CreateWarehouseRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(
                new UpdateWarehouseCommand(id, request.Name, request.Address, request.Latitude, request.Longitude), ct);
            return Results.Ok(dto);
        })
            .RequireRoles(Roles.Admin, Roles.Dispatcher);

        group.MapDelete("/{id:long}", async (long id, ISender sender, CancellationToken ct) =>
        {
            await sender.Send(new DeleteWarehouseCommand(id), ct);
            return Results.NoContent();
        })
            .RequireRoles(Roles.Admin);

        return app;
    }
}

/// <summary>Request body for create/update (contract schema: WarehouseRequest).</summary>
public record CreateWarehouseRequest(string Name, string Address, double? Latitude, double? Longitude);
