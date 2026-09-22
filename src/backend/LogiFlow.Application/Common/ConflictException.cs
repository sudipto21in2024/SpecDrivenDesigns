namespace LogiFlow.Application.Common;

/// <summary>
/// Thrown by handlers when a request conflicts with existing state (e.g. a duplicate
/// unique key such as a vehicle plate number); mapped to 409 by the API layer (LOGI-0004 AC-3).
/// </summary>
public class ConflictException : Exception
{
    /// <summary>Unique-key conflict: the composed message follows the original "already exists" wording (LOGI-0004).</summary>
    public ConflictException(string resource, object key)
        : base($"{resource} with key '{key}' already exists.") { }

    /// <summary>
    /// State-conflict variant whose message — surfaced verbatim as the 409 ProblemDetails
    /// detail — is supplied by the caller (LOGI-0006 AC-4: an illegal BR-7 transition names
    /// the legal next state(s)). Additive constructor; existing call sites are unaffected.
    /// </summary>
    public ConflictException(string message) : base(message) { }
}
