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
    // A SHARED-CACHE named in-memory database, not a private ":memory:" database. Two things need
    // it. (1) Sharing: a plain ":memory:" database exists only inside its own connection, so the
    // schema+seed written by the initializer would be invisible to every later connection. (2)
    // Concurrency: EF is given the CONNECTION STRING, not a connection object, so each request
    // scope opens its own connection. That is what makes LOGI-0010 AC-9 observable at all — two
    // concurrent assigns must be able to hold two database connections and therefore two
    // transactions. Handing EF a single shared SqliteConnection instead made the second
    // BeginTransaction fail outright and the losing request surfaced as 500 instead of the 409 the
    // BR-5 guard must produce.
    //
    // The database NAME must be unique per factory instance. xUnit runs one instance per test
    // class, all in the same process and in parallel, and a shared-cache in-memory database is
    // addressed by name process-wide — so a constant name gave every test class the same tables and
    // they contaminated each other's rows (duplicate-plate 409s, list counts drifting). A GUID
    // suffix keeps the AC-9 multi-connection property while restoring per-class isolation.
    private readonly string _databaseName = $"LogiFlowTests-{Guid.NewGuid():N}";
    private string ConnectionString => $"Data Source={_databaseName};Mode=Memory;Cache=Shared";

    /// <summary>
    /// Held open for the factory lifetime. A shared-cache in-memory database is destroyed when
    /// its last connection closes, and every test scope closes its connection as it finishes, so
    /// without this anchor the schema would vanish between tests.
    /// </summary>
    private readonly SqliteConnection _keepAlive;

    public LogiFlowTestFactory()
    {
        _keepAlive = new SqliteConnection(ConnectionString);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        _keepAlive.Open();
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [LogiFlow.Infrastructure.DependencyInjection.ConnectionStringKey] = ConnectionString,
            });
        });
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<LogiFlowDbContext>>();
            // The connection STRING, not a connection instance: EF resolves a connection per scope,
            // so concurrent requests really do contend for the SQLite write lock (AC-9).
            services.AddDbContext<LogiFlowDbContext>(options => options.UseSqlite(ConnectionString));
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
            _keepAlive.Dispose();
        }
    }
}
