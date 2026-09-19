namespace LogiFlow.Domain.Security;

/// <summary>
/// The four LogiFlow roles (04-database-schema.md: `users.role` ∈ Admin | Dispatcher | Driver | Viewer).
/// Declared once here so the API authorization policies (ADR-007) and the seed data cannot drift apart.
/// </summary>
public static class Roles
{
    public const string Admin = "Admin";
    public const string Dispatcher = "Dispatcher";
    public const string Driver = "Driver";
    public const string Viewer = "Viewer";

    /// <summary>Every role, in the order used by the contract's x-roles listings.</summary>
    public static readonly IReadOnlyList<string> All = [Admin, Dispatcher, Driver, Viewer];

    /// <summary>True when <paramref name="role"/> is one of the four known roles.</summary>
    public static bool IsKnown(string? role) => role is not null && All.Contains(role);
}
