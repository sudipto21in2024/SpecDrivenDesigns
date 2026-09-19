using LogiFlow.Application.Features.Auth;
using LogiFlow.Application.Messaging;
using MediatR;
using Microsoft.AspNetCore.Authorization;

namespace LogiFlow.Api.Endpoints;

/// <summary>
/// Auth endpoints — implementation of the /auth paths in contracts/v1-openapi.yaml (LOGI-0003).
/// All three token endpoints are anonymous by definition; /auth/me requires a valid access token.
/// </summary>
public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/auth").WithTags("Auth");

        group.MapPost("/login", async (LoginRequest request, ISender sender, CancellationToken ct) =>
        {
            var tokens = await sender.Send(new LoginCommand(request.Email, request.Password), ct);
            return Results.Ok(tokens);
        })
        .AllowAnonymous()
        .WithName("login");

        group.MapPost("/refresh", async (RefreshRequest request, ISender sender, CancellationToken ct) =>
        {
            // Rotation happens in the handler: the presented token is revoked and replaced atomically.
            var tokens = await sender.Send(new RefreshCommand(request.RefreshToken), ct);
            return Results.Ok(tokens);
        })
        .AllowAnonymous()
        .WithName("refresh");

        group.MapPost("/logout", async (RefreshRequest request, ISender sender, CancellationToken ct) =>
        {
            await sender.Send(new LogoutCommand(request.RefreshToken), ct);
            return Results.NoContent();
        })
        .AllowAnonymous()
        .WithName("logout");

        group.MapGet("/me", async (ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new GetCurrentUserQuery(), ct)))
        .RequireAuthorization()
        .WithName("getCurrentUser");

        return app;
    }
}

/// <summary>Request body for login (contract schema: LoginRequest).</summary>
public record LoginRequest(string Email, string Password);

/// <summary>Request body for refresh/logout (contract schema: RefreshRequest).</summary>
public record RefreshRequest(string RefreshToken);