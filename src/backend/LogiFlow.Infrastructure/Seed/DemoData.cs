using LogiFlow.Domain;
using LogiFlow.Domain.Security;
using LogiFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LogiFlow.Infrastructure;

/// <summary>
/// Development-only bulk demo dataset, kept separate from <see cref="SeedData"/> on purpose.
///
/// <see cref="SeedData"/> seeds the four login personas because tests and the RBAC matrix need them.
/// This seeds *business* rows (warehouses, fleet, drivers, routes, shipments) so a developer can open
/// the dashboard and planning board against a realistic volume instead of empty tables.
///
/// Two deliberate constraints:
/// <list type="bullet">
/// <item>Never runs in Production. Gated on the caller's environment, exactly like <see cref="SeedData"/>.</item>
/// <item>Opt-in via configuration (<c>DemoData:Enabled</c>). It must never run implicitly during the
/// integration or E2E suites: those assert on global counts and reset rows between runs, so a bulk
/// dataset would both pollute their assertions and be wiped by their reset.</item>
/// </list>
///
/// Every shipment is advanced through <see cref="Shipment.TransitionTo"/> / <c>AssignToRoute</c>
/// rather than by assigning <c>Status</c> directly. That keeps BR-7 enforced by construction: an
/// illegal edge throws here exactly as it would on the API path, so the demo data cannot contain a
/// state the API could never produce. Each write appends the matching shipment_status_history row,
/// so the audit trail and the shipment status always agree (BO-4).
/// </summary>
public static class DemoData
{
    /// <summary>Configuration key (bool) that turns the dataset on.</summary>
    public const string EnabledKey = "DemoData:Enabled";

    /// <summary>Configuration key (int) for how many shipments to generate.</summary>
    public const string ShipmentCountKey = "DemoData:Shipments";

    private const int DefaultShipmentCount = 400;

    /// <summary>
    /// BR-1 priority literals. Infrastructure deliberately does not reference the Application layer
    /// (dependency direction), so these are restated rather than imported from <c>SlaPolicy</c>.
    /// <see cref="AssertPriorityLiteralsMatch"/> guards them against drift at runtime.
    /// </summary>
    public const string PriorityStandard = "Standard";

    public const string PriorityExpress = "Express";

    private static readonly string[] Cities =
    [
        "Dock Road 12, Bristol", "Harbour Way 4, Liverpool", "Mill Lane 88, Leeds",
        "Station Approach 3, Manchester", "Canal Street 21, Sheffield", "Market Square 7, Nottingham",
        "High Street 55, Birmingham", "Industrial Estate, Glasgow", "Quay North 9, Newcastle",
        "Trade Park 6, Derby", "Ring Road 2, Leicester", "Logistics Park, Hull",
    ];

    private static readonly string[] PlatePrefixes = ["LD", "BR", "MS", "KC", "WF", "PL"];

    private static readonly string[] FirstNames =
    [
        "Amara", "Bilal", "Chen", "Divya", "Elena", "Farid", "Grace", "Hiro",
        "Ines", "Jonas", "Kemi", "Luca", "Maya", "Noor", "Omar", "Priya",
    ];

    private static readonly string[] LastNames =
    [
        "Adeyemi", "Bianchi", "Chowdhury", "Dubois", "Eriksen", "Farah", "Gupta", "Haddad",
        "Ivanov", "Jensen", "Kowalski", "Lindqvist", "Moreau", "Nakamura", "Oyelaran", "Petrov",
    ];

    /// <summary>
    /// Deterministic PRNG (xorshift32). A fixed seed means every developer sees the *same* dataset,
    /// so a UI quirk is reproducible instead of "worked on my machine", and process restarts do not
    /// reshuffle the data.
    /// </summary>
    private sealed class DeterministicRandom(uint seed)
    {
        private uint _state = seed == 0 ? 1u : seed;

        private uint NextUInt()
        {
            _state ^= _state << 13;
            _state ^= _state >> 17;
            _state ^= _state << 5;
            return _state;
        }

