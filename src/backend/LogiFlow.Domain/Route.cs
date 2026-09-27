namespace LogiFlow.Domain;

/// <summary>
/// A route planning trips and grouping shipments (LOGI-0009, PRD F9, approved schema §routes).
/// Status values mirror the approved schema: Planned, InProgress, Completed, Cancelled.
/// Vehicle and Driver FKs are nullable (unassigned lane allowed at creation / unassignment).
/// </summary>
public class Route
{
    public long Id { get; set; }
    public string Name { get; private set; } = null!;
    public DateTime PlannedStart { get; private set; }
    public DateTime PlannedEnd { get; private set; }
    public DateTime? ActualStart { get; private set; }
    public DateTime? ActualEnd { get; private set; }
    public long? VehicleId { get; private set; }
    public long? DriverId { get; private set; }
    public string Status { get; private set; } = null!;
    public DateTime CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }

    public static Route Create(
        string name,
        DateTime plannedStart,
        DateTime plannedEnd,
        long? vehicleId,
        long? driverId,
        DateTime now) =>
        new()
        {
            Name = name.Trim(),
            PlannedStart = plannedStart,
            PlannedEnd = plannedEnd,
            VehicleId = vehicleId,
            DriverId = driverId,
            Status = RouteStatusValues.Planned,
            CreatedAt = now,
            UpdatedAt = null,
        };

    /// <summary>
    /// Partial edit / assignment of a Planned route (AC-2, AC-6).
    /// Throws <see cref="RouteNotEditableException"/> if not Planned.
    /// </summary>
    public void AssignOrUpdate(
        string name,
        DateTime plannedStart,
        DateTime plannedEnd,
        long? vehicleId,
        long? driverId,
        DateTime now)
    {
        if (!string.Equals(Status, RouteStatusValues.Planned, StringComparison.Ordinal))
        {
            throw new RouteNotEditableException(Status);
        }

        Name = name.Trim();
        PlannedStart = plannedStart;
        PlannedEnd = plannedEnd;
        VehicleId = vehicleId;
        DriverId = driverId;
        UpdatedAt = now;
    }
}

public static class RouteStatusValues
{
    public const string Planned = "Planned";
    public const string InProgress = "InProgress";
    public const string Completed = "Completed";
    public const string Cancelled = "Cancelled";

    public static readonly IReadOnlyList<string> All = [Planned, InProgress, Completed, Cancelled];
    public static readonly IReadOnlyList<string> ActiveForOverlap = [Planned, InProgress];

    public static bool IsKnown(string? status) =>
        status is not null && All.Contains(status, StringComparer.Ordinal);
}

public class RouteNotEditableException(string status)
    : Exception($"Cannot edit a route with status '{status}': only Planned routes can be edited.");
