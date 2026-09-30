using System.Text.Json;
using FluentValidation;
using FluentValidation.Results;
using LogiFlow.Application.Features.Routes;

namespace LogiFlow.Api.Endpoints;

public static class RoutePayloadParsers
{
    private static readonly HashSet<string> ServerOwned =
        new(StringComparer.OrdinalIgnoreCase) { "id", "status", "createdAt", "updatedAt" };

    public static void ValidateNoServerOwned(JsonElement body)
    {
        var rejected = new List<ValidationFailure>();
        foreach (var prop in body.EnumerateObject())
        {
            if (ServerOwned.Contains(prop.Name))
                rejected.Add(new ValidationFailure(prop.Name, $"Field '{prop.Name}' is server-owned."));
        }
        if (rejected.Count > 0) throw new ValidationException(rejected);
    }

    public static CreateRouteCommand ParseCreate(JsonElement body)
    {
        ValidateNoServerOwned(body);
        var failures = new List<ValidationFailure>();
        string? name = null;
        DateTime? plannedStart = null, plannedEnd = null;
        long? vehicleId = null, driverId = null;

        if (!body.TryGetProperty("name", out var nProp) || nProp.ValueKind != JsonValueKind.String)
            failures.Add(new ValidationFailure("name", "Name is required and must be a string."));
        else name = nProp.GetString();

        if (!body.TryGetProperty("plannedStart", out var sProp) || !sProp.TryGetDateTime(out var sVal))
            failures.Add(new ValidationFailure("plannedStart", "Planned start is required."));
        else plannedStart = sVal;

        if (!body.TryGetProperty("plannedEnd", out var eProp) || !eProp.TryGetDateTime(out var eVal))
            failures.Add(new ValidationFailure("plannedEnd", "Planned end is required."));
        else plannedEnd = eVal;

        if (body.TryGetProperty("vehicleId", out var vProp))
        {
            if (vProp.ValueKind == JsonValueKind.Null) vehicleId = null;
            else if (vProp.ValueKind == JsonValueKind.Number && vProp.TryGetInt64(out var vVal)) vehicleId = vVal;
            else failures.Add(new ValidationFailure("vehicleId", "VehicleId must be an integer."));
        }

        if (body.TryGetProperty("driverId", out var dProp))
        {
            if (dProp.ValueKind == JsonValueKind.Null) driverId = null;
            else if (dProp.ValueKind == JsonValueKind.Number && dProp.TryGetInt64(out var dVal)) driverId = dVal;
            else failures.Add(new ValidationFailure("driverId", "DriverId must be an integer."));
        }

        if (failures.Count > 0) throw new ValidationException(failures);
        return new CreateRouteCommand(name!, plannedStart!.Value, plannedEnd!.Value, vehicleId, driverId);
    }

    /// <summary>
    /// Parses the assign body (AC-5). The contract marks <c>shipmentId</c> required, and every
    /// failure is reported as a field-keyed ValidationFailure so the ProblemDetails `errors` map
    /// names `shipmentId` — the same shape ParseCreate/ParseUpdate use.
    /// </summary>
    public static AssignShipmentToRouteCommand ParseAssign(long routeId, JsonElement body)
    {
        var failures = new List<ValidationFailure>();

        if (!body.TryGetProperty("shipmentId", out var sProp))
            failures.Add(new ValidationFailure("shipmentId", "ShipmentId is required."));
        else if (sProp.ValueKind == JsonValueKind.Number && sProp.TryGetInt64(out var sVal) && sVal > 0)
            return new AssignShipmentToRouteCommand(routeId, sVal);
        else
            failures.Add(new ValidationFailure("shipmentId", "ShipmentId must be a positive integer."));

        throw new ValidationException(failures);
    }

    public static UpdateRouteCommand ParseUpdate(long id, JsonElement body)
    {
        ValidateNoServerOwned(body);
        if (body.EnumerateObject().Count() == 0)
            throw new ValidationException(new[] { new ValidationFailure("body", "At least one field is required.") });

        var failures = new List<ValidationFailure>();
        string? name = null;
        DateTime? plannedStart = null, plannedEnd = null;
        long? vehicleId = null, driverId = null;
        bool vehicleIdSpecified = false, driverIdSpecified = false;

        if (body.TryGetProperty("name", out var nProp))
        {
            if (nProp.ValueKind != JsonValueKind.String) failures.Add(new ValidationFailure("name", "Name must be string."));
            else name = nProp.GetString();
        }

        if (body.TryGetProperty("plannedStart", out var sProp))
        {
            if (!sProp.TryGetDateTime(out var sVal)) failures.Add(new ValidationFailure("plannedStart", "Planned start is invalid."));
            else plannedStart = sVal;
        }

        if (body.TryGetProperty("plannedEnd", out var eProp))
        {
            if (!eProp.TryGetDateTime(out var eVal)) failures.Add(new ValidationFailure("plannedEnd", "Planned end is invalid."));
            else plannedEnd = eVal;
        }

        if (body.TryGetProperty("vehicleId", out var vProp))
        {
            vehicleIdSpecified = true;
            if (vProp.ValueKind == JsonValueKind.Null) vehicleId = null;
            else if (vProp.ValueKind == JsonValueKind.Number && vProp.TryGetInt64(out var vVal)) vehicleId = vVal;
            else failures.Add(new ValidationFailure("vehicleId", "VehicleId must be an integer."));
        }

        if (body.TryGetProperty("driverId", out var dProp))
        {
            driverIdSpecified = true;
            if (dProp.ValueKind == JsonValueKind.Null) driverId = null;
            else if (dProp.ValueKind == JsonValueKind.Number && dProp.TryGetInt64(out var dVal)) driverId = dVal;
            else failures.Add(new ValidationFailure("driverId", "DriverId must be an integer."));
        }

        if (failures.Count > 0) throw new ValidationException(failures);
        return new UpdateRouteCommand(id, name, plannedStart, plannedEnd, vehicleId, vehicleIdSpecified, driverId, driverIdSpecified);
    }
}
