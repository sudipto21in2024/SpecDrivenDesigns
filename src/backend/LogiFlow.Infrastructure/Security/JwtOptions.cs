namespace LogiFlow.Infrastructure.Security;

/// <summary>
/// JWT/token settings bound from the <c>Jwt</c> configuration section (ADR-007).
///
/// The signing key is expected from configuration (user-secrets locally, environment variable or
/// secret store when deployed) and is never committed. <see cref="DevelopmentKey"/> keeps the
/// scaffold runnable when no key is configured — it is gated to Development/Testing by
/// <c>Infrastructure.DependencyInjection</c> so it can never sign tokens in production.
/// </summary>
public class JwtOptions
{
    public const string SectionName = "Jwt";

    /// <summary>Symmetric signing key (HMAC-SHA256). Must be at least 32 bytes.</summary>
    public string? SigningKey { get; set; }

    public string Issuer { get; set; } = "logiflow";

    public string Audience { get; set; } = "logiflow-api";

    /// <summary>Access token lifetime in minutes (contract: TokenResponse.expiresIn = seconds).</summary>
    public int AccessTokenMinutes { get; set; } = 15;

    /// <summary>Refresh token lifetime in days (single-use, rotated on exchange).</summary>
    public int RefreshTokenDays { get; set; } = 7;

    /// <summary>
    /// Development-only fallback key. 64 ASCII characters (512 bits) — comfortably above the HS256
    /// minimum, and obviously non-secret by name so it cannot be mistaken for production material.
    /// </summary>
    public const string DevelopmentKey = "logiflow-development-only-signing-key-do-not-use-in-production-64ch";
}