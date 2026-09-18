using System.Text.Json;
using LogiFlow.Api.Endpoints;
using LogiFlow.Api.Middleware;
using LogiFlow.Application;
using LogiFlow.Infrastructure;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
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

app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseSerilogRequestLogging();

app.MapGet("/api/v1/health", () => Results.Ok(new
{
    status = "ok",
    service = "LogiFlow",
    timestamp = DateTime.UtcNow
}));

app.MapWarehouseEndpoints();

app.Run();

/// <summary>Partial for WebApplicationFactory&lt;Program&gt; in the integration tests.</summary>
public partial class Program;

