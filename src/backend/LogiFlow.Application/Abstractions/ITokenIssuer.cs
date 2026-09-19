using LogiFlow.Domain;

namespace LogiFlow.Application.Abstractions;

/// <summary>A signed access token plus its lifetime in seconds (contract: TokenResponse).</summary>
public record AccessToken(string Value, int ExpiresInSeconds);

/// <summary>
/// Issues and hashes credentials (ADR-007). Implemented in Infrastructure so the Application layer
/// stays free of JWT/crypto libraries; handlers depend on this seam only.
/// </summary>
public interface ITokenIssuer
{
    /// <summary>Creates a short-lived signed JWT carrying sub/email/name/role claims.</summary>
    AccessToken CreateAccessToken(AppUser user, DateTime nowUtc);

    /// <summary>
    /// Creates a new opaque refresh-token value (256 bits of entropy, base64url). The raw value is
    /// returned to the caller once and never persisted.
    /// </summary>
    string CreateRefreshTokenValue();

    /// <summary>Hashes a raw refresh token for storage/lookup (SHA-256, hex).</summary>
    string HashRefreshToken(string rawToken);

    /// <summary>How long a newly issued refresh token remains exchangeable.</summary>
    TimeSpan RefreshTokenLifetime { get; }
}
