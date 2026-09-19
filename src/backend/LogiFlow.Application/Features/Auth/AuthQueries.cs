using LogiFlow.Application.Abstractions;
using LogiFlow.Application.Common;
using LogiFlow.Application.Messaging;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Application.Features.Auth;

/// <summary>AC-8: identity of the caller, resolved from the access token rather than the request body.</summary>
public record GetCurrentUserQuery : IQuery<AuthUserDto>;

public class GetCurrentUserQueryHandler(IAppDbContext db, ICurrentUser currentUser)
    : IRequestHandler<GetCurrentUserQuery, AuthUserDto>
{
    public async Task<AuthUserDto> Handle(GetCurrentUserQuery request, CancellationToken cancellationToken)
    {
        // The endpoint is [Authorize]d, so these are present in practice; the guard keeps the handler
        // honest if it is ever dispatched from an unauthenticated context.
        if (currentUser.UserId is not { } userId)
        {
            throw new UnauthorizedException("No authenticated user is associated with this request.");
        }

        // Roles are re-read from storage rather than trusted from the token claim, so a role change
        // takes effect on the next call instead of waiting for the access token to expire.
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken)
            ?? throw new UnauthorizedException("The authenticated user no longer exists.");

        return new AuthUserDto(user.Id, user.Email ?? string.Empty, user.FullName, user.Role);
    }
}