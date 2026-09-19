namespace LogiFlow.Application.Features.Auth;

/// <summary>
/// Identity of an authenticated user (contract: AuthUser). Deliberately limited to non-sensitive
/// fields — no password hash, security stamp, lockout counters or tokens (LOGI-0003 AC-10).
/// </summary>
public record AuthUserDto(long Id, string Email, string FullName, string Role);

/// <summary>
/// Token pair returned by login and refresh (contract: TokenResponse). <paramref name="RefreshToken"/>
/// is the raw, single-use token and is the only place it ever leaves the server.
/// </summary>
public record AuthTokensDto(string AccessToken, string RefreshToken, int ExpiresIn, AuthUserDto User);