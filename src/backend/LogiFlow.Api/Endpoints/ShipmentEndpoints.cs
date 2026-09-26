using System.Text.Json;
using LogiFlow.Api.Authorization;
using LogiFlow.Application.Features.Shipments;
using LogiFlow.Domain.Security;
using MediatR;

namespace LogiFlow.Api.Endpoints;

/// <summary>
/// Shipment endpoints — implementation of the /shipments, /shipments/{id},
/// /shipments/{id}/status-transitions and /shipments/{id}/status-history paths in
/// contracts/v1-openapi.yaml.
///
/// Every operation's role requirement mirrors the contract's <c>x-roles</c> annotation exactly:
/// transitions are open to Admin/Dispatcher/Driver, reads additionally to Viewer, and detail/edit
/// (LOGI-0008) are Admin/Dispatcher (+ Viewer for the read). (Driver-role own-route ownership
/// scoping is enforced from LOGI-0009/0010 — documented deferral, LOGI-0006 checkpoint answer 4;
/// the BR-6 rule that a Driver may not *cancel* a shipment is enforced in the Application handler
/// of the transition use case, because it depends on the requested target state.) A missing/invalid
/// token yields 401; a valid token with the wrong role yields 403.
/// </summary>
public static class ShipmentEndpoints
{
    public static IEndpointRouteBuilder MapShipmentEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/shipments").WithTags("Shipments");