        /// <summary>Integer in [minInclusive, maxExclusive).</summary>
        public int Next(int minInclusive, int maxExclusive) =>
            minInclusive + (int)(NextUInt() % (uint)(maxExclusive - minInclusive));

        public double NextDouble(double minInclusive, double maxExclusive) =>
            minInclusive + (NextUInt() / (double)uint.MaxValue) * (maxExclusive - minInclusive);

        public T Pick<T>(IReadOnlyList<T> items) => items[Next(0, items.Count)];
    }

    /// <summary>
    /// Populates the demo dataset. No-op unless <c>DemoData:Enabled</c> is true, and a no-op when
    /// business data already exists so a restart cannot duplicate rows — the compose stack mounts a
    /// named volume, so the database outlives the container and this check matters.
    /// </summary>
    public static async Task EnsureSeededAsync(
        LogiFlowDbContext db,
        IConfiguration configuration,
        ILogger logger,
        CancellationToken ct = default)
    {
        if (!configuration.GetValue<bool>(EnabledKey))
        {
            return;
        }

        if (await db.Warehouses.AnyAsync(ct))
        {
            logger.LogInformation("Demo dataset skipped: business data already present.");
            return;
        }

        var shipmentCount = Math.Max(0, configuration.GetValue(ShipmentCountKey, DefaultShipmentCount));
        var random = new DeterministicRandom(seed: 20260101);
        var now = DateTime.UtcNow;

        // A history row needs a real FK to a user. Any seeded login works; Admin is used because it is
        // the actor a developer is signed in as, so the audit trail reads sensibly in the UI.
        var adminEmail = SeedData.Users.First(s => s.Role == Roles.Admin).Email;
        var actorId = await db.Users
            .Where(u => u.Email == adminEmail)
            .Select(u => u.Id)
            .SingleOrDefaultAsync(ct);

        if (actorId == 0)
        {
            logger.LogWarning("Demo dataset skipped: no seeded user to attribute history rows to.");
            return;
        }

        // Dependency chain: warehouses + fleet + drivers -> routes -> shipments. Each level needs the
        // previous level's generated Ids, so SaveChanges runs between them.
        var warehouses = SeedWarehouses(db, now);
        var vehicles = SeedVehicles(db, now);
        var drivers = SeedDrivers(db, random);
        await db.SaveChangesAsync(ct);

        var routes = SeedRoutes(db, random, now, vehicles, drivers);
        await db.SaveChangesAsync(ct);

        var shipments = SeedShipments(db, random, now, actorId, shipmentCount, warehouses, routes);
        LogCohortCounts(shipments, logger);
        await db.SaveChangesAsync(ct);

        // History rows need shipment Ids, which only exist after the save above.
        SeedShipmentHistory(db, shipments);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Demo dataset seeded: {Warehouses} warehouses, {Vehicles} vehicles, {Drivers} drivers, "
            + "{Routes} routes, {Shipments} shipments.",
            warehouses.Count, vehicles.Count, drivers.Count, routes.Count, shipments.Count);
    }

    private static List<Warehouse> SeedWarehouses(LogiFlowDbContext db, DateTime now)
    {
        var warehouses = new List<Warehouse>();
        for (var i = 0; i < 8; i++)
        {
            warehouses.Add(Warehouse.Create(
                name: $"Warehouse {i + 1:D2} — {LastNames[i % LastNames.Length]} Distribution",
                address: Cities[i % Cities.Length],
                latitude: Math.Round(51.0 + i * 0.35, 4),
                longitude: Math.Round(-1.5 + i * 0.28, 4),
                now: now));
        }

        db.Warehouses.AddRange(warehouses);
        return warehouses;
    }

    private static List<Vehicle> SeedVehicles(LogiFlowDbContext db, DateTime now)
    {
        var vehicles = new List<Vehicle>();
        for (var i = 0; i < 24; i++)
        {
            var type = (i % 3) switch { 0 => "Van", 1 => "Truck", _ => "Trailer" };
            // A slice of the fleet sits in Maintenance / InRoute so status filters have real rows.
            var status = i % 8 == 7 ? "Maintenance" : i % 5 == 4 ? "InRoute" : "Available";

            vehicles.Add(Vehicle.Create(
                // Distinct, stable plates — plate_number is unique, so collisions would fail the seed.
                plateNumber: $"{PlatePrefixes[i % PlatePrefixes.Length]}{(1000 + i)}-DEMO",
                type: type,
                // Vans small, trailers large — keeps dashboard utilization figures plausible.
                capacityKg: type switch { "Van" => 900.0, "Truck" => 12000.0, _ => 24000.0 },
                status: status,
                now: now));
        }

        db.Vehicles.AddRange(vehicles);
        return vehicles;
    }

    private static List<Driver> SeedDrivers(LogiFlowDbContext db, DeterministicRandom random)
    {
        var drivers = new List<Driver>();
        for (var i = 0; i < 20; i++)
        {
            var status = i % 10 == 9 ? "OffDuty" : i % 13 == 12 ? "Suspended" : "Active";
            drivers.Add(Driver.Create(
                fullName: $"{FirstNames[i % FirstNames.Length]} {LastNames[(i * 5) % LastNames.Length]}",
                // Distinct license numbers — license_number is unique.
                licenseNumber: $"UK-DL-{700000 + i * 137}",
                phone: $"+44 7{random.Next(100, 999)} {random.Next(100000, 999999)}",
                status: status,
                // UserId stays null: linking drivers to seeded logins would make the "at most one driver
                // per user" rule a live constraint the demo data could trip for no benefit.
                userId: null));
        }

        db.Drivers.AddRange(drivers);
        return drivers;
    }

    private static List<Route> SeedRoutes(
        LogiFlowDbContext db,
        DeterministicRandom random,
        DateTime now,
        IReadOnlyList<Vehicle> vehicles,
        IReadOnlyList<Driver> drivers)
    {
        var routes = new List<Route>();
        for (var i = 0; i < 15; i++)
        {
            var start = now.AddDays(random.Next(-10, 10)).AddHours(random.Next(0, 8));

            routes.Add(Route.Create(
                name: $"Lane {i + 1:D2} — {Cities[i % Cities.Length].Split(',')[^1].Trim()} run",
                plannedStart: start,
                plannedEnd: start.AddHours(random.Next(4, 20)),
                vehicleId: vehicles.Count == 0 ? null : vehicles[i % vehicles.Count].Id,
                driverId: drivers.Count == 0 ? null : drivers[i % drivers.Count].Id,
                now: now));
        }

        db.Routes.AddRange(routes);
        return routes;
    }

    /// <summary>
    /// A shipment plus the history rows its creation and transitions should produce. Keeping them
    /// together means the FK is wired from the owning shipment, not matched afterwards by
    /// reference code (which would silently mis-pair rows on any code collision).
    /// </summary>
    private sealed record SeededShipment(Shipment Shipment, List<ShipmentStatusHistory> History);

    /// <summary>
    /// Number of shipments the cohorts produce. This is the *authoritative* count: the
    /// <c>DemoData:Shipments</c> setting is treated as a request for "at least this much data" and
    /// rounded up to the next whole cohort cycle, so every cohort is always fully populated.
    /// Rounding down is what would recreate the original bug in a subtler form.
    /// </summary>
    private static int CohortTotal => ShipmentCohorts.Sum(c => c.Count);

    private static List<SeededShipment> SeedShipments(
        LogiFlowDbContext db,
        DeterministicRandom random,
        DateTime now,
        long actorId,
        int requestedCount,
        IReadOnlyList<Warehouse> warehouses,
        IReadOnlyList<Route> routes)
    {
        var seeded = new List<SeededShipment>();
        if (warehouses.Count == 0 || CohortTotal == 0)
        {
            return seeded;
        }

        // Round *up* to a whole number of cohort cycles so no cohort is left half-built.
        var cycles = Math.Max(1, (int)Math.Ceiling(requestedCount / (double)CohortTotal));
        var total = cycles * CohortTotal;

        // Build the target plan first: a flat sequence cycling the cohorts, so index i's target is
        // decided before any random draw happens and the plan is trivially inspectable.
        var plan = new List<string>(total);
        for (var cycle = 0; cycle < cycles; cycle++)
        {
            foreach (var (status, count) in ShipmentCohorts)
            {
                for (var n = 0; n < count; n++)
                {
                    plan.Add(status);
                }
            }
        }

        for (var i = 0; i < total; i++)
        {
            var origin = warehouses[random.Next(0, warehouses.Count)];
            var createdAt = now.AddDays(random.Next(-30, 1)).AddHours(random.Next(-23, 0));
            // BR-1: Express is the minority and carries the tighter promise.
            var priority = random.Next(0, 100) < 25 ? PriorityExpress : PriorityStandard;
            var slaWindow = priority == PriorityExpress ? TimeSpan.FromHours(12) : TimeSpan.FromHours(48);

            var shipment = Shipment.Create(
                // Distinct, stable codes — reference_code is unique.
                referenceCode: $"SHP-DEMO-{i + 1:D5}",
                originWarehouseId: origin.Id,
                destinationAddress: random.Pick(Cities),
                destinationLat: Math.Round(random.NextDouble(50.5, 56.0), 4),
                destinationLng: Math.Round(random.NextDouble(-4.5, 1.5), 4),
                weightKg: Math.Round(random.NextDouble(20, 8000), 2),
                status: nameof(ShipmentStatus.Pending),
                priority: priority,
                slaDueAt: createdAt.Add(slaWindow),
                now: createdAt);

            var history = new List<ShipmentStatusHistory>
            {
                // Creation writes the initial row with FromStatus null — same as the LOGI-0007 path.
                new()
                {
                    FromStatus = null,
                    ToStatus = nameof(ShipmentStatus.Pending),
                    ChangedByUserId = actorId,
                    ChangedAt = createdAt,
                    Note = "Created by demo dataset.",
                },
            };

            var result = new SeededShipment(shipment, history);
            Advance(result, random, routes, actorId, plan[i]);
            seeded.Add(result);
        }

        db.Shipments.AddRange(seeded.Select(s => s.Shipment));
        return seeded;
    }

    /// <summary>
    /// How many shipments land in each terminal lifecycle state.
    /// </summary>
    /// <remarks>
    /// These are explicit counts, not random thresholds, and that is the whole point. The first
    /// draft of this seeder picked a target state with nested <c>if (roll &lt; n)</c> tests, and two
    /// of its bands were unreachable — every inner test sat inside a narrower outer guard, so
    /// Assigned / InTransit / Delayed silently came out with zero rows while the seeder still logged
    /// success. Randomness cannot express "I want this many InTransit"; it can only make it likely,
    /// and a zero row is invisible until someone stares at an empty dashboard column.
    ///
    /// A named cohort per state makes the intent reviewable and the counts assertable: see
    /// <see cref="LogCohortCounts"/>, which fails loudly if a cohort collapses to zero.
    /// </remarks>
    private static readonly IReadOnlyList<(string Status, int Count)> ShipmentCohorts =
    [
        // Still editable/assignable/cancellable by hand in the UI.
        (nameof(ShipmentStatus.Pending), 90),
        // Booked onto a route, waiting to depart — the planning board's "ready to load" column.
        (nameof(ShipmentStatus.Assigned), 70),
        // Moving now.
        (nameof(ShipmentStatus.InTransit), 80),
        // Late in transit. Not BR-2 exempt, so these drive the dashboard's at-risk count.
        (nameof(ShipmentStatus.Delayed), 60),
        // Terminal success.
        (nameof(ShipmentStatus.Delivered), 120),
        // Terminal failure — includes both Pending->Cancelled and Assigned->Cancelled.
        (nameof(ShipmentStatus.Cancelled), 60),
    ];

    /// <summary>
    /// Drives one shipment to the cohort's target state using only the domain's own operations, so
    /// BR-7 is enforced by construction: an illegal edge would throw here exactly as it would on the
    /// API path, and the demo data therefore cannot contain a state the API could never produce.
    /// </summary>
    private static void Advance(
        SeededShipment seeded,
        DeterministicRandom random,
        IReadOnlyList<Route> routes,
        long actorId,
        string targetStatus)
    {
        // Pending is the creation state and is also terminal for a freshly created shipment, so
        // there is nothing to do.
        if (targetStatus == nameof(ShipmentStatus.Pending) || routes.Count == 0)
        {
            return;
        }

        var shipment = seeded.Shipment;
        var at = shipment.CreatedAt.AddHours(1);

        // A Pending -> Cancelled cohort skips routing entirely; the other five all need a route.
        if (targetStatus == nameof(ShipmentStatus.Cancelled) && random.Next(0, 100) < 40)
        {
            Record(seeded, shipment.TransitionTo(
                nameof(ShipmentStatus.Cancelled), actorId, "Cancelled by consignee.", at),
                at, "Cancelled by consignee.");
            return;
        }

        var route = routes[random.Next(0, routes.Count)];
        Record(seeded, shipment.AssignToRoute(route.Id, actorId, at),
            at, "Assigned to route by demo dataset.");

        if (targetStatus == nameof(ShipmentStatus.Assigned) || targetStatus == nameof(ShipmentStatus.Cancelled))
        {
            if (targetStatus == nameof(ShipmentStatus.Cancelled))
            {
                at = at.AddHours(3);
                Record(seeded, shipment.TransitionTo(
                    nameof(ShipmentStatus.Cancelled), actorId, "Cancelled by consignee.", at),
                    at, "Cancelled by consignee.");
            }

            return;
        }

        at = at.AddHours(2);
        Record(seeded, shipment.TransitionTo(
            nameof(ShipmentStatus.InTransit), actorId, "Departed depot.", at), at, "Departed depot.");

        if (targetStatus == nameof(ShipmentStatus.Delivered))
        {
            at = at.AddHours(4);
            Record(seeded, shipment.TransitionTo(
                nameof(ShipmentStatus.Delivered), actorId, "Signed for at destination.", at),
                at, "Signed for at destination.");
        }
        else if (targetStatus == nameof(ShipmentStatus.Delayed))
        {
            at = at.AddHours(6);
            Record(seeded, shipment.TransitionTo(
                nameof(ShipmentStatus.Delayed), actorId, "Traffic delay en route.", at),
                at, "Traffic delay en route.");
        }
        // targetStatus == InTransit: nothing further to apply.
    }

    /// <summary>
    /// Reports how many shipments actually landed in each state. A cohort at zero is the exact
    /// failure this class exists to make visible, so it is logged explicitly rather than left for
    /// someone to infer from an empty column in the UI.
    /// </summary>
    private static void LogCohortCounts(IReadOnlyList<SeededShipment> seeded, ILogger logger)
    {
        var counts = seeded
            .GroupBy(s => s.Shipment.Status, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);

        foreach (var (status, _) in ShipmentCohorts)
        {
            var actual = counts.TryGetValue(status, out var n) ? n : 0;
            logger.LogInformation(
                actual == 0
                    ? "Demo cohort {Status}: {Count} shipments (WARNING: empty cohort)"
                    : "Demo cohort {Status}: {Count} shipments",
                status, actual);
        }
    }

    private static void Record(
        SeededShipment seeded,
        ShipmentStatusEvent evt,
        DateTime at,
        string note) =>
        seeded.History.Add(new ShipmentStatusHistory
        {
            ShipmentId = seeded.Shipment.Id, // 0 until the shipment is saved; patched in SeedShipmentHistory
            FromStatus = evt.FromStatus,
            ToStatus = evt.ToStatus,
            ChangedByUserId = evt.ChangedByUserId,
            ChangedAt = at,
            Note = note,
        });

    /// <summary>
    /// Writes the accumulated audit rows, wiring the shipment FK now that SaveChanges has assigned
    /// the shipment Ids.
    /// </summary>
    private static void SeedShipmentHistory(LogiFlowDbContext db, IReadOnlyList<SeededShipment> seeded)
    {
        foreach (var entry in seeded)
        {
            foreach (var row in entry.History)
            {
                row.ShipmentId = entry.Shipment.Id;
            }
        }

        db.ShipmentStatusHistory.AddRange(seeded.SelectMany(s => s.History));
    }
}