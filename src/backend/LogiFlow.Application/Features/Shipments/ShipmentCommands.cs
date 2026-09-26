using FluentValidation;
using FluentValidation.Results;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Shipments;

/// <summary>Read model for one audit entry (API contract: ShipmentStatusEvent).</summary>
public record ShipmentStatusEventDto(
    long Id, string? FromStatus, string ToStatus, long ChangedByUserId, DateTime ChangedAt, string? Note);

/// <summary>
/// AC-1..AC-4: apply one BR-7 status transition. Legal moves return the event echo (200);
/// illegal moves raise <see cref="IllegalShipmentTransitionException"/>, surfaced as 409 with
/// the legal next state(s) in the ProblemDetails detail (checkpoint answer 2 — 409, not 422).
/// </summary>
public record TransitionShipmentStatusCommand(long Id, string? ToStatus, string? Note)
    : ICommand<ShipmentStatusEventDto>;

public class TransitionShipmentStatusValidator : AbstractValidator<TransitionShipmentStatusCommand>
{
    public TransitionShipmentStatusValidator()
    {
        // AC-5: toStatus required and must be a known status; note optional, ≤500 chars.
        RuleFor(x => x.Id).GreaterThan(0);
        RuleFor(x => x.ToStatus).NotEmpty().Must(ShipmentStatusValues.IsKnown)
            .WithMessage($"toStatus must be one of: {string.Join(", ", ShipmentStatusValues.All)}.");
        RuleFor(x => x.Note).MaximumLength(500);
    }
}

public class TransitionShipmentStatusHandler(IAppDbContext db, ICurrentUser currentUser)
    : IRequestHandler<TransitionShipmentStatusCommand, ShipmentStatusEventDto>
{
    /// <summary>
    /// AC-10: the target-state half of the BR-6 rule — trimmed, exact match, mirroring how
    /// <c>Shipment.TransitionTo</c> normalises the requested state.
    /// </summary>
    private static bool IsCancellation(string? toStatus) =>
        string.Equals(toStatus?.Trim(), nameof(ShipmentStatus.Cancelled), StringComparison.Ordinal);

    /// <summary>BR-6: exactly these two roles may cancel a shipment.</summary>
    private static bool MayCancel(string? role) =>
        string.Equals(role, Roles.Admin, StringComparison.Ordinal)
        || string.Equals(role, Roles.Dispatcher, StringComparison.Ordinal);

    public async Task<ShipmentStatusEventDto> Handle(TransitionShipmentStatusCommand request, CancellationToken cancellationToken)
    {
        // BR-6 / AC-10: cancellation is a management action, and the endpoint's x-roles cannot express
        // that because Driver legitimately appears there for own-route transitions (LOGI-0009/0010).
        // The rule depends on the *target state*, so it is enforced here — before the row is read, so
        // the answer never leaks whether the shipment exists. Every other Driver transition keeps the
        // LOGI-0006 behaviour.
        if (IsCancellation(request.ToStatus) && !MayCancel(currentUser.Role))
        {
            throw new ForbiddenException("Only Admin and Dispatcher may cancel a shipment (BR-6).");
        }

        var shipment = await db.Shipments
            .SingleOrDefaultAsync(s => s.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Shipment), request.Id);

        try
        {
            var @event = shipment.TransitionTo(request.ToStatus!, currentUser.UserId!.Value, request.Note, DateTime.UtcNow);

            // One SaveChanges = one SQLite transaction: the shipments.status update and the
            // shipment_status_history append either both commit or neither does (spec §6).
            var history = new ShipmentStatusHistory
            {
                ShipmentId = shipment.Id,
                FromStatus = @event.FromStatus,
                ToStatus = @event.ToStatus,
                ChangedByUserId = @event.ChangedByUserId,
                ChangedAt = @event.ChangedAt,
                Note = @event.Note,
            };
            db.ShipmentStatusHistory.Add(history);
            await db.SaveChangesAsync(cancellationToken);

            return new ShipmentStatusEventDto(
                history.Id, @event.FromStatus, @event.ToStatus,
                @event.ChangedByUserId, @event.ChangedAt, @event.Note);
        }
        catch (IllegalShipmentTransitionException illegal)
        {
            // AC-2/AC-3/AC-4: state conflict per BR-7. The middleware maps ConflictException's
            // message to the ProblemDetails detail, which names the legal next state(s).
            throw new ConflictException(illegal.Message);
        }
    }
}

