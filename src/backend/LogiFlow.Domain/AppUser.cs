using Microsoft.AspNetCore.Identity;

namespace LogiFlow.Domain;

/// <summary>
/// A LogiFlow user account.
///
/// Derives from ASP.NET Core Identity's user so password hashing (PBKDF2), email normalisation and
/// lockout bookkeeping come from the framework rather than hand-rolled code (ADR-007). The role is
/// kept as a single scalar column matching <c>users.role</c> in 04-database-schema.md — LogiFlow v1
/// deliberately does not use the AspNetUserRoles join table.
///
/// Credential material (<see cref="IdentityUser{TKey}.PasswordHash"/>, SecurityStamp) is never
/// projected into an API response; see <c>AuthUserDto</c> (LOGI-0003 AC-10).
/// </summary>
public class AppUser : IdentityUser<long>
{
    /// <summary>Display name shown in the UI and in future audit trails.</summary>
    public required string FullName { get; set; }

    /// <summary>One of <see cref="Security.Roles"/> — Admin, Dispatcher, Driver or Viewer.</summary>
    public required string Role { get; set; }
}
