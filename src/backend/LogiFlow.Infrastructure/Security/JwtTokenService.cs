using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using LogiFlow.Application.Abstractions;
using LogiFlow.Domain;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace LogiFlow.Infrastructure.Security;

/// <summary>
/// Issues access JWTs and manages refresh-token values (ADR-007).
///
/// Access tokens are stateless: all claims needed for authorization are embedded, so authenticating
/// a request costs no database round trip. Refresh tokens are the opposite — stateful and hashed —
/// which is what makes rotation and revocation possible.
/// </summary>
public class JwtTokenService(IOptions<JwtOptions> options) : ITokenIssuer
{
    private readonly JwtOptions _options = options.Value;

    /// <summary>Claim type used for role checks; maps to ClaimTypes.Role so [Authorize(Roles=...)] works.</summary>
    public const string RoleClaimType = ClaimTypes.Role;

    /// <summary>
    /// Number of random bytes behind a refresh token. 32 bytes = 256 bits, beyond brute-force reach
    /// and the same order of entropy used by the framework's own data-protection tokens.
    /// </summary>
    private const int RefreshTokenBytes = 32;

    public TimeSpan RefreshTokenLifetime => TimeSpan.FromDays(_options.RefreshTokenDays);

    public AccessToken CreateAccessToken(AppUser user, DateTime nowUtc)
    {
        var expiresAt = nowUtc.AddMinutes(_options.AccessTokenMinutes);
        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey ?? JwtOptions.DevelopmentKey));

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
            new(RoleClaimType, user.Role),
            new("name", user.FullName),
        };

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: nowUtc,
            expires: expiresAt,
            signingCredentials: new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256));

        // Seconds, matching contract TokenResponse.expiresIn.
        var expiresInSeconds = (int)TimeSpan.FromMinutes(_options.AccessTokenMinutes).TotalSeconds;
        return new AccessToken(new JwtSecurityTokenHandler().WriteToken(token), expiresInSeconds);
    }

    /// <summary>
    /// Creates a cryptographically random, URL-safe token value. Base64url avoids '+'/'/' which
    /// would need escaping in the JSON body and in any future query-string usage.
    /// </summary>
    public string CreateRefreshTokenValue() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(RefreshTokenBytes))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

    /// <summary>
    /// SHA-256 of the raw token, lowercase hex. A plain hash (no salt, no KDF) is correct here: the
    /// input is 256 bits of server-generated entropy, so it is not brute-forceable and the hash must
    /// stay deterministic to serve as the lookup key.
    /// </summary>
    public string HashRefreshToken(string rawToken) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));
}