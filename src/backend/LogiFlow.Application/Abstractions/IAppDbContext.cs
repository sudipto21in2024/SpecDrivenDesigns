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

    /// <summary>Routes (`routes` table) — LOGI-0009.</summary>
    DbSet<Domain.Route> Routes { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Runs <paramref name="work"/> inside an explicit database transaction, committing when it
    /// returns and rolling back when it throws (LOGI-0010 AC-9).
    ///
    /// This exists because a BR-5 capacity guard is a *read* (the running weight sum) that must not
    /// be separable from the *write* it authorises. Exposing the transaction as a method rather
    /// than a `Database` property keeps the transaction an implementation detail of Infrastructure
    /// while letting Application handlers compose read-then-write atomically. The work delegate is
    /// expected to read everything it guards on *inside* this call — a read performed before the
    /// transaction opens is exactly the TOCTOU hole the seam is meant to close.
    /// </summary>
    Task<T> ExecuteInTransactionAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken cancellationToken = default);
}
