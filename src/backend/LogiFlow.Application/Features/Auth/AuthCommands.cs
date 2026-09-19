using FluentValidation;
using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using LogiFlow.Domain;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Auth;

/// <summary>AC-1/AC-2/AC-3: exchange email + password for a token pair.</summary>
public record LoginCommand(string Email, string Password) : ICommand<AuthTokensDto>;

public class LoginCommandValidator : AbstractValidator<LoginCommand>
{
    public LoginCommandValidator()
    {
        // Mirrors the contract's LoginRequest (email format, maxLength 256; password 1..128).
        // Presence/shape only — credential correctness is never a validation concern (AC-3 vs AC-2).
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(256);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(128);
    }
}

public class LoginCommandHandler(IAppDbContext db, IUserCredentials credentials, ITokenIssuer tokens)
    : IRequestHandler<LoginCommand, AuthTokensDto>
{
    public async Task<AuthTokensDto> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var user = await credentials.FindByEmailAsync(request.Email, cancellationToken);

        // Single failure mode for "no such user" and "wrong password" (AC-2 anti-enumeration), and no
        // token is issued in either case. Absent users are short-circuited so the response time does
        // not advertise existence through a skipped hash verification.
        if (user is null || !await credentials.CheckPasswordAsync(user, request.Password, cancellationToken))
        {
            throw new UnauthorizedException("Invalid email or password.");
        }

        var now = DateTime.UtcNow;
        var result = TokenPairFactory.Issue(db, tokens, user, now);
        await db.SaveChangesAsync(cancellationToken);

        return result;
    }
}

/// <summary>AC-7: rotate a refresh token — the presented token is consumed and replaced.</summary>
public record RefreshCommand(string RefreshToken) : ICommand<AuthTokensDto>;

public class RefreshCommandValidator : AbstractValidator<RefreshCommand>
{
    public RefreshCommandValidator() => RuleFor(x => x.RefreshToken).NotEmpty().MaximumLength(512);
}

public class RefreshCommandHandler(IAppDbContext db, ITokenIssuer tokens) : IRequestHandler<RefreshCommand, AuthTokensDto>
{
    public async Task<AuthTokensDto> Handle(RefreshCommand request, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var hash = tokens.HashRefreshToken(request.RefreshToken);

        var stored = await db.RefreshTokens
            .SingleOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);

        // Unknown, expired and already-rotated tokens are indistinguishable to the caller (AC-7).
        if (stored is null || !stored.IsActive(now))
        {
            throw new UnauthorizedException("The refresh token is invalid or has expired.");
        }

        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == stored.UserId, cancellationToken)
            ?? throw new UnauthorizedException("The refresh token is invalid or has expired.");

        // Rotation: revoke the presented token and stage its replacement. A single SaveChangesAsync
        // below commits both changes in one transaction, so a replayed token can never succeed.
        stored.Revoke(now);
        var result = TokenPairFactory.Issue(db, tokens, user, now);
        await db.SaveChangesAsync(cancellationToken);

        return result;
    }
}

/// <summary>AC-9: revoke a refresh token so it can never be exchanged again. Idempotent.</summary>
public record LogoutCommand(string RefreshToken) : ICommand;

public class LogoutCommandValidator : AbstractValidator<LogoutCommand>
{
    public LogoutCommandValidator() => RuleFor(x => x.RefreshToken).NotEmpty().MaximumLength(512);
}

public class LogoutCommandHandler(IAppDbContext db, ITokenIssuer tokens) : IRequestHandler<LogoutCommand>
{
    public async Task Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        var hash = tokens.HashRefreshToken(request.RefreshToken);
        var stored = await db.RefreshTokens
            .SingleOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);

        // Already-revoked or unknown tokens are not an error: logout must not disclose whether the
        // token existed, and the desired end state (token unusable) already holds.
        if (stored is { RevokedAt: null })
        {
            stored.Revoke(DateTime.UtcNow);
            await db.SaveChangesAsync(cancellationToken);
        }
    }
}

/// <summary>
/// Builds an access + refresh pair and stages the refresh token for persistence. Shared by login and
/// refresh so the claim set, lifetime and DTO shape cannot drift between the two call sites.
/// </summary>
internal static class TokenPairFactory
{
    public static AuthTokensDto Issue(IAppDbContext db, ITokenIssuer tokens, AppUser user, DateTime nowUtc)
    {
        var access = tokens.CreateAccessToken(user, nowUtc);
        var rawRefreshToken = tokens.CreateRefreshTokenValue();

        db.RefreshTokens.Add(RefreshToken.Issue(
            user.Id,
            tokens.HashRefreshToken(rawRefreshToken),
            nowUtc,
            nowUtc.Add(tokens.RefreshTokenLifetime)));

        return new AuthTokensDto(
            access.Value,
            rawRefreshToken,
            access.ExpiresInSeconds,
            new AuthUserDto(user.Id, user.Email ?? string.Empty, user.FullName, user.Role));
    }
}