using System.Text.Json;
using Microsoft.AspNetCore.Http.Json;

namespace LogiFlow.Api.Middleware;

/// <summary>
/// Writes the RFC 7807 error envelope defined in 05-api-contract-standards.md.
///
/// Shared by <see cref="ExceptionHandlingMiddleware"/> and the JWT bearer challenge/forbidden
/// handlers. The latter needs it because authentication and authorization failures short-circuit
/// the middleware pipeline: they never throw, so the exception middleware alone cannot make their
/// bodies conform to the contract (LOGI-0003 AC-4, AC-5).
/// </summary>
public static class ProblemDetailsWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Replaces the current response with a ProblemDetails body. A no-op when the response has
    /// already started, which is the only correct behaviour at that point (the headers are on the
    /// wire and nothing can be rewritten).
    /// </summary>
    public static async Task WriteAsync(HttpContext context, int statusCode, string type,
        string title, string? detail, Dictionary<string, string[]>? errors = null,
        bool bearerChallenge = false)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/problem+json";

        // Must come *after* Clear(): Clear() drops the headers collected so far, so a challenge set
        // before this method is entered would be silently discarded.
        if (bearerChallenge)
        {
            AddBearerChallenge(context);
        }

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

    /// <summary>Adds the <c>WWW-Authenticate: Bearer</c> challenge required by RFC 6750 (AC-4).</summary>
    public static void AddBearerChallenge(HttpContext context) =>
        context.Response.Headers.WWWAuthenticate = "Bearer";
}