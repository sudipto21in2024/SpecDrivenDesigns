using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace LogiFlow.Infrastructure.Persistence;

/// <summary>
/// Design-time factory so `dotnet ef` can create migrations without booting the API host
/// (standard pattern for minimal-API startup).
/// </summary>
public class LogiFlowDbContextFactory : IDesignTimeDbContextFactory<LogiFlowDbContext>
{
    public LogiFlowDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<LogiFlowDbContext>()
            .UseSqlite("Data Source=logiflow.db")
            .Options;

        return new LogiFlowDbContext(options);
    }
}
