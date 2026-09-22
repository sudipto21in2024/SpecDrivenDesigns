namespace LogiFlow.Domain;

/// <summary>
/// Closed shipment status set from 04-database-schema.md §shipments (contract enums).
/// Stored as TEXT (SQLite); the legality of transitions is BR-7, encoded in
/// <see cref="ShipmentStatusValues.LegalNextStates"/> and enforced by <c>Shipment.TransitionTo</c>.
/// </summary>
public enum ShipmentStatus
{
    Pending,
    Assigned,
    InTransit,
    Delivered,
    Delayed,
    Cancelled,
}

/// <summary>BR-7 transition table + value-set helpers for the shipment status lifecycle.</summary>
public static class ShipmentStatusValues
{
    public static readonly IReadOnlyList<string> All =
    [
        nameof(ShipmentStatus.Pending),
        nameof(ShipmentStatus.Assigned),
        nameof(ShipmentStatus.InTransit),
        nameof(ShipmentStatus.Delivered),
        nameof(ShipmentStatus.Delayed),
        nameof(ShipmentStatus.Cancelled),
    ];

    public static bool IsKnown(string? status) => status is not null && All.Contains(status);

    /// <summary>
    /// The legal next states per BR-7 (checkpoint answers 1+2, LOGI-0006 architect arm):
    /// Pending → Assigned | Cancelled; Assigned → InTransit | Cancelled;
    /// InTransit → Delivered | Delayed; Delayed → InTransit (Delayed → Cancelled is
    /// deliberately NOT legal); Delivered and Cancelled are terminal.
    /// </summary>
    public static IReadOnlyList<string> LegalNextStates(string from) => from switch
    {
        nameof(ShipmentStatus.Pending) => [nameof(ShipmentStatus.Assigned), nameof(ShipmentStatus.Cancelled)],
        nameof(ShipmentStatus.Assigned) => [nameof(ShipmentStatus.InTransit), nameof(ShipmentStatus.Cancelled)],
        nameof(ShipmentStatus.InTransit) => [nameof(ShipmentStatus.Delivered), nameof(ShipmentStatus.Delayed)],
        nameof(ShipmentStatus.Delayed) => [nameof(ShipmentStatus.InTransit)],
        _ => [],
    };
}

/// <summary>
/// One entry of the shipment audit trail (shipment_status_history) — contract schema
/// ShipmentStatusEvent. <see cref="FromStatus"/> is null only on the initial entry
/// (written by shipment creation, LOGI-0007); every TransitionTo event carries it.
/// </summary>
public record ShipmentStatusEvent(
    long Id,
    string? FromStatus,
    string ToStatus,
    long ChangedByUserId,
    DateTime ChangedAt,
    string? Note);

/// <summary>Raised by <c>Shipment.TransitionTo</c> when BR-7 forbids the requested transition.</summary>
public class IllegalShipmentTransitionException(string from, string to, IReadOnlyList<string> legalNextStates)
    : Exception($"Cannot transition shipment from {from} to {to}: legal next state(s): {string.Join(", ", legalNextStates)}.");