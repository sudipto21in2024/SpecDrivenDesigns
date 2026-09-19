using LogiFlow.Application.Abstractions;
using LogiFlow.Domain;
using Microsoft.AspNetCore.Identity;

namespace LogiFlow.Infrastructure.Security;

/// <summary>
/// Delegates credential verification to ASP.NET Core Identity's <see cref="UserManager{TUser}"/>,
/// so password hashing, rehashing of outdated hashes and lockout bookkeeping are framework-managed
/// rather than hand-written (ADR-007, PRD §6 Security).
/// </summary>
public class IdentityUserCredentials(UserManager<AppUser> users) : IUserCredentials
{
    public Task<AppUser?> FindByEmailAsync(string email, CancellationToken cancellationToken) =>
        users.FindByEmailAsync(email);

    public async Task<bool> CheckPasswordAsync(AppUser user, string password, CancellationToken cancellationToken)
    {
        // A user created without a password (future SSO/external-login scenario) has no hash to check.
        // Reporting false keeps a single failure path instead of throwing a framework exception.
        if (user.PasswordHash is null)
        {
            return false;
        }

        return await users.CheckPasswordAsync(user, password);
    }
}