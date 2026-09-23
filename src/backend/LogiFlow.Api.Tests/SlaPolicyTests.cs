using System.Globalization;
using FluentAssertions;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Domain;
using Xunit;

namespace LogiFlow.Api.Tests;

/// <summary>
/// Unit tests for the SLA rules (LOGI-0007 AC-2/AC-3/AC-9): the worked examples of
/// Docs/business-rules/BR-sla-rules.md §3 and the boundary table of §4. Pure unit tests — no API,
/// no database: the single SlaPolicy unit is the authority both the write path (creation) and the
/// read path (list projection) call.
/// </summary>
public class SlaPolicyTests
{
    /// <summary>BR-sla-rules §3 Example A/B anchor.</summary>
    private static readonly DateTime Created = new(2026, 9, 18, 8, 0, 0, DateTimeKind.Utc);

    /// <summary>BR-sla-rules §3 Example A: sla_due_at for a Standard shipment created at 08:00Z.</summary>
    private static readonly DateTime Due = new(2026, 9, 20, 8, 0, 0, DateTimeKind.Utc);

    private static DateTime At(string iso8601) =>
        DateTime.Parse(iso8601, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

    [Fact] // BR-sla-rules §3 Example A — Standard = +48h
    public void DueAt_Standard_Adds48Hours() =>
        SlaPolicy.DueAt(Created, SlaPolicy.Standard).Should().Be(Due);

    [Fact] // BR-sla-rules §3 Example B — Express = +12h
    public void DueAt_Express_Adds12Hours() =>
        SlaPolicy.DueAt(Created, SlaPolicy.Express).Should().Be(At("2026-09-18T20:00:00Z"));

    [Fact] // BR-sla-rules §3 Example C — month boundary, plain UTC duration arithmetic (rule 1.4)
    public void DueAt_Express_CrossesMonthBoundary() =>
        SlaPolicy.DueAt(At("2026-10-31T22:30:00Z"), SlaPolicy.Express).Should().Be(At("2026-11-01T10:30:00Z"));

    [Fact] // BR-1 rule 1.3 — omitted priority degrades to the longer promise
    public void DefaultPriority_IsStandard_AndGetsThe48HourPromise()
    {
        SlaPolicy.DefaultPriority.Should().Be(SlaPolicy.Standard);
        SlaPolicy.IsKnownPriority(SlaPolicy.DefaultPriority).Should().BeTrue();
        SlaPolicy.DueAt(Created, SlaPolicy.DefaultPriority).Should().Be(Created.AddHours(48));
    }

    [Fact] // BR-1 rules 1.1/1.2 — the creation instant is truncated to whole seconds (precision note)
    public void DueAt_TruncatesTheCreationInstantToWholeSeconds() =>
        SlaPolicy.DueAt(new DateTime(2026, 9, 18, 8, 0, 0, 987, DateTimeKind.Utc).AddTicks(1234), SlaPolicy.Express)
            .Should().Be(At("2026-09-18T20:00:00Z"));

    [Theory] // BR-1 rule 1.7 — unknown values fail loudly, they are never coerced
    [InlineData("Overnight")]
    [InlineData("standard")]
    [InlineData("")]
    [InlineData(null)]
    public void UnknownPriority_IsRejectedAndDueAtThrows(string? priority)
    {
        SlaPolicy.IsKnownPriority(priority).Should().BeFalse();

        var act = () => SlaPolicy.DueAt(Created, priority!);

        act.Should().Throw<ArgumentOutOfRangeException>().WithParameterName("priority");
    }

    /// <summary>
    /// BR-sla-rules §4 boundary table, evaluated through BOTH shapes of BR-2: the in-memory
    /// predicate and the SQL-translatable cutoff used by the shipments query. They must agree.
    /// </summary>
    [Theory]
    [InlineData("2026-09-20T05:59:59Z", "InTransit", false, "before the threshold")]
    [InlineData("2026-09-20T06:00:00Z", "InTransit", true, "inclusive boundary — now == sla_due_at - 2h")]
    [InlineData("2026-09-20T06:00:01Z", "Pending", true, "inside the warning window")]
    [InlineData("2026-09-20T07:30:00Z", "Delayed", true, "rule 2.4 — a delay does not discharge the promise")]
    [InlineData("2026-09-20T08:00:00Z", "Assigned", true, "exactly due, not yet delivered")]
    [InlineData("2026-09-20T09:15:00Z", "InTransit", true, "overdue is still at risk (rule 2.6)")]
    [InlineData("2026-09-20T07:00:00Z", "Delivered", false, "excluded status (rule 2.3)")]
    [InlineData("2026-09-20T07:00:00Z", "Cancelled", false, "excluded status (rule 2.3)")]
    public void AtRisk_MatchesTheBoundaryTable_InBothShapes(string now, string status, bool expected, string why)
    {
        var instant = At(now);

        SlaPolicy.IsAtRisk(Due, status, instant).Should().Be(expected, why);

        // The query form: at risk ⇔ sla_due_at <= AtRiskCutoff(now), with the exempt statuses excluded.
        var viaCutoff = Due <= SlaPolicy.AtRiskCutoff(instant) && !SlaPolicy.ExemptStatuses.Contains(status);
        viaCutoff.Should().Be(expected, $"the SQL cutoff form must agree with the predicate ({why})");
    }

    [Fact] // BR-2 rule 2.7 — no promise recorded, no risk
    public void AtRisk_IsFalseWhenSlaDueAtIsNull()
    {
        SlaPolicy.IsAtRisk(null, ShipmentStatusValues.All[0], At("2026-09-20T09:15:00Z")).Should().BeFalse();
        SlaPolicy.ExemptStatuses.Should().BeEquivalentTo(
            new[] { nameof(ShipmentStatus.Delivered), nameof(ShipmentStatus.Cancelled) });
    }

    [Fact] // rule 2.2/2.5 — the cutoff is a computed instant, not a stored value
    public void AtRiskCutoff_UsesTheTwoHourWarningWindowOnWholeSeconds()
    {
        var now = new DateTime(2026, 9, 20, 6, 0, 1, 750, DateTimeKind.Utc);

        SlaPolicy.AtRiskCutoff(now).Should().Be(At("2026-09-20T08:00:01Z"));
        SlaPolicy.IsAtRisk(At("2026-09-20T08:00:01Z"), "Pending", now).Should().BeTrue();
        SlaPolicy.IsAtRisk(At("2026-09-20T08:00:02Z"), "Pending", now).Should().BeFalse();
    }
}
