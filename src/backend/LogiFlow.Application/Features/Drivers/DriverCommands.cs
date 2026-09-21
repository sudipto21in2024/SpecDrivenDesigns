using FluentValidation;
using FluentValidation.Results;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Drivers;

/// <summary>
/// Read model returned by all driver endpoints (API contract: DriverResponse). Deliberately
/// carries no createdAt — the approved schema §drivers defines no created_at column.
/// </summary>
public record DriverDto(long Id, long? UserId, string FullName, string LicenseNumber, string? Phone, string Status);

/// <summary>Closed value set from 04-database-schema.md §drivers (contract enums).</summary>
public static class DriverValues
{
    public const string DefaultStatus = "Active";
    public static readonly IReadOnlyList<string> Statuses = ["Active", "OffDuty", "Suspended"];
}

/// <summary>
/// Shared user-link rules (AC-5/AC-6): a linked user must exist (otherwise 400 keyed to
/// errors.userId) and may be linked to at most one driver — User 1---1 Driver per the approved
/// schema entity overview (otherwise 409). <paramref name="excludeDriverId"/> lets the update
/// handler ignore the driver being updated. The 1:1 rule is a handler pre-check by design: the
/// approved schema has no unique index on user_id.
/// </summary>
internal static class DriverUserLink
{
    public static async Task EnsureValidAsync(IAppDbContext db, long? userId, long? excludeDriverId, CancellationToken cancellationToken)
    {
        if (userId is null)
        {
            return;
        }

        var userExists = await db.Users.AsNoTracking()
            .AnyAsync(u => u.Id == userId, cancellationToken);
        if (!userExists)
        {
            // Field-level failure so the middleware's 400 ProblemDetails carries errors.userId (AC-6).
            throw new ValidationException(
            [
                new ValidationFailure(nameof(CreateDriverCommand.UserId), $"User {userId} does not exist."),
            ]);
        }

        var alreadyLinked = await db.Drivers.AsNoTracking()
            .AnyAsync(d => d.UserId == userId && (excludeDriverId == null || d.Id != excludeDriverId), cancellationToken);
        if (alreadyLinked)
        {
            throw new ConflictException(nameof(Domain.AppUser), userId);
        }
    }
}

/// <summary>AC-1: create a driver. 201 with the created DTO; duplicate license → 409 (AC-3); broken or taken user link → 400/409 (AC-5/AC-6).</summary>
public record CreateDriverCommand(string FullName, string LicenseNumber, string? Phone, string? Status, long? UserId)
    : ICommand<DriverDto>;

public class CreateDriverValidator : AbstractValidator<CreateDriverCommand>
{
    public CreateDriverValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(200);
        RuleFor(x => x.LicenseNumber).NotEmpty().MaximumLength(40);
        RuleFor(x => x.Phone).MaximumLength(40);
        RuleFor(x => x.Status).Must(s => s is null || DriverValues.Statuses.Contains(s))
            .WithMessage("Status must be one of: Active, OffDuty, Suspended.");
    }
}

public class CreateDriverHandler(IAppDbContext db) : IRequestHandler<CreateDriverCommand, DriverDto>
{
    public async Task<DriverDto> Handle(CreateDriverCommand request, CancellationToken cancellationToken)
    {
        // Omitted status defaults to Active (AC-4); the validator rejected bad values.
        var status = string.IsNullOrWhiteSpace(request.Status) ? DriverValues.DefaultStatus : request.Status;
        var license = request.LicenseNumber.Trim();

        if (await db.Drivers.AnyAsync(d => d.LicenseNumber == license, cancellationToken))
        {
            throw new ConflictException(nameof(Domain.Driver), license);
        }

        await DriverUserLink.EnsureValidAsync(db, request.UserId, excludeDriverId: null, cancellationToken);

        var driver = Domain.Driver.Create(request.FullName, license, request.Phone, status, request.UserId);
        db.Drivers.Add(driver);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Race backstop: concurrent creates can both pass the pre-check; the unique
            // index on license_number arbitrates and the loser surfaces as 409, not 500.
            throw new ConflictException(nameof(Domain.Driver), license);
        }

        return new DriverDto(driver.Id, driver.UserId, driver.FullName, driver.LicenseNumber, driver.Phone, driver.Status);
    }

    internal static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is not null && ex.InnerException.Message.Contains("UNIQUE", StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// AC-6/AC-8: full update (PUT). NotFoundException (→404) when absent; duplicate license → 409
/// (dup-check excludes self); a taken user link → 409 (excludes self); null/omitted userId clears
/// the link (nullable DTO collapses both — the frontend must always send the current link value).
/// </summary>
public record UpdateDriverCommand(long Id, string FullName, string LicenseNumber, string? Phone, string? Status, long? UserId)
    : ICommand<DriverDto>;

public class UpdateDriverValidator : AbstractValidator<UpdateDriverCommand>
{
    public UpdateDriverValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0);
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(200);
        RuleFor(x => x.LicenseNumber).NotEmpty().MaximumLength(40);
        RuleFor(x => x.Phone).MaximumLength(40);
        RuleFor(x => x.Status).Must(s => s is null || DriverValues.Statuses.Contains(s))
            .WithMessage("Status must be one of: Active, OffDuty, Suspended.");
    }
}

public class UpdateDriverHandler(IAppDbContext db) : IRequestHandler<UpdateDriverCommand, DriverDto>
{
    public async Task<DriverDto> Handle(UpdateDriverCommand request, CancellationToken cancellationToken)
    {
        var driver = await db.Drivers
            .SingleOrDefaultAsync(d => d.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Driver), request.Id);

        var license = request.LicenseNumber.Trim();
        var status = string.IsNullOrWhiteSpace(request.Status) ? DriverValues.DefaultStatus : request.Status;

        if (await db.Drivers.AnyAsync(d => d.Id != request.Id && d.LicenseNumber == license, cancellationToken))
        {
            throw new ConflictException(nameof(Domain.Driver), license);
        }

        await DriverUserLink.EnsureValidAsync(db, request.UserId, excludeDriverId: request.Id, cancellationToken);

        driver.Update(request.FullName, license, request.Phone, status, request.UserId);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (CreateDriverHandler.IsUniqueViolation(ex))
        {
            throw new ConflictException(nameof(Domain.Driver), license);
        }

        return new DriverDto(driver.Id, driver.UserId, driver.FullName, driver.LicenseNumber, driver.Phone, driver.Status);
    }
}

/// <summary>
/// AC-8: hard delete (v1 — no soft-delete column; the 409-when-referenced-by-a-route rule lands
/// with routes in LOGI-0009). NotFoundException (→404) when absent.
/// </summary>
public record DeleteDriverCommand(long Id) : ICommand;

public class DeleteDriverHandler(IAppDbContext db) : IRequestHandler<DeleteDriverCommand>
{
    public async Task Handle(DeleteDriverCommand request, CancellationToken cancellationToken)
    {
        var driver = await db.Drivers
            .SingleOrDefaultAsync(d => d.Id == request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(Domain.Driver), request.Id);

        db.Drivers.Remove(driver);
        await db.SaveChangesAsync(cancellationToken);
    }
}