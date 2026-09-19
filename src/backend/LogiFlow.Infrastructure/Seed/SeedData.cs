using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;

namespace LogiFlow.Infrastructure;

/// <summary>
/// Seeds development/test data. Never runs in Production (see <c>Program</c>).
/// </summary>
public static class SeedData
{
    /// <summary>
    /// Development-only credentials, one per role so RBAC can be exercised by hand and by the
    /// Playwright suite. The password is deliberately obvious and shared, and must never be used
    /// outside a local/Test environment — production user provisioning is out of scope for v1
    /// (LOGI-0003 §5).
    /// </summary>
    public const string DevelopmentPassword = "logiflow-dev-password";

    /// <summary>A development user to seed: login identity, display name and role.</summary>
    public record SeedUser(string Email, string FullName, string Role);

    /// <summary>
    /// The seeded development users, one per role (the personas from 12-PRD.md §2). Exposed as data so
    /// integration and E2E tests select an account by role instead of hard-coding an email that could
    /// drift from what startup actually creates.
    /// </summary>
    public static readonly IReadOnlyList<SeedUser> Users =
    [
        new("alex@logiflow.dev", "Alex Adams", Roles.Admin),
        new("dana@logiflow.dev", "Dana Doolittle", Roles.Dispatcher),
        new("raj@logiflow.dev", "Raj Raman", Roles.Driver),
        new("vera@logiflow.dev", "Vera Vogel", Roles.Viewer),
    ];

    /// <summary>
    /// Creates the four role-representative users if they are absent. Idempotent: re-running against
    /// an existing database is a no-op, so startup can call it unconditionally.
    /// </summary>
    public static async Task EnsureSeededAsync(
        UserManager<AppUser> userManager,
        ILogger logger,
        CancellationToken cancellationToken = default)
    {
        foreach (var (email, fullName, role) in Users)
        {
            if (await userManager.FindByEmailAsync(email) is not null)
            {
                continue;
            }

            var user = new AppUser
            {
                // Email is the login identifier, so UserName mirrors it (Identity requires one).
                UserName = email,
                Email = email,
                EmailConfirmed = true,
                FullName = fullName,
                Role = role,
            };

            var created = await userManager.CreateAsync(user, DevelopmentPassword);
            if (!created.Succeeded)
            {
                // Startup should surface a broken seed loudly rather than leave a role unloggable.
                throw new InvalidOperationException(
                    $"Failed to seed user '{email}': {string.Join("; ", created.Errors.Select(e => e.Description))}");
            }

            logger.LogInformation("Seeded development user {Email} with role {Role}", email, role);
        }
    }
}
