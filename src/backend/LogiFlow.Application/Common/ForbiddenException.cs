namespace LogiFlow.Application.Common;

/// <summary>
/// Thrown by handlers when the caller is authenticated but not permitted for this specific action —
/// a role rule that cannot be expressed as the endpoint's <c>x-roles</c> whitelist because it also
/// depends on the request payload (LOGI-0008 AC-10 / BR-6: a Driver may transition shipments, but
/// may never cancel one).
///
/// Mapped by the API exception middleware to a 403 ProblemDetails whose type and title match the
/// ones the ASP.NET authorization handlers write (Program.cs <c>OnForbidden</c>), so both 403
/// sources share one contract shape. Unlike the framework's handler, the detail names the rule.
/// </summary>
public class ForbiddenException(string detail = "The authenticated user is not permitted to perform this operation.")
    : Exception(detail);