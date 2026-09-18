using LogiFlow.Application.Abstractions;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace LogiFlow.Infrastructure;

public static class DependencyInjection
{
    public const string ConnectionStringKey = "Database:ConnectionString";
    public const string DefaultConnectionString = "Data Source=logiflow.db";

    /// <summary>Registers the SQLite-backed DbContext and exposes it as IAppDbContext.</summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration[ConnectionStringKey] ?? DefaultConnectionString;

        services.AddDbContext<LogiFlowDbContext>(options => options.UseSqlite(connectionString));
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<LogiFlowDbContext>());

        return services;
    }
}
