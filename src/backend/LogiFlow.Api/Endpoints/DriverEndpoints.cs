using LogiFlow.Api.Authorization;
using LogiFlow.Application.Features.Drivers;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain.Security;
using MediatR;

namespace LogiFlow.Api.Endpoints;

/// <summary>
/// Driver endpoints — implementation of the /drivers paths in contracts/v1-openapi.yaml.
///
/// Every operation's role requirement mirrors the contract's <c>x-roles</c> annotation exactly
/// (mirrors the vehicle matrix): reads are open to Admin/Dispatcher/Viewer, writes to
/// Admin/Dispatcher, and deletion is Admin-only. Driver-role accounts get 403 on every /drivers
/// operation — master data is not a driver-persona surface (spec §2). A missing/invalid token
/// yields 401; a valid token with the wrong role yields 403.
/// </summary>
public static class DriverEndpoints
{
    public static IEndpointRouteBuilder MapDriverEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/drivers").WithTags("Drivers");

        group.MapGet("/", async ([AsParameters] ListDriversQuery query, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(query, ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        group.MapGet("/{id:long}", async (long id, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new GetDriverByIdQuery(id), ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        group.MapPost("/", async (CreateDriverRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(
                new CreateDriverCommand(request.FullName, request.LicenseNumber, request.Phone, request.Status, request.UserId), ct);
            return Results.Created($"/api/v1/drivers/{dto.Id}", dto);
        })
            .RequireRoles(Roles.Admin, Roles.Dispatcher);

        group.MapPut("/{id:long}", async (long id, CreateDriverRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(
                new UpdateDriverCommand(id, request.FullName, request.LicenseNumber, request.Phone, request.Status, request.UserId), ct);
            return Results.Ok(dto);
        })
            .RequireRoles(Roles.Admin, Roles.Dispatcher);

        group.MapDelete("/{id:long}", async (long id, ISender sender, CancellationToken ct) =>
        {
            await sender.Send(new DeleteDriverCommand(id), ct);
            return Results.NoContent();
        })
            .RequireRoles(Roles.Admin);

        return app;
    }
}

/// <summary>Request body for create/update (contract schema: DriverRequest).</summary>
public record CreateDriverRequest(string FullName, string LicenseNumber, string? Phone, string? Status, long? UserId);