        // Contract: POST /shipments/{id}/status-transitions — 200 with the event echo; 400 (AC-5),
        // 404 (AC-6), 409 (AC-4 — the ProblemDetails detail names the legal next states per BR-7).
        group.MapPost("/{id:long}/status-transitions", async (long id, TransitionShipmentStatusRequest request, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new TransitionShipmentStatusCommand(id, request.ToStatus, request.Note), ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Driver);

        // Contract: GET /shipments/{id}/status-history — 200 paged, oldest → newest (AC-7);
        // 404 when the shipment does not exist (AC-6).
        group.MapGet("/{id:long}/status-history", async (long id, int? page, int? pageSize, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new ListShipmentStatusHistoryQuery(id, page ?? 1, pageSize ?? 25), ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Driver, Roles.Viewer);

        // Contract: GET /shipments — 200 paged envelope (AC-6..AC-9); invalid page/pageSize or an
        // unknown filter/sort enum → 400 (spec §7). Driver is excluded until own-route scoping
        // lands (LOGI-0009/0010, spec §7 / AC-10).
        group.MapGet("/", async ([AsParameters] ListShipmentsQuery query, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(query, ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        // Contract: POST /shipments — 201 with ShipmentResponse (AC-1); 400 field-keyed validation
        // (AC-3/AC-4), 409 when the reference-code retry budget is exhausted (AC-5).
        group.MapPost("/", async (CreateShipmentRequest request, ISender sender, CancellationToken ct) =>
        {
            var dto = await sender.Send(new CreateShipmentCommand(
                request.OriginWarehouseId, request.DestinationAddress, request.WeightKg,
                request.Priority, request.DestinationLat, request.DestinationLng), ct);
            return Results.Created($"/api/v1/shipments/{dto.Id}", dto);
        })
            .RequireRoles(Roles.Admin, Roles.Dispatcher);

        // Contract: GET /shipments/{id} — shipment detail (AC-5 404, AC-6 shape); the read LOGI-0007
        // §5 deferred to this ticket. Driver is excluded until own-route scoping lands
        // (LOGI-0009/0010, spec §7 O5), consistent with GET /shipments.
        group.MapGet("/{id:long}", async (long id, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(new GetShipmentQuery(id), ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher, Roles.Viewer);

        // Contract: PATCH /shipments/{id} — edit while Pending (AC-1..AC-4); 409 once the status has
        // moved on (AC-2), 404 for an unknown id (AC-5). Viewer/Driver are not in the contract's
        // x-roles, so the framework's 403 handler answers them (AC-7).
        group.MapPatch("/{id:long}", async (long id, JsonElement body, ISender sender, CancellationToken ct) =>
            Results.Ok(await sender.Send(ShipmentUpdateRequest.ToCommand(id, body), ct)))
            .RequireRoles(Roles.Admin, Roles.Dispatcher);

        return app;
    }
}

/// <summary>Request body for a status transition (contract schema: StatusTransitionRequest).</summary>
public record TransitionShipmentStatusRequest(string? ToStatus, string? Note);

/// <summary>
/// Request body for create (contract schema: ShipmentRequest). Server-owned fields —
/// referenceCode, status, slaDueAt, createdAt/updatedAt, id — are never accepted from the client
/// and are ignored when supplied (BR-1 rule 1.2 / AC-2).
/// </summary>
public record CreateShipmentRequest(
    long OriginWarehouseId, string? DestinationAddress, double WeightKg, string? Priority,
    double? DestinationLat, double? DestinationLng);

/// <summary>
/// Request body for PATCH (contract schema: ShipmentUpdateRequest, LOGI-0008). Bound as a raw
/// <see cref="JsonElement"/> rather than a typed record on purpose: a PATCH must be able to tell
/// "field omitted" from "field explicitly set to null" (to clear a coordinate), which a typed
/// nullable record cannot express. <see cref="ToCommand"/> reads the presence set out of the raw
/// JSON so the Application layer can merge only what the client actually sent.
/// </summary>
public static class ShipmentUpdateRequest
{
    /// <summary>The five editable properties (contract ShipmentUpdateRequest).</summary>
    private static readonly HashSet<string> Editable =
        ["originWarehouseId", "destinationAddress", "weightKg", "destinationLat", "destinationLng"];

    /// <summary>
    /// Server-owned / immutable properties. Sending any of them is 400 (AC-4) rather than a silent
    /// ignore, so a client that wrongly believes it can set status or priority finds out immediately.
    /// </summary>
    private static readonly HashSet<string> ServerOwned =
        ["id", "referenceCode", "status", "slaDueAt", "createdAt", "updatedAt", "routeId", "atRisk", "priority"];

    /// <summary>Maps the raw JSON body onto the command, keeping presence and rejecting the forbidden keys.</summary>
    public static UpdateShipmentCommand ToCommand(long id, JsonElement body)
    {
        // camelCase contract names → the PascalCase property names the command/validator speak.
        var present = new List<string>();
        var rejected = new List<string>();

        foreach (var property in body.EnumerateObject())
        {
            var name = property.Name;
            if (Editable.Contains(name))
            {
                present.Add(char.ToUpperInvariant(name[0]) + name[1..]);
            }
            else if (ServerOwned.Contains(name))
            {
                // Normalised to the validator's casing so the errors map keys match the schema names.
                rejected.Add(char.ToUpperInvariant(name[0]) + name[1..]);
            }
        }

        long? origin = null;
        string? address = null;
        double? weight = null, lat = null, lng = null;
        var supplied = new HashSet<string>(present, StringComparer.Ordinal);

        // TryGetProperty + ValueKind guards keep a wrong JSON type (e.g. "weightKg": "heavy") out of
        // the command: it is simply not "supplied with a usable value", and the validator's
        // presence-gated rules still fail it as field-keyed 400 rather than throwing a 500.
        if (supplied.Contains("OriginWarehouseId") && body.TryGetProperty("originWarehouseId", out var originEl)
            && originEl.ValueKind is JsonValueKind.Number && originEl.TryGetInt64(out var originId))
        {
            origin = originId;
        }

        if (supplied.Contains("DestinationAddress") && body.TryGetProperty("destinationAddress", out var addressEl)
            && addressEl.ValueKind is JsonValueKind.String)
        {
            address = addressEl.GetString();
        }

        if (supplied.Contains("WeightKg") && body.TryGetProperty("weightKg", out var weightEl)
            && weightEl.ValueKind is JsonValueKind.Number)
        {
            weight = weightEl.GetDouble();
        }

        if (supplied.Contains("DestinationLat") && body.TryGetProperty("destinationLat", out var latEl)
            && latEl.ValueKind is JsonValueKind.Number)
        {
            lat = latEl.GetDouble();
        }

        if (supplied.Contains("DestinationLng") && body.TryGetProperty("destinationLng", out var lngEl)
            && lngEl.ValueKind is JsonValueKind.Number)
        {
            lng = lngEl.GetDouble();
        }

        return new UpdateShipmentCommand(
            id, origin, address, weight, lat, lng, present, rejected);
    }
}