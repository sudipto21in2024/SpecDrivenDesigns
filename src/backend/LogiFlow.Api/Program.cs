using System.Text;
using System.Text.Json;
using LogiFlow.Api.Authorization;
using LogiFlow.Api.Endpoints;
using LogiFlow.Api.Middleware;
using LogiFlow.Application;
using LogiFlow.Application.Abstractions;
using LogiFlow.Domain;
using LogiFlow.Infrastructure;
using LogiFlow.Infrastructure.Persistence;
using LogiFlow.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .WriteTo.File("Logs/logiflow-.txt", rollingInterval: RollingInterval.Day)
    .CreateLogger();

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog();
builder.Services.Configure<JsonOptions>(o =>
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// The Api layer owns the ICurrentUser implementation over HttpContext.User (ADR-007); the
// Application layer only sees the seam.
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var jwt = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwt.SigningKey ?? JwtOptions.DevelopmentKey)),
            ValidateLifetime = true,

            // No tolerance window: access tokens are deliberately short-lived (15 min), and the
            // framework default 5-minute skew would silently extend every one of them by a third.
            ClockSkew = TimeSpan.Zero,
        };

        options.Events = new JwtBearerEvents
        {
            // Authentication/authorization failures short-circuit the pipeline without throwing, so
            // the exception middleware never sees them. These handlers give the 401/403 responses the
            // contract's ProblemDetails body (LOGI-0003 AC-4, AC-5) instead of an empty payload.
            OnChallenge = async context =>
            {
                // HandleResponse() suppresses the framework's default empty 401; the writer below owns
                // the status code and adds the WWW-Authenticate: Bearer challenge required by RFC 6750.
                context.HandleResponse();
                await ProblemDetailsWriter.WriteAsync(context.HttpContext, StatusCodes.Status401Unauthorized,
                    "https://logiflow.dev/errors/unauthorized", "Unauthorized",
                    "A valid bearer token is required to access this resource.", null,
                    bearerChallenge: true);
            },
            OnForbidden = async context =>
                await ProblemDetailsWriter.WriteAsync(context.HttpContext, StatusCodes.Status403Forbidden,
                    "https://logiflow.dev/errors/forbidden", "Forbidden",
                    "The authenticated user is not permitted to perform this operation.", null),
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}

// Apply migrations on startup (v1 single-node SQLite; skipped in Testing where an
// in-memory shared connection is injected by the test factory).
if (!app.Environment.IsEnvironment("Testing"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<LogiFlowDbContext>();
    db.Database.Migrate();
}

// Seed the role-representative development users. Development only: tests seed through the same
// SeedData from the test factory's initializer, so credentials cannot drift between the two.
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    await SeedData.EnsureSeededAsync(
        scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>(),
        scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(SeedData)));
}

app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseSerilogRequestLogging();

// Order matters: authentication must establish the principal before authorization evaluates the
// endpoint's role requirements.
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/v1/health", () => Results.Ok(new
{
    status = "ok",
    service = "LogiFlow",
    timestamp = DateTime.UtcNow
}))
.AllowAnonymous()
.WithName("getHealth");

app.MapAuthEndpoints();
app.MapWarehouseEndpoints();

app.Run();

/// <summary>Partial for WebApplicationFactory&lt;Program&gt; in the integration tests.</summary>
public partial class Program;

