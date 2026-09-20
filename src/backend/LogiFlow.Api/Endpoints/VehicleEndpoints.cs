using LogiFlow.Api.Authorization;
using LogiFlow.Application.Features.Vehicles;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain.Security;
using MediatR;

namespace LogiFlow.Api.Endpoints;

/// <summary>
/// Vehicle endpoints — implementation of the /vehicles paths in contracts/v1-openapi.yaml.
///
/// Every operation's role requirement mirrors the contract's <c>x-roles</c> annotation exactly
/// (mirrors the warehouse matrix): reads are open to Admin/Dispatcher/Viewer, writes to
/// Admin/Dispatcher, and deletion is Admin-only. A missing/invalid token yields 401; a valid
/// token with the wrong role yields 403.
/// </summary>
public static class VehicleEndpoints
{
    public static IEndpointRouteBuilder MapVehicleEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/vehicles").WithTags("Vehicles");

        group.MapGet("/", async ([AsParameters] ListVehiclesQuery query, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(query, ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        group.MapGet("/{id:long}", async (long id, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new GetVehicleByIdQuery(id), ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        group.MapPost("/", async (CreateVehicleRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(
                new CreateVehicleCommand(request.PlateNumber, request.Type, request.CapacityKg, request.Status), ct);
            return Results.Created($"/api/v1/vehicles/{dto.Id}", dto);
        })
            .RequireRoles(Roles.Admin, Roles.Dispatcher);

        group.MapPut("/{id:long}", async (long id, CreateVehicleRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(
                new UpdateVehicleCommand(id, request.PlateNumber, request.Type, request.CapacityKg, request.Status), ct);
            return Results.Ok(dto);
        })
            .RequireRoles(Roles.Admin, Roles.Dispatcher);

        group.MapDelete("/{id:long}", async (long id, ISender sender, CancellationToken ct) =>
        {
            await sender.Send(new DeleteVehicleCommand(id), ct);
            return Results.NoContent();
        })
            .RequireRoles(Roles.Admin);

        return app;
    }
}

/// <summary>Request body for create/update (contract schema: VehicleRequest).</summary>
public record CreateVehicleRequest(string PlateNumber, string Type, double CapacityKg, string? Status);
