namespace LogiFlow.Domain;

/// <summary>
/// A fleet vehicle that routes can later be assigned to. Master data (LOGI-0004, PRD F2).
/// Type/status are stored as TEXT (SQLite); the closed value sets (Van/Truck/Trailer,
/// Available/InRoute/Maintenance) are enforced by Application validators, mirroring how
/// warehouse lat/lng ranges are validated outside the entity.
/// </summary>
public class Vehicle
{
    public long Id { get; set; }
    public string PlateNumber { get; private set; } = null!;
    public string Type { get; private set; } = null!;
    public double CapacityKg { get; private set; }
    public string Status { get; private set; } = null!;
    public DateTime CreatedAt { get; private set; }

    /// <summary>Creates a new vehicle. Invariant validation happens in Application validators.</summary>
    public static Vehicle Create(string plateNumber, string type, double capacityKg, string status, DateTime now) =>
        new()
        {
            PlateNumber = plateNumber.Trim(),
            Type = type,
            CapacityKg = capacityKg,
            Status = status,
            CreatedAt = now,
        };

    /// <summary>Full update of mutable fields (v1: all fields except id/createdAt are mutable).</summary>
    public void Update(string plateNumber, string type, double capacityKg, string status)
    {
        PlateNumber = plateNumber.Trim();
        Type = type;
        CapacityKg = capacityKg;
        Status = status;
    }
}
