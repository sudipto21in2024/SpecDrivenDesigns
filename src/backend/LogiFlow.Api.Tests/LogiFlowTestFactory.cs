using LogiFlow.Domain;
using LogiFlow.Infrastructure;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Hosts the real API with a shared SQLite in-memory database (kept open for the factory
/// lifetime) so tests run against actual SQL semantics.
/// </summary>
public class LogiFlowTestFactory : WebApplicationFactory<Program>
{
    private readonly SqliteConnection _connection = new("Data Source=:memory:");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        _connection.Open();
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [LogiFlow.Infrastructure.DependencyInjection.ConnectionStringKey] = "Data Source=:memory:",
            });
        });
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<LogiFlowDbContext>>();
            services.AddDbContext<LogiFlowDbContext>(options => options.UseSqlite(_connection));
            services.AddHostedService(_ => new DatabaseInitializerHostedService(_.CreateScope));
        });
    }

    /// <summary>
    /// Applies the schema to the shared in-memory database and seeds the role-representative users
    /// before requests are served. Seeding goes through the same <see cref="SeedData"/> the API uses
    /// in Development, so test credentials cannot drift from the documented dev credentials.
    /// </summary>
    private class DatabaseInitializerHostedService(Func<IServiceScope> scopeFactory) : IHostedService
    {
        public async Task StartAsync(CancellationToken cancellationToken)
        {
            using var scope = scopeFactory();
            var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
            await db.Database.EnsureCreatedAsync(cancellationToken);

            await SeedData.EnsureSeededAsync(
                scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>(),
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(SeedData)),
                cancellationToken);
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            _connection.Dispose();
        }
    }
}
