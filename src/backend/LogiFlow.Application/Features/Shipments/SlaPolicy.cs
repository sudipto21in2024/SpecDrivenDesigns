using LogiFlow.Domain;

namespace LogiFlow.Application.Features.Shipments;

/// <summary>
/// The single home of the SLA rules: BR-1 (due date at creation) and BR-2 (the read-time
/// "at risk" flag). See Docs/business-rules/BR-sla-rules.md §1 and §2 — the rules are referenced,
/// never redefined, and no other component inlines an offset or the warning window
/// (§1/§2 "enforcement seam", LOGI-0007).
///
/// Two shapes of the same rule live here on purpose:
/// <list type="bullet">
///   <item><see cref="AtRiskCutoff"/> — a <c>sla_due_at &lt;= cutoff</c> bound that the shipments
///   query can translate to SQL, so <c>slaRisk</c> filtering, <c>totalCount</c> and paging stay
///   server-side;</item>
///   <item><see cref="IsAtRisk"/> — the in-memory twin used by unit tests and any non-query caller.</item>
/// </list>
/// The flag is never stored: BR-sla-rules rule 2.5 forbids an <c>at_risk</c>/<c>breached</c> column.
/// </summary>
public static class SlaPolicy
{
    public const string Standard = "Standard";
    public const string Express = "Express";

    /// <summary>BR-1 rule 1.3: an omitted priority degrades to the longer, safer promise.</summary>
    public const string DefaultPriority = Standard;

    /// <summary>Closed priority set (04-database-schema.md §shipments); anything else fails loudly (rule 1.7).</summary>
    public static readonly IReadOnlyList<string> Priorities = [Standard, Express];

    /// <summary>BR-2 rule 2.3: exactly these two statuses are exempt from the at-risk flag.</summary>
    public static readonly IReadOnlyList<string> ExemptStatuses =
        [nameof(ShipmentStatus.Delivered), nameof(ShipmentStatus.Cancelled)];

    private static readonly TimeSpan StandardOffset = TimeSpan.FromHours(48); // BR-1
    private static readonly TimeSpan ExpressOffset = TimeSpan.FromHours(12);  // BR-1
    private static readonly TimeSpan AtRiskWindow = TimeSpan.FromHours(2);     // BR-2 rule 2.2

    public static bool IsKnownPriority(string? priority) => priority is not null && Priorities.Contains(priority);

    /// <summary>
    /// BR-1: <c>sla_due_at = created_at + offset(priority)</c> — plain UTC duration arithmetic
    /// (rule 1.4: no business-hours/weekend exclusion), anchored on the server-assigned creation
    /// instant (rules 1.1/1.2). Unknown priorities throw because the validator must have rejected
    /// them first (rule 1.7: never silently coerce).
    /// </summary>
    public static DateTime DueAt(DateTime createdAtUtc, string priority)
    {
        var offset = priority switch
        {
            Standard => StandardOffset,
            Express => ExpressOffset,
            _ => throw new ArgumentOutOfRangeException(
                nameof(priority), priority, "Unknown priority — validate with IsKnownPriority first."),
        };

        return TruncateToSeconds(createdAtUtc).Add(offset);
    }

    /// <summary>
    /// Whole-second truncation — BR-sla-rules §3 "Precision": every instant compared against the
    /// at-risk threshold is truncated so implementation and tests compare identical instants.
    /// </summary>
    public static DateTime TruncateToSeconds(DateTime instant) =>
        new(instant.Year, instant.Month, instant.Day, instant.Hour, instant.Minute, instant.Second, instant.Kind);

    /// <summary>
    /// BR-2 rewritten as an upper bound on <c>sla_due_at</c>: a shipment is at risk exactly when
    /// its due instant is &lt;= this cutoff. (<c>now &gt;= due - 2h</c> ⇔ <c>due &lt;= now + 2h</c>,
    /// which keeps the query SQL-translatable.)
    /// </summary>
    public static DateTime AtRiskCutoff(DateTime nowUtc) => TruncateToSeconds(nowUtc).Add(AtRiskWindow);

    /// <summary>
    /// BR-2 (in-memory predicate): inclusive comparison (rule 2.1), warning window of 2 hours
    /// (rule 2.2), excludes Delivered/Cancelled only (rule 2.3 — so a Delayed shipment is still at
    /// risk, rule 2.4), and a null due date is never at risk (rule 2.7).
    /// </summary>
    public static bool IsAtRisk(DateTime? slaDueAt, string status, DateTime nowUtc) =>
        slaDueAt is not null
        && !ExemptStatuses.Contains(status)
        && TruncateToSeconds(nowUtc) >= slaDueAt.Value.Add(-AtRiskWindow);
}