/// <summary>
/// AC-1..AC-4: apply one F6 edit. The editable fields are nullable, but <c>null</c> is ambiguous in a
/// PATCH body — "omitted" and "explicitly set to null" both bind to <c>null</c> — so
/// <paramref name="SuppliedFields"/> carries the set of property names actually present in the JSON
/// and is the only thing that decides what gets written. That is also what makes an explicit
/// <c>destinationLat: null</c> (clearing a coordinate) work while an omitted one is preserved.
///
/// <paramref name="RejectedFields"/> lists server-owned/immutable properties the client sent
/// (AC-4); they are reported as 400 field-keyed errors and never merged.
/// </summary>
public record UpdateShipmentCommand(
    long Id,
    long? OriginWarehouseId, string? DestinationAddress, double? WeightKg,
    double? DestinationLat, double? DestinationLng,
    IReadOnlyCollection<string> SuppliedFields,
    IReadOnlyCollection<string> RejectedFields) : ICommand<ShipmentDto>;

public class UpdateShipmentValidator : AbstractValidator<UpdateShipmentCommand>
{
    public UpdateShipmentValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0);

        // AC-3: an empty patch is a client mistake, not a no-op success — fail loudly so a UI that
        // submits a blank dialog tells the user instead of silently "succeeding" with no change.
        // Written as a rule over the command rather than over SuppliedFields: on a collection
        // property FluentValidation keeps the child property name and ignores WithName, so the
        // errors map would be keyed "suppliedFields" instead of the contract's "body".
        RuleFor(x => x)
            .Must(x => x.SuppliedFields.Any())
            .WithMessage("At least one editable field is required.")
            .WithName("body");

        // AC-4: id/referenceCode/status/slaDueAt/createdAt/updatedAt/routeId/atRisk are server-owned
        // and priority is immutable under BR-1 rule 1.5. The handler raises these as one
        // ValidationFailure *per field* before anything is read or written, because the errors map is
        // keyed by property name (ExceptionHandlingMiddleware) and a RuleForEach over the collection
        // would collapse them all under "rejectedFields" instead of "priority"/"status"/....

        // Every rule below is conditional on presence: an omitted field is never validated (it keeps
        // its stored value), so a partial patch cannot fail on fields the client did not touch.
        RuleFor(x => x.OriginWarehouseId)
            .Must((x, id) => id is null or > 0)
            .WithMessage("originWarehouseId must be a positive integer.")
            .When(x => x.SuppliedFields.Contains(nameof(UpdateShipmentCommand.OriginWarehouseId)));

        RuleFor(x => x.DestinationAddress)
            .Must((x, address) => !string.IsNullOrWhiteSpace(address) && address.Trim().Length <= 500)
            .WithMessage("destinationAddress must be non-blank and at most 500 characters.")
            .When(x => x.SuppliedFields.Contains(nameof(UpdateShipmentCommand.DestinationAddress)));

        RuleFor(x => x.WeightKg)
            .Must((x, weight) => weight is > 0)
            .WithMessage("weightKg must be greater than 0.")
            .When(x => x.SuppliedFields.Contains(nameof(UpdateShipmentCommand.WeightKg)));

        // Contract ranges, identical to the create validator (stored as supplied — no geocoding).
        RuleFor(x => x.DestinationLat)
            .Must((x, lat) => lat is null or >= -90 and <= 90)
            .WithMessage("destinationLat must be between -90 and 90.")
            .When(x => x.SuppliedFields.Contains(nameof(UpdateShipmentCommand.DestinationLat)));

        RuleFor(x => x.DestinationLng)
            .Must((x, lng) => lng is null or >= -180 and <= 180)
            .WithMessage("destinationLng must be between -180 and 180.")
            .When(x => x.SuppliedFields.Contains(nameof(UpdateShipmentCommand.DestinationLng)));
    }
}

