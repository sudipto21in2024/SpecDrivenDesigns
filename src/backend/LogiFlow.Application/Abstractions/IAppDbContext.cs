using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Abstractions;

/// <summary>
/// Persistence abstraction consumed by Application handlers. Implemented by
/// LogiFlow.Infrastructure.Persistence.LogiFlowDbContext (registered in DI by AddInfrastructure).
/// </summary>
public interface IAppDbContext
{
    DbSet<Domain.Warehouse> Warehouses { get; }

    /// <summary>Fleet vehicles (`vehicles` table) — LOGI-0004.</summary>
    DbSet<Domain.Vehicle> Vehicles { get; }

    /// <summary>User accounts (ASP.NET Core Identity, `users` table) — LOGI-0003.</summary>
    DbSet<Domain.AppUser> Users { get; }

    /// <summary>Rotating refresh tokens (`refresh_tokens` table) — LOGI-0003.</summary>
    DbSet<Domain.RefreshToken> RefreshTokens { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
