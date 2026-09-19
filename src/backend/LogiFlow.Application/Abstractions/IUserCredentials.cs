using LogiFlow.Domain;

namespace LogiFlow.Application.Abstractions;

/// <summary>
/// Credential verification seam over ASP.NET Core Identity's <c>UserManager</c> (ADR-007).
///
/// Handlers never touch password hashes: they ask this abstraction to verify a password, and the
/// implementation delegates to Identity's PBKDF2 verification. Keeping it behind an interface also
/// means the Application layer stays testable without an Identity host.
/// </summary>
public interface IUserCredentials
{
    /// <summary>Finds a user by email (case-insensitive via the normalised column). Null when absent.</summary>
    Task<AppUser?> FindByEmailAsync(string email, CancellationToken cancellationToken);

    /// <summary>
    /// Verifies a plaintext password against the stored hash. Returns false — never throws — for a
    /// wrong password, an unknown user or a user without a password hash, so callers cannot leak
    /// existence through differing failure modes (LOGI-0003 AC-2).
    /// </summary>
    Task<bool> CheckPasswordAsync(AppUser user, string password, CancellationToken cancellationToken);
}
