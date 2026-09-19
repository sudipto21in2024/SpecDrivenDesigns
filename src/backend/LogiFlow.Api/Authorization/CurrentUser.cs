using LogiFlow.Application.Abstractions;
using Microsoft.AspNetCore.Authorization;

namespace LogiFlow.Api.Authorization;

/// <summary>
/// Projects the authenticated principal from the JWT onto the Application layer's
/// <see cref="ICurrentUser"/> seam (ADR-007), so handlers can ask "who is calling?" without any
/// dependency on ASP.NET Core.
/// </summary>
public class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private readonly System.Security.Claims.ClaimsPrincipal? _principal = accessor.HttpContext?.User;

    /// <summary>
    /// The JWT `sub` claim. JwtBearer maps `sub` onto ClaimTypes.NameIdentifier by default, but the
    /// raw claim is checked as a fallback so this keeps working if claim mapping is ever disabled.
    /// </summary>
    public long? UserId =>
        long.TryParse(
            _principal?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                ?? _principal?.FindFirst("sub")?.Value,
            out var id)
            ? id
            : null;

    public string? Email =>
        _principal?.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value
        ?? _principal?.FindFirst("email")?.Value;

    public string? Role => _principal?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value;

    public bool IsAuthenticated => _principal?.Identity?.IsAuthenticated ?? false;
}

/// <summary>Endpoint helpers that turn the contract's <c>x-roles</c> annotations into policies.</summary>
public static class RoleAuthorization
{
    /// <summary>
    /// Requires an authenticated caller holding <em>any</em> of <paramref name="roles"/>.
    ///
    /// Semantics deliberately match the OpenAPI <c>x-roles</c> lists, which enumerate the roles
    /// allowed on an operation: the list is a whitelist, not a conjunction. A failed role check
    /// yields 403 (authenticated but not permitted), while a missing/invalid token yields 401.
    /// </summary>
    public static TBuilder RequireRoles<TBuilder>(this TBuilder builder, params string[] roles)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentOutOfRangeException.ThrowIfZero(roles.Length);
        var policy = new AuthorizationPolicyBuilder().RequireRole(roles).Build();
        return builder.RequireAuthorization(policy);
    }
}