/// <summary>Read model for one shipment (API contract: ShipmentResponse).</summary>
public record ShipmentDto(
    long Id, string ReferenceCode, long OriginWarehouseId, string DestinationAddress,
    double? DestinationLat, double? DestinationLng, double WeightKg, string Status, string Priority,
    DateTime? SlaDueAt, long? RouteId, bool AtRisk, DateTime CreatedAt, DateTime? UpdatedAt)
{
    /// <summary>
    /// Projects a stored shipment with the BR-2 read-time <c>atRisk</c> flag — computed here,
    /// never stored (BR-sla-rules rule 2.5), evaluated against the request instant
    /// <paramref name="nowUtc"/> (whole-second per BR-sla-rules precision note). Instants are
    /// re-marked Kind=Utc (spec §8: SQLite round-trips come back Kind=Unspecified; ticks are
    /// already UTC — no conversion, and the create path's in-memory Utc values are a no-op).
    /// </summary>
    public static ShipmentDto From(Shipment shipment, DateTime nowUtc) =>
        new(shipment.Id, shipment.ReferenceCode, shipment.OriginWarehouseId, shipment.DestinationAddress,
            shipment.DestinationLat, shipment.DestinationLng, shipment.WeightKg, shipment.Status,
            shipment.Priority,
            shipment.SlaDueAt is null ? null : DateTime.SpecifyKind(shipment.SlaDueAt.Value, DateTimeKind.Utc),
            shipment.RouteId,
            SlaPolicy.IsAtRisk(shipment.SlaDueAt, shipment.Status, nowUtc),
            DateTime.SpecifyKind(shipment.CreatedAt, DateTimeKind.Utc),
            shipment.UpdatedAt is null ? null : DateTime.SpecifyKind(shipment.UpdatedAt.Value, DateTimeKind.Utc));
}

/// <summary>
/// AC-1..AC-5: create a shipment (F5). Server owns referenceCode/status/slaDueAt/createdAt —
/// nothing in that set is ever accepted from the client (contract ShipmentRequest description).
/// </summary>
public record CreateShipmentCommand(
    long OriginWarehouseId, string? DestinationAddress, double WeightKg, string? Priority,
    double? DestinationLat, double? DestinationLng) : ICommand<ShipmentDto>;

public class CreateShipmentValidator : AbstractValidator<CreateShipmentCommand>
{
    public CreateShipmentValidator()
    {
        RuleFor(x => x.OriginWarehouseId).GreaterThan(0);
        RuleFor(x => x.DestinationAddress).NotEmpty().MaximumLength(500);
        RuleFor(x => x.WeightKg).GreaterThan(0);

        // BR-1 rule 1.3: null (omitted) passes and defaults to Standard in the handler; an explicit
        // empty/whitespace or unknown value fails loudly naming the allowed set (rules 1.7, AC-3/§7).
        RuleFor(x => x.Priority)
            .Must(priority => priority is null || SlaPolicy.IsKnownPriority(priority))
            .WithMessage($"priority must be one of: {string.Join(", ", SlaPolicy.Priorities)}.");

        // Contract ranges for the optional coordinates (stored as supplied — no geocoding, §5).
        RuleFor(x => x.DestinationLat)
            .Must(lat => lat is null || lat is >= -90 and <= 90)
            .WithMessage("destinationLat must be between -90 and 90.");
        RuleFor(x => x.DestinationLng)
            .Must(lng => lng is null || lng is >= -180 and <= 180)
            .WithMessage("destinationLng must be between -180 and 180.");
    }
}

