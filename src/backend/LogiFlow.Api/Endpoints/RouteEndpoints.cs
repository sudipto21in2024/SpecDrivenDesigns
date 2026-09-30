using System.Text.Json;
using LogiFlow.Api.Authorization;
using LogiFlow.Application.Features.Routes;
using LogiFlow.Domain.Security;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace LogiFlow.Api.Endpoints;

public static class RouteEndpoints
{
    public static IEndpointRouteBuilder MapRouteEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/routes")
            .RequireAuthorization();

        group.MapGet("/", async (
            [AsParameters] ListRoutesQuery query,
            ISender sender,
            CancellationToken ct) =>
        {
            var result = await sender.Send(query, ct);
            return Results.Ok(result);
        }).RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer, Roles.Driver);

        group.MapGet("/{id:long}", async (
            long id,
            ISender sender,
            CancellationToken ct) =>
        {
            var result = await sender.Send(new GetRouteByIdQuery(id), ct);
            return Results.Ok(result);
        }).RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer, Roles.Driver);

        group.MapPost("/", async (
            [FromBody] JsonElement body,
            ISender sender,
            CancellationToken ct) =>
        {
            var command = RoutePayloadParsers.ParseCreate(body);
            var result = await sender.Send(command, ct);
            return Results.Created($"/api/v1/routes/{result.Id}", result);
        }).RequireRoles(Roles.Admin, Roles.Dispatcher);

        group.MapPatch("/{id:long}", async (
            long id,
            [FromBody] JsonElement body,
            ISender sender,
            CancellationToken ct) =>
        {
            var command = RoutePayloadParsers.ParseUpdate(id, body);
            var result = await sender.Send(command, ct);
            return Results.Ok(result);
        }).RequireRoles(Roles.Admin, Roles.Dispatcher);

        // LOGI-0010: shipment↔route assignment. The route id is bound by the template, so the only
        // caller-supplied input is the body — hence ParseAssign rather than [AsParameters].
        group.MapPost("/{id:long}/shipments", async (
            long id,
            [FromBody] JsonElement body,
            ISender sender,
            CancellationToken ct) =>
        {
            var command = RoutePayloadParsers.ParseAssign(id, body);
            var result = await sender.Send(command, ct);
            return Results.Ok(result);
        }).RequireRoles(Roles.Admin, Roles.Dispatcher);

        // Page/pageSize are taken explicitly rather than via [AsParameters]: the query record also
        // carries RouteId, which is bound by the route template and is not a legal query-string
        // parameter, so [AsParameters] would reject every request with a 400.
        group.MapGet("/{id:long}/shipments", async (
            long id,
            int? page,
            int? pageSize,
            ISender sender,
            CancellationToken ct) =>
        {
            var result = await sender.Send(
                new ListRouteShipmentsQuery(id, page ?? 1, pageSize ?? 25), ct);
            return Results.Ok(result);
        }).RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer, Roles.Driver);

        group.MapDelete("/{id:long}/shipments/{shipmentId:long}", async (
            long id,
            long shipmentId,
            ISender sender,
            CancellationToken ct) =>
        {
            await sender.Send(new RemoveShipmentFromRouteCommand(id, shipmentId), ct);
            return Results.NoContent();
        }).RequireRoles(Roles.Admin, Roles.Dispatcher);

        return app;
    }
}
