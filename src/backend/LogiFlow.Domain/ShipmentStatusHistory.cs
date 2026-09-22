namespace LogiFlow.Domain;

/// <summary>
/// Append-only audit trail row for shipment status transitions (approved schema
/// §shipment_status_history, BO-4). Rows are inserted by the transition handler in the
/// same transaction as the shipment status update; nothing ever updates or deletes them.
/// <see cref="FromStatus"/> is null only on the initial entry written by LOGI-0007 creation.
/// </summary>
public class ShipmentStatusHistory
{
    public long Id { get; set; }
    public long ShipmentId { get; set; }
    public string? FromStatus { get; set; }
    public string ToStatus { get; set; } = null!;
    public long ChangedByUserId { get; set; }
    public DateTime ChangedAt { get; set; }
    public string? Note { get; set; }
}