namespace LogiFlow.Application.Common;

/// <summary>
/// Thrown by handlers when supplied credentials or a refresh token cannot be accepted.
/// Mapped to a 401 ProblemDetails (+ WWW-Authenticate: Bearer) by the API exception middleware.
///
/// The message is intentionally generic: login failures must not reveal whether the email exists
/// or whether the refresh token was unknown, expired or already rotated (LOGI-0003 AC-2, AC-7).
/// </summary>
public class UnauthorizedException(string detail = "Authentication failed.")
    : Exception(detail);