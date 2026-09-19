namespace LogiFlow.Application.Abstractions;

/// <summary>
/// The authenticated principal of the current request, projected from the JWT's claims (ADR-007).
/// Implemented in the API layer over <c>HttpContext.User</c> so Application handlers can answer
/// "who is asking?" without referencing ASP.NET Core.
/// </summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }

    /// <summary>The user id from the `sub` claim, or null when unauthenticated.</summary>
    long? UserId { get; }

    /// <summary>The email from the `email` claim, or null when unauthenticated.</summary>
    string? Email { get; }

    /// <summary>The role claim value, or null when unauthenticated.</summary>
    string? Role { get; }
}