public class CreateShipmentHandler(IAppDbContext db, ICurrentUser currentUser)
    : IRequestHandler<CreateShipmentCommand, ShipmentDto>
{
    /// <summary>AC-5: bounded reference-code collision budget before failing with 409.</summary>
    private const int MaxReferenceAttempts = 3;

    /// <summary>
    /// Per-process critical section for the reference-code generator (see Handle): max(id)+1 is
    /// read and committed under this guard so concurrent in-process creates take turns instead of
    /// racing. Cross-process races remain the unique index's job (BR-1 rule 1.6).
    /// </summary>
    private static readonly SemaphoreSlim CreateLock = new(1, 1);

    public async Task<ShipmentDto> Handle(CreateShipmentCommand request, CancellationToken cancellationToken)
    {
        // AC-4 / §7: FK existence is Application-layer validation keyed to errors.originWarehouseId
        // (mirrors the driver user-link precedent) — the requested resource (a shipment) does not
        // exist yet, so this is 400, not 404.
        var warehouseExists = await db.Warehouses.AsNoTracking()
            .AnyAsync(w => w.Id == request.OriginWarehouseId, cancellationToken);
        if (!warehouseExists)
        {
            throw new ValidationException(
            [
                new ValidationFailure(nameof(CreateShipmentCommand.OriginWarehouseId),
                    $"Warehouse {request.OriginWarehouseId} does not exist."),
            ]);
        }

        // Whole-second UTC anchor (BR-sla-rules §3 precision): created_at, sla_due_at and the
        // initial audit row share one instant, so AC-1/AC-2 comparisons are exact.
        var now = SlaPolicy.TruncateToSeconds(DateTime.UtcNow);
        var priority = request.Priority ?? SlaPolicy.DefaultPriority; // BR-1 rule 1.3
        var slaDueAt = SlaPolicy.DueAt(now, priority);                // BR-1 rules 1.1/1.4

        // Spec §6 atomicity: the initial audit row must share the shipment's transaction — either
        // both rows exist or neither does. EF fixup cannot link an Added dependent whose
        // store-generated FK does not exist until insert (efcore#32010 class), so the pair is
        // written as two saves inside ONE database transaction. IAppDbContext's sole concrete
        // implementation is the EF LogiFlowDbContext (verified by grep in this arm), so the cast
        // always lands; the explicit throw keeps a future non-EF implementation loud, not silent.
        var efContext = db as DbContext
            ?? throw new InvalidOperationException("LOGI-0007 atomic create requires an EF-backed IAppDbContext.");

        // AC-5 / §6 critical section: max(id)+1 is read and committed under the per-process guard
        // so concurrent in-process creates take turns instead of racing — which also keeps
        // overlapping transactions off one shared SQLite connection (the test harness shares a
        // single connection for the factory lifetime). Cross-process races remain the unique
        // index's job: bounded retry, then 409 (BR-1 rule 1.6).
        await CreateLock.WaitAsync(cancellationToken);
        try
        {
            for (var attempt = 1; ; attempt++)
            {
                // AC-5 / §7: SHP- + 6 digits derived from max(id)+1; the unique index stays authoritative.
                var maxId = await db.Shipments.MaxAsync(s => (long?)s.Id, cancellationToken) ?? 0;
                var referenceCode = $"SHP-{maxId + 1:D6}";

                var shipment = Shipment.Create(
                    referenceCode, request.OriginWarehouseId, request.DestinationAddress!,
                    request.DestinationLat, request.DestinationLng, request.WeightKg,
                    nameof(ShipmentStatus.Pending), priority, slaDueAt, now);

                db.Shipments.Add(shipment);
                ShipmentStatusHistory? history = null;
                await using var transaction = await efContext.Database.BeginTransactionAsync(cancellationToken);
                try
                {
                    // 1) shipment row — its store-generated id becomes available here.
                    await db.SaveChangesAsync(cancellationToken);

                    // AC-1: initial audit row — fromStatus null marks the creation entry (LOGI-0006
                    // history contract), changedAt = createdAt, actor = caller, real FK this time.
                    history = new ShipmentStatusHistory
                    {
                        ShipmentId = shipment.Id,
                        FromStatus = null,
                        ToStatus = nameof(ShipmentStatus.Pending),
                        ChangedByUserId = currentUser.UserId!.Value,
                        ChangedAt = now,
                        Note = null,
                    };
                    db.ShipmentStatusHistory.Add(history);

                    // 2) audit row in the SAME transaction as the shipment (§6).
                    await db.SaveChangesAsync(cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return ShipmentDto.From(shipment, now);
                }
                catch (DbUpdateException ex) when (IsUniqueViolation(ex))
                {
                    // AC-5: a cross-process create can take our candidate code. Detach the failed
                    // pair (Remove on Added entities detaches; the open transaction rolls back at
                    // dispose), recompute from the new max(id), and retry a bounded number of
                    // times — exhaustion surfaces as 409, never a duplicate-key 500 (mirrors the
                    // CreateVehicleHandler plate backstop).
                    db.Shipments.Remove(shipment);
                    if (history is not null)
                    {
                        db.ShipmentStatusHistory.Remove(history);
                    }
                    if (attempt >= MaxReferenceAttempts)
                    {
                        throw new ConflictException(nameof(Domain.Shipment), referenceCode);
                    }
                }
            }
        }
        finally
        {
            CreateLock.Release();
        }
    }

    internal static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is not null && ex.InnerException.Message.Contains("UNIQUE", StringComparison.OrdinalIgnoreCase);
}

public class UpdateShipmentHandler(IAppDbContext db) : IRequestHandler<UpdateShipmentCommand, ShipmentDto>
{
    public async Task<ShipmentDto> Handle(UpdateShipmentCommand request, CancellationToken cancellationToken)
    {
        // AC-4: server-owned / immutable properties are reported per field (so the UI can render each
        // inline) and rejected *before* the row is read, so nothing is applied or leaked. This lives
        // here rather than in the validator because the errors map is keyed by property name — a rule
        // over the RejectedFields collection would collapse everything under "rejectedFields".
        if (request.RejectedFields.Count > 0)
        {
            // "Priority" is a literal, not nameof: the command has no Priority member by design —
            // priority is one of the rejected server-owned properties AC-4 refuses to bind.
            throw new ValidationException(request.RejectedFields
                .Select(field => new ValidationFailure(field, field == "Priority"
                    ? "priority is immutable; create a new shipment instead (BR-1 rule 1.5)."
                    : $"{field} is server-owned and cannot be supplied in a shipment edit."))
                .ToList());
        }

        var shipment = await db.Shipments
            .SingleOrDefaultAsync(s => s.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Shipment), request.Id);

        // AC-4/§7: FK existence is Application-layer validation keyed to errors.originWarehouseId,
        // mirroring CreateShipmentHandler — 400, not 404, because the shipment itself does exist.
        // Only checked when the field is actually supplied (an omitted origin is the stored one).
        if (request.SuppliedFields.Contains(nameof(request.OriginWarehouseId)))
        {
            var warehouseExists = await db.Warehouses.AsNoTracking()
                .AnyAsync(w => w.Id == request.OriginWarehouseId, cancellationToken);
            if (!warehouseExists)
            {
                throw new ValidationException(
                [
                    new ValidationFailure(nameof(request.OriginWarehouseId),
                        $"Warehouse {request.OriginWarehouseId} does not exist."),
                ]);
            }
        }

        // Merge-then-update: the domain always receives the full editable set, so a partial patch can
        // never half-apply and the Pending-only guard inside UpdateDetails runs against the merged row.
        // One request instant drives both the UpdatedAt stamp and the BR-2 atRisk projection.
        var now = SlaPolicy.TruncateToSeconds(DateTime.UtcNow);
        var supplied = new HashSet<string>(request.SuppliedFields, StringComparer.Ordinal);

        try
        {
            shipment.UpdateDetails(
                supplied.Contains(nameof(request.OriginWarehouseId)) ? request.OriginWarehouseId!.Value : shipment.OriginWarehouseId,
                supplied.Contains(nameof(request.DestinationAddress)) ? request.DestinationAddress! : shipment.DestinationAddress,
                supplied.Contains(nameof(request.DestinationLat)) ? request.DestinationLat : shipment.DestinationLat,
                supplied.Contains(nameof(request.DestinationLng)) ? request.DestinationLng : shipment.DestinationLng,
                supplied.Contains(nameof(request.WeightKg)) ? request.WeightKg!.Value : shipment.WeightKg,
                now);
        }
        catch (ShipmentNotEditableException notEditable)
        {
            // AC-2: the status moved on since the form was loaded — 409 naming the required status,
            // same shape as a BR-7 conflict. Nothing is written: the guard runs before any assignment,
            // and no SaveChanges is reached, so the row stays byte-identical.
            throw new ConflictException(notEditable.Message);
        }

        // AC-1/§6: exactly one UPDATE, and deliberately NO shipment_status_history row — an edit is not
        // a status transition (F7 audits transitions; spec §7 O3).
        await db.SaveChangesAsync(cancellationToken);

        return ShipmentDto.From(shipment, now);
    }
}