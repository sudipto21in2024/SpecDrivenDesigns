using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
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
    public async Task<ShipmentStatusEventDto> Handle(TransitionShipmentStatusCommand request, CancellationToken cancellationToken)
    {
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