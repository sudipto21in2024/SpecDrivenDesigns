using System.Text.Json;
using FluentValidation;
using LogiFlow.Application.Common;
using Microsoft.AspNetCore.Http.Json;

namespace LogiFlow.Api.Middleware;

/// <summary>
/// Converts application exceptions into the RFC 7807 ProblemDetails envelope defined in
/// 05-api-contract-standards.md: ValidationException → 400 with errors map,
/// NotFoundException → 404, anything else → 500 (details hidden).
/// </summary>
public class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

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

            await WriteProblemAsync(context, StatusCodes.Status400BadRequest,
                "https://logiflow.dev/errors/validation", "Validation failed",
                "One or more validation errors occurred.", errors);
        }
        catch (NotFoundException notFound)
        {
            await WriteProblemAsync(context, StatusCodes.Status404NotFound,
                "https://logiflow.dev/errors/not-found", "Resource not found",
                notFound.Message, null);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unhandled exception while processing {Method} {Path}",
                context.Request.Method, context.Request.Path);
            await WriteProblemAsync(context, StatusCodes.Status500InternalServerError,
                "https://logiflow.dev/errors/internal", "Internal server error",
                "An unexpected error occurred.", null);
        }
    }

    private static string ToCamelCase(string name) =>
        string.IsNullOrEmpty(name) ? name : char.ToLowerInvariant(name[0]) + name[1..];

    private static async Task WriteProblemAsync(HttpContext context, int statusCode, string type,
        string title, string? detail, Dictionary<string, string[]>? errors)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/problem+json";

        var problem = new Dictionary<string, object?>
        {
            ["type"] = type,
            ["title"] = title,
            ["status"] = statusCode,
            ["detail"] = detail,
            ["errors"] = errors,
            ["traceId"] = context.TraceIdentifier,
        };

        await context.Response.WriteAsync(JsonSerializer.Serialize(problem, JsonOptions));
    }
}
