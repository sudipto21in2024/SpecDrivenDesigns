using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Domain;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Routes;

internal static class RouteConflictCheck
{
    public static async Task EnsureNoDoubleBookingAsync(
        IAppDbContext db,
        long? currentRouteId,
        long? vehicleId,
        long? driverId,
        DateTime start,
        DateTime end,
        CancellationToken ct)
    {
        if (!vehicleId.HasValue && !driverId.HasValue) return;

        var activeRoutes = await db.Routes
            .Where(r => RouteStatusValues.ActiveForOverlap.Contains(r.Status)
                     && (!currentRouteId.HasValue || r.Id != currentRouteId.Value))
            .Where(r => (vehicleId.HasValue && r.VehicleId == vehicleId.Value)
                     || (driverId.HasValue && r.DriverId == driverId.Value))
            .Select(r => new { r.Id, r.VehicleId, r.DriverId, r.PlannedStart, r.PlannedEnd })
            .ToListAsync(ct);

        foreach (var r in activeRoutes)
        {
            var overlaps = start < r.PlannedEnd && r.PlannedStart < end;
            if (!overlaps) continue;

            if (vehicleId.HasValue && r.VehicleId == vehicleId.Value)
                throw new ConflictException(nameof(Vehicle), $"Vehicle {vehicleId.Value} is already booked on route {r.Id} for overlapping window.");

            if (driverId.HasValue && r.DriverId == driverId.Value)
                throw new ConflictException(nameof(Driver), $"Driver {driverId.Value} is already booked on route {r.Id} for overlapping window.");
        }
    }
}
