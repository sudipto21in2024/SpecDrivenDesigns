using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Abstractions;

/// <summary>
/// Persistence abstraction consumed by Application handlers. Implemented by
/// LogiFlow.Infrastructure.Persistence.LogiFlowDbContext (registered in DI by AddInfrastructure).
/// </summary>
public interface IAppDbContext
{
    DbSet<Domain.Warehouse> Warehouses { get; }
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
