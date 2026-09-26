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

    /// <summary>
    /// Applies an edit to the descriptive columns of a shipment that is still <c>Pending</c>
    /// (F6 / LOGI-0008 AC-1, AC-2). A PATCH is partial, so the Application handler merges the
    /// supplied fields with the stored row and always calls this method with the full editable set —
    /// the domain never sees a half-applied row.
    ///
    /// The server-owned columns are absent from the signature by construction: <c>reference_code</c>,
    /// <c>status</c> (BR-7, owned by <see cref="TransitionTo"/>) and above all <c>priority</c> and
    /// <c>sla_due_at</c> (BR-1 rule 1.5 — the due date is computed once at creation and "edits
    /// (LOGI-0008) do not reset the clock", so an editable priority could never stay BR-1-true).
    /// <c>route_id</c> arrives with route assignment (LOGI-0010).
    ///
    /// Throws <see cref="ShipmentNotEditableException"/> when the status is no longer Pending; the
    /// Application handler translates that into 409 ProblemDetails naming the required status.
    /// </summary>
    public void UpdateDetails(
        long originWarehouseId, string destinationAddress, double? destinationLat,
        double? destinationLng, double weightKg, DateTime at)
    {
        if (!string.Equals(Status, nameof(ShipmentStatus.Pending), StringComparison.Ordinal))
        {
            throw new ShipmentNotEditableException(Status);
        }

        OriginWarehouseId = originWarehouseId;
        DestinationAddress = destinationAddress;
        DestinationLat = destinationLat;
        DestinationLng = destinationLng;
        WeightKg = weightKg;

        // Server-managed row timestamp (spec §7 O6): refreshed by an edit, never accepted from the
        // client — the endpoint rejects updatedAt with 400 (AC-4).
        UpdatedAt = at;
    }
}

/// <summary>
/// Raised by <c>Shipment.UpdateDetails</c> when the shipment is no longer editable — BR-7 keeps
/// edits to the Pending state (LOGI-0008 AC-2). The message names the required status because the
/// API surfaces it verbatim as the 409 ProblemDetails detail.
/// </summary>
public class ShipmentNotEditableException(string status)
    : Exception($"Cannot edit a shipment with status {status}: only Pending shipments can be edited.");