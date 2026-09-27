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

        return app;
    }
}
