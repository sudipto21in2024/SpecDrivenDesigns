namespace LogiFlow.Domain;

/// <summary>
/// A shipment moving freight between warehouses (approved schema §shipments). Creation/edit
/// belong to LOGI-0007/0008 — they will reuse <see cref="Create"/> and <see cref="TransitionTo"/>.
/// Status is stored as TEXT (SQLite); the closed value set and transition legality (BR-7)
/// are enforced here and by Application validators, mirroring the vehicle/driver idiom.
/// </summary>
public class Shipment
{
    public long Id { get; set; }
    public string ReferenceCode { get; private set; } = null!;
    public long OriginWarehouseId { get; private set; }
    public string DestinationAddress { get; private set; } = null!;
    public double? DestinationLat { get; private set; }
    public double? DestinationLng { get; private set; }
    public double WeightKg { get; private set; }
    public string Status { get; private set; } = null!;
    public string Priority { get; private set; } = null!;
    public DateTime? SlaDueAt { get; private set; }
    public long? RouteId { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }

    /// <summary>Creates a shipment in the initial Pending state. Invariant validation happens in Application validators (LOGI-0007).</summary>
    public static Shipment Create(
        string referenceCode, long originWarehouseId, string destinationAddress,
        double? destinationLat, double? destinationLng, double weightKg,
        string status, string priority, DateTime? slaDueAt, DateTime now) =>
        new()
        {
            ReferenceCode = referenceCode,
            OriginWarehouseId = originWarehouseId,
            DestinationAddress = destinationAddress,
            DestinationLat = destinationLat,
            DestinationLng = destinationLng,
            WeightKg = weightKg,
            Status = status,
            Priority = priority,
            SlaDueAt = slaDueAt,
            CreatedAt = now,
            UpdatedAt = now,
        };

    /// <summary>
    /// Applies a status transition per BR-7 and returns the audit event to append to
    /// shipment_status_history. Throws <see cref="IllegalShipmentTransitionException"/> when
    /// BR-7 forbids the move; the Application handler translates that into 409 ProblemDetails
    /// whose detail names the legal next state(s).
    /// </summary>
    public ShipmentStatusEvent TransitionTo(string toStatus, long changedByUserId, string? note, DateTime at)
    {
        var to = toStatus.Trim();
        var legal = ShipmentStatusValues.LegalNextStates(Status);
        if (!legal.Contains(to))
        {
            throw new IllegalShipmentTransitionException(Status, to, legal);
        }

        var from = Status;
        Status = to;
        return new ShipmentStatusEvent(0, from, to, changedByUserId, at, note);
    }
}