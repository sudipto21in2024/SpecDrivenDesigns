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

    /// <summary>Driver master data (`drivers` table) — LOGI-0005.</summary>
    DbSet<Domain.Driver> Drivers { get; }

    /// <summary>Shipments (`shipments` table) — LOGI-0006 (creation itself lands with LOGI-0007).</summary>
    DbSet<Domain.Shipment> Shipments { get; }

    /// <summary>Append-only shipment status audit trail (`shipment_status_history`) — LOGI-0006.</summary>
    DbSet<Domain.ShipmentStatusHistory> ShipmentStatusHistory { get; }

    /// <summary>User accounts (ASP.NET Core Identity, `users` table) — LOGI-0003.</summary>
    DbSet<Domain.AppUser> Users { get; }

    /// <summary>Rotating refresh tokens (`refresh_tokens` table) — LOGI-0003.</summary>
    DbSet<Domain.RefreshToken> RefreshTokens { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
