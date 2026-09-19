using LogiFlow.Application.Abstractions;
using LogiFlow.Domain;
using LogiFlow.Infrastructure.Persistence;
using LogiFlow.Infrastructure.Security;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace LogiFlow.Infrastructure;

public static class DependencyInjection
{
    public const string ConnectionStringKey = "Database:ConnectionString";
    public const string DefaultConnectionString = "Data Source=logiflow.db";

    /// <summary>
    /// Registers the SQLite-backed DbContext, ASP.NET Core Identity, JWT options and the security
    /// seams the Application layer depends on (ADR-007).
    /// </summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration[ConnectionStringKey] ?? DefaultConnectionString;

        services.AddDbContext<LogiFlowDbContext>(options => options.UseSqlite(connectionString));
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<LogiFlowDbContext>());

        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));

        // Identity's stores give us UserManager<AppUser> (PBKDF2 hashing, normalised-email lookup)
        // without pulling in the cookie/sign-in machinery: authentication is bearer-token only.
        services.AddIdentityCore<AppUser>(options =>
            {
                // Password policy: length over composition rules (NIST-style guidance). No forced
                // symbol/case mixes, which mostly produce predictable substitutions.
                options.Password.RequiredLength = 10;
                options.Password.RequireDigit = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireLowercase = false;
                options.Password.RequireNonAlphanumeric = false;

                // Email doubles as the user name in v1, so it must be unique.
                options.User.RequireUniqueEmail = true;
            })
            .AddRoles<IdentityRole<long>>()
            .AddEntityFrameworkStores<LogiFlowDbContext>();

        services.AddSingleton<ITokenIssuer, JwtTokenService>();
        services.AddScoped<IUserCredentials, IdentityUserCredentials>();

        return services;
    }
}
