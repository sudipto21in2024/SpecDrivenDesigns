namespace LogiFlow.Application.Common;

/// <summary>
/// Thrown by handlers when a request conflicts with existing state (e.g. a duplicate
/// unique key such as a vehicle plate number); mapped to 409 by the API layer (LOGI-0004 AC-3).
/// </summary>
public class ConflictException(string resource, object key)
    : Exception($"{resource} with key '{key}' already exists.");
