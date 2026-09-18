using LogiFlow.Application.Features.Warehouses;
using LogiFlow.Application.Messaging;
using MediatR;

namespace LogiFlow.Api.Endpoints;

/// <summary>Warehouse endpoints — implementation of the /warehouses paths in contracts/v1-openapi.yaml.</summary>
public static class WarehouseEndpoints
{
    public static IEndpointRouteBuilder MapWarehouseEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/warehouses").WithTags("Warehouses");

        group.MapGet("/", async ([AsParameters] ListWarehousesQuery query, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(query, ct)));

        group.MapGet("/{id:long}", async (long id, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new GetWarehouseByIdQuery(id), ct)));

        group.MapPost("/", async (CreateWarehouseRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(
                new CreateWarehouseCommand(request.Name, request.Address, request.Latitude, request.Longitude), ct);
            return Results.Created($"/api/v1/warehouses/{dto.Id}", dto);
        });

        group.MapPut("/{id:long}", async (long id, CreateWarehouseRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(
                new UpdateWarehouseCommand(id, request.Name, request.Address, request.Latitude, request.Longitude), ct);
            return Results.Ok(dto);
        });

        group.MapDelete("/{id:long}", async (long id, ISender sender, CancellationToken ct) =>
        {
            await sender.Send(new DeleteWarehouseCommand(id), ct);
            return Results.NoContent();
        });

        return app;
    }
}

/// <summary>Request body for create/update (contract schema: WarehouseRequest).</summary>
public record CreateWarehouseRequest(string Name, string Address, double? Latitude, double? Longitude);
