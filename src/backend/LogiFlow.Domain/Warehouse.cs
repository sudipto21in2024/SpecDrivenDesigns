namespace LogiFlow.Domain;

/// <summary>
/// A physical warehouse that can act as shipment origin. Master data (LOGI-0001).
/// </summary>
public class Warehouse
{
    public long Id { get; set; }
    public string Name { get; private set; } = null!;
    public string Address { get; private set; } = null!;
    public double? Latitude { get; private set; }
    public double? Longitude { get; private set; }
    public DateTime CreatedAt { get; private set; }

    /// <summary>Creates a new warehouse. Validation of invariants happens in Application validators.</summary>
    public static Warehouse Create(string name, string address, double? latitude, double? longitude, DateTime now) =>
        new()
        {
            Name = name.Trim(),
            Address = address.Trim(),
            Latitude = latitude,
            Longitude = longitude,
            CreatedAt = now,
        };

    /// <summary>Full update of mutable fields (v1: all fields except id/createdAt are mutable).</summary>
    public void Update(string name, string address, double? latitude, double? longitude)
    {
        Name = name.Trim();
        Address = address.Trim();
        Latitude = latitude;
        Longitude = longitude;
    }
}
