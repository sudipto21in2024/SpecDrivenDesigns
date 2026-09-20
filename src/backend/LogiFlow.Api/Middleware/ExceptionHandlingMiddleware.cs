using FluentValidation;
using LogiFlow.Application.Common;

namespace LogiFlow.Api.Middleware;

/// <summary>
/// Converts application exceptions into the RFC 7807 ProblemDetails envelope defined in
/// 05-api-contract-standards.md: ValidationException → 400 with errors map,
/// UnauthorizedException → 401 with a bearer challenge, NotFoundException → 404,
/// anything else → 500 (details hidden).
/// </summary>
public class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (ValidationException validationException)
        {
            var errors = validationException.Errors
                .GroupBy(failure => failure.PropertyName, failure => failure.ErrorMessage)
                .ToDictionary(group => ToCamelCase(group.Key), group => group.ToArray());

            await ProblemDetailsWriter.WriteAsync(context, StatusCodes.Status400BadRequest,
                "https://logiflow.dev/errors/validation", "Validation failed",
                "One or more validation errors occurred.", errors);
        }
        catch (UnauthorizedException unauthorized)
        {
            // Raised by the auth handlers for bad credentials or an unusable refresh token
            // (LOGI-0003 AC-2, AC-7). A bearer challenge accompanies the 401 for consistency with
            // the framework's own authentication failures.
            await ProblemDetailsWriter.WriteAsync(context, StatusCodes.Status401Unauthorized,
                "https://logiflow.dev/errors/unauthorized", "Unauthorized",
                unauthorized.Message, null, bearerChallenge: true);
        }
        catch (NotFoundException notFound)
        {
            await ProblemDetailsWriter.WriteAsync(context, StatusCodes.Status404NotFound,
                "https://logiflow.dev/errors/not-found", "Resource not found",
                notFound.Message, null);
        }
        catch (ConflictException conflict)
        {
            // Duplicate unique key (e.g. vehicle plate number, LOGI-0004 AC-3).
            await ProblemDetailsWriter.WriteAsync(context, StatusCodes.Status409Conflict,
                "https://logiflow.dev/errors/conflict", "Conflict",
                conflict.Message, null);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unhandled exception while processing {Method} {Path}",
                context.Request.Method, context.Request.Path);
            await ProblemDetailsWriter.WriteAsync(context, StatusCodes.Status500InternalServerError,
                "https://logiflow.dev/errors/internal", "Internal server error",
                "An unexpected error occurred.", null);
        }
    }

    private static string ToCamelCase(string name) =>
        string.IsNullOrEmpty(name) ? name : char.ToLowerInvariant(name[0]) + name[1..];
}
