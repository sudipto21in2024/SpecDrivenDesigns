using LogiFlow.Application.Abstractions;
using LogiFlow.Domain;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Infrastructure.Persistence;

/// <summary>
/// EF Core DbContext for LogiFlow. Column/table names mirror 04-database-schema.md
/// (snake_case tables/columns, ISO8601 UTC timestamps as TEXT).
/// </summary>
public class LogiFlowDbContext(DbContextOptions<LogiFlowDbContext> options) : DbContext(options), IAppDbContext
{
    public DbSet<Warehouse> Warehouses => Set<Warehouse>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Warehouse>(entity =>
        {
            entity.ToTable("warehouses");
            entity.HasKey(w => w.Id);
            entity.Property(w => w.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(w => w.Name).HasColumnName("name").IsRequired().HasMaxLength(200);
            entity.Property(w => w.Address).HasColumnName("address").IsRequired().HasMaxLength(500);
            entity.Property(w => w.Latitude).HasColumnName("latitude");
            entity.Property(w => w.Longitude).HasColumnName("longitude");
            entity.Property(w => w.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(w => w.Name);
        });
    }
}
