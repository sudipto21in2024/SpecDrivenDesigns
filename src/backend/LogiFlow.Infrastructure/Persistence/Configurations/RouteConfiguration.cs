using LogiFlow.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LogiFlow.Infrastructure.Persistence.Configurations;

public class RouteConfiguration : IEntityTypeConfiguration<Route>
{
    public void Configure(EntityTypeBuilder<Route> entity)
    {
        entity.ToTable("routes");
        entity.HasKey(r => r.Id);
        entity.Property(r => r.Id).HasColumnName("id").ValueGeneratedOnAdd();
        entity.Property(r => r.Name).HasColumnName("name").IsRequired().HasMaxLength(200);
        entity.Property(r => r.PlannedStart).HasColumnName("planned_start").IsRequired();
        entity.Property(r => r.PlannedEnd).HasColumnName("planned_end").IsRequired();
        entity.Property(r => r.ActualStart).HasColumnName("actual_start");
        entity.Property(r => r.ActualEnd).HasColumnName("actual_end");
        entity.Property(r => r.VehicleId).HasColumnName("vehicle_id");
        entity.Property(r => r.DriverId).HasColumnName("driver_id");
        entity.Property(r => r.Status).HasColumnName("status").IsRequired().HasMaxLength(20);
        entity.Property(r => r.CreatedAt).HasColumnName("created_at").IsRequired();
        entity.Property(r => r.UpdatedAt).HasColumnName("updated_at");

        entity.HasIndex(r => r.Status).HasDatabaseName("ix_routes_status");
        entity.HasIndex(r => r.VehicleId).HasDatabaseName("ix_routes_vehicle_id");
        entity.HasIndex(r => r.DriverId).HasDatabaseName("ix_routes_driver_id");

        entity.HasOne<Vehicle>()
            .WithMany()
            .HasForeignKey(r => r.VehicleId)
            .HasConstraintName("fk_routes_vehicles")
            .OnDelete(DeleteBehavior.Restrict);

        entity.HasOne<Driver>()
            .WithMany()
            .HasForeignKey(r => r.DriverId)
            .HasConstraintName("fk_routes_drivers")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
