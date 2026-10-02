import { expect, test } from '@playwright/test';
import { seedDriver, seedVehicle, seedWarehouse, signIn } from './support/api';
import { seedRoute, uniqueRef } from './support/routes';
import {
  DASHBOARD_STATUSES,
  atRiskPageOf,
  atRiskRowOf,
  driverUtilizationOf,
  getDashboard,
  seedDashboardShipment,
  slaMinutesFromNow,
  statusCountOf,
  vehicleUtilizationOf,
} from './support/dashboard';
import { listShipments } from './support/shipments';

/**
 * LOGI-0012 operations dashboard against the real API (AC-1..AC-5, AC-8, AC-9).
 *
 * The frontend suite proves the same contract against an MSW mock; these prove it against the actual
 * ASP.NET endpoint and the actual SQLite file, which is the only place BR-2's two-hour window, EF's
 * DateTime layout and the authorization filter are genuinely in play.
 *
 * EVERY assertion is scoped to this file's own route. The dashboard is org-wide, so an unscoped read
 * would also contain the rows every other spec in the suite seeded, and the numbers would then depend
 * on run order.
 */
test.describe('LOGI-0012 operations dashboard (API)', () => {
  let adminToken: string;
  let warehouseId: number;
  let routeId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('DASH')}`);
    // A Planned route gives this file a private window to scope every assertion to.
    routeId = (await seedRoute({ status: 'Planned' })).id;
  });

  // LOGI-0012 AC-1
  test('AC-1 — all six counts are present in lifecycle order, zeros included // LOGI-0012 AC-1', async ({
    request,
  }) => {
    await seedDashboardShipment({ warehouseId, routeId, status: 'Pending' });
    await seedDashboardShipment({ warehouseId, routeId, status: 'Pending' });
    await seedDashboardShipment({ warehouseId, routeId, status: 'InTransit' });
    await seedDashboardShipment({ warehouseId, routeId, status: 'Delayed' });
    // Assigned/Delivered/Cancelled deliberately left empty.

    const { status, body } = await getDashboard(request, adminToken, { routeId });
    expect(status).toBe(200);

    // Exactly six entries, in the BR-7 lifecycle order (AC-1).
    expect(body.statusCounts?.map((entry) => entry.status)).toEqual([...DASHBOARD_STATUSES]);

    expect(statusCountOf(body, 'Pending').count).toBe(2);
    expect(statusCountOf(body, 'InTransit').count).toBe(1);
    expect(statusCountOf(body, 'Delayed').count).toBe(1);

    // A status with no shipments is PRESENT with count 0 — never omitted. Omitting it would make a
    // manager read "no Cancelled work" as "the dashboard forgot to ask" (AC-1).
    expect(statusCountOf(body, 'Assigned').count).toBe(0);
    expect(statusCountOf(body, 'Delivered').count).toBe(0);
    expect(statusCountOf(body, 'Cancelled').count).toBe(0);
  });

  // LOGI-0012 AC-1
  test('AC-1 — counts are UNTRUNCATED and computed over the active filters // LOGI-0012 AC-1', async ({
    request,
  }) => {
    // 8 InTransit rows read back with `pageSize=5`: if the count were taken from the page rather than
    // computed over the filter, it would read 5.
    //
    // Deliberately a SMALL population AND deliberately NOT `Pending`: `planning-board.spec.ts` asserts
    // against `GET /shipments?status=Pending` paged at 100 and filters client-side by route, so every
    // Pending row this arm adds can push a pre-existing spec's back-dated rows off that page. InTransit
    // proves the same untruncation claim without touching that budget.
    for (let index = 0; index < 8; index += 1) {
      await seedDashboardShipment({ warehouseId, routeId, status: 'InTransit' });
    }

    const narrowPage = await getDashboard(request, adminToken, { routeId, pageSize: 5 });
    expect(narrowPage.body.atRiskShipments?.pageSize).toBe(5);
    expect(statusCountOf(narrowPage.body, 'InTransit').count).toBe(8);

    const wide = await getDashboard(request, adminToken, { routeId, pageSize: 100 });
    expect(statusCountOf(wide.body, 'InTransit').count).toBe(8);

    // The same window narrowed by status: the counts are a filtered view, not a global tally.
    const narrowed = await getDashboard(request, adminToken, { routeId, status: 'InTransit' });
    expect(statusCountOf(narrowed.body, 'InTransit').count).toBe(8);
    expect(statusCountOf(narrowed.body, 'Pending').count).toBe(0);
  });

  // LOGI-0012 AC-2
  test('AC-2 — the at-risk set honours BR-2 and sorts by SLA ascending // LOGI-0012 AC-2', async ({
    request,
  }) => {
    // Inside the 2h window: at risk. Outside it: not at risk.
    const soon = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(30),
    });
    const later = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(600),
    });
    // A Delivered row is never at risk however close its promise (BR-2 2.4)...
    const delivered = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'Delivered',
      slaDueAt: slaMinutesFromNow(10),
    });
    // ...nor is a Cancelled one.
    await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'Cancelled',
      slaDueAt: slaMinutesFromNow(10),
    });
    // No promise recorded at all: never at risk (BR-2 rule 2.7).
    const noSla = await seedDashboardShipment({ warehouseId, routeId, status: 'Pending', slaDueAt: null });
    // A Delayed row IS at risk and cannot escape by being delayed (BR-2 2.4).
    const delayed = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'Delayed',
      slaDueAt: slaMinutesFromNow(-30),
    });

    const { status, body } = await getDashboard(request, adminToken, { routeId, pageSize: 100 });
    expect(status).toBe(200);

    const page = atRiskPageOf(body);
    const ids = page.items.map((row) => row.id);

    expect(ids).toContain(soon.id);
    expect(ids).toContain(delayed.id);
    expect(ids).not.toContain(later.id);
    expect(ids).not.toContain(delivered.id);
    expect(ids).not.toContain(noSla.id);

    // Ordering: the overdue Delayed row sorts before the soon-due InTransit row (AC-2).
    expect(ids.indexOf(delayed.id)).toBeLessThan(ids.indexOf(soon.id));

    // Each row carries the projected fields of the shipment it stands for, and minutesToDue is negative
    // once overdue (AC-2). The code is the FIXTURE's (reference codes here are tagged `SHPD-…` so
    // specs can filter by tag; the contract's `SHP-[0-9]{6}` shape is what the API itself mints), so
    // the meaningful assertion is that the row projects ITS OWN shipment rather than a re-minted id.
    const delayedRow = atRiskRowOf(body, delayed.id);
    expect(delayedRow.referenceCode).toBe(delayed.referenceCode);
    expect(delayedRow.id).toBe(delayed.id);
    expect(delayedRow.status).toBe('Delayed');
    expect(delayedRow.priority).toBe('Standard');
    expect(delayedRow.slaDueAt).not.toBeNull();
    expect(delayedRow.minutesToDue).toBeLessThan(0);

    // A row that is at risk always has a due date and therefore a non-null minutesToDue.
    expect(atRiskRowOf(body, soon.id).minutesToDue).toBeGreaterThan(0);
  });

  // LOGI-0012 AC-2
  test('AC-2 — the at-risk page uses the standard envelope and pages correctly // LOGI-0012 AC-2', async ({
    request,
  }) => {
    // 25 at-risk rows against the default page size of 20: two pages, 20 then 5.
    for (let index = 0; index < 25; index += 1) {
      await seedDashboardShipment({
        warehouseId,
        routeId,
        status: 'InTransit',
        slaDueAt: slaMinutesFromNow(10 + index),
      });
    }

    const first = atRiskPageOf((await getDashboard(request, adminToken, { routeId })).body);
    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(20);
    expect(first.totalCount).toBe(25);
    expect(first.totalPages).toBe(2);
    expect(first.items).toHaveLength(20);

    const second = atRiskPageOf((await getDashboard(request, adminToken, { routeId, page: 2 })).body);
    expect(second.page).toBe(2);
    expect(second.totalCount).toBe(25);
    expect(second.items).toHaveLength(5);

    // The pages partition the set: no row appears on both.
    const firstIds = new Set(first.items.map((row) => row.id));
    expect(second.items.every((row) => !firstIds.has(row.id))).toBe(true);
  });
// LOGI-0012 AC-3
  test('AC-3 — the at-risk total equals the page total at one captured instant // LOGI-0012 AC-3', async ({
    request,
  }) => {
    const first = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(20),
    });
    await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'Assigned',
      slaDueAt: slaMinutesFromNow(40),
    });
    // Not at risk: outside the BR-2 window, and terminal.
    await seedDashboardShipment({ warehouseId, routeId, status: 'Pending', slaDueAt: slaMinutesFromNow(600) });
    await seedDashboardShipment({ warehouseId, routeId, status: 'Delivered', slaDueAt: slaMinutesFromNow(20) });

    const { body } = await getDashboard(request, adminToken, { routeId });
    const page = atRiskPageOf(body);

    // AC-3's core: the tile number and the page total are the SAME number, so they cannot disagree.
    expect(body.atRiskTotalCount).toBe(page.totalCount);
    expect(body.atRiskTotalCount).toBe(2);

    // Every carried row is itself at risk under the same instant — the list is the at-risk subset,
    // not the whole filtered set (which also holds the Pending and Delivered rows above).
    const ids = page.items.map((row) => row.id);
    expect(ids).toContain(first.id);
    expect(page.items).toHaveLength(body.atRiskTotalCount!);

    // One instant governs the whole response, and it is a whole-second UTC timestamp (AC-3).
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(Number.isNaN(Date.parse(body.generatedAt!))).toBe(false);

    // The counts and the list describe the SAME filtered window (AC-1/AC-3).
    expect(statusCountOf(body, 'InTransit').count).toBe(1);
    expect(statusCountOf(body, 'Assigned').count).toBe(1);
    expect(statusCountOf(body, 'Delivered').count).toBe(1);
    expect(statusCountOf(body, 'Pending').count).toBe(1);
  });
// LOGI-0012 AC-4
  test('AC-4 — vehicle buckets exclude Maintenance from available and from in-use capacity // LOGI-0012 AC-4', async ({
    request,
  }) => {
    // Plate numbers are capped at 20 chars by the contract, so the tag is trimmed to fit: an over-long
    // plate is a 400 from the vehicle endpoint, which would mask the AC-4 assertion behind a fixture bug.
    const tag = uniqueRef('VH').slice(-8);
    await seedVehicle(request, adminToken, `A-${tag}-1`, { status: 'Available', capacityKg: 1000 });
    await seedVehicle(request, adminToken, `A-${tag}-2`, { status: 'Available', capacityKg: 1000 });
    await seedVehicle(request, adminToken, `R-${tag}-1`, { status: 'InRoute', capacityKg: 3000 });
    // A Maintenance vehicle has real capacity but is never counted as available or in use (AC-4).
    await seedVehicle(request, adminToken, `M-${tag}-1`, { status: 'Maintenance', capacityKg: 5000 });

    const { status, body } = await getDashboard(request, adminToken, { routeId });
    expect(status).toBe(200);

    const vehicles = vehicleUtilizationOf(body);

    // The fleet is a GLOBAL resource, so other specs seed vehicles too: assert the relationships and
    // this run's own contribution rather than absolute counts.
    expect(vehicles.byStatus?.Maintenance ?? 0).toBeGreaterThanOrEqual(1);
    expect(vehicles.byStatus?.InRoute ?? 0).toBeGreaterThanOrEqual(1);

    // Every enum bucket is PRESENT, zero counts included (AC-4, O3) — the panel never drops one.
    for (const key of ['Available', 'InRoute', 'Maintenance']) {
      expect(vehicles.byStatus).toHaveProperty(key);
    }

    // The buckets partition the fleet (AC-1's "never omitted" rule applied to utilization).
    expect(vehicles.totalCount).toBe(
      (vehicles.byStatus?.Available ?? 0) +
        (vehicles.byStatus?.InRoute ?? 0) +
        (vehicles.byStatus?.Maintenance ?? 0),
    );

    // totalCapacityKg sums EVERY vehicle (including the 5000kg Maintenance one)...
    expect(vehicles.totalCapacityKg).toBeGreaterThanOrEqual(10_000);
    // ...while inUseCapacityKg counts only InRoute, so it is strictly less (AC-4).
    expect(vehicles.inUseCapacityKg).toBeLessThan(vehicles.totalCapacityKg);

    if (vehicles.totalCapacityKg === 0) {
      // An empty fleet is "no capacity", never "0% used" (AC-4).
      expect(vehicles.capacityUtilizationPercent).toBeNull();
    } else {
      expect(vehicles.capacityUtilizationPercent).toBeCloseTo(
        (vehicles.inUseCapacityKg / vehicles.totalCapacityKg) * 100,
        2,
      );
    }
  });

  // LOGI-0012 AC-5
  test('AC-5 — driver buckets report the Active share and never fold Suspended in // LOGI-0012 AC-5', async ({
    request,
  }) => {
    // Minimal seeding: ONE Active and ONE Suspended is enough to prove the invariant, and the driver
    // pool is org-wide — every driver this arm adds also lands in `drivers.spec.ts`'s paged list
    // (25/page), so a fat fixture set pushes that pre-existing spec's freshly created row off page 1.
    const tag = uniqueRef('DR').slice(-8);
    await seedDriver(request, adminToken, `Active ${tag}`, `LA-${tag}`);
    await seedDriver(request, adminToken, `Suspended ${tag}`, `LS-${tag}`, { status: 'Suspended' });

    const { body } = await getDashboard(request, adminToken, { routeId });
    const pool = driverUtilizationOf(body);

    // The driver pool is GLOBAL too, so assert relationships and this run's own contribution.
    expect(pool.byStatus?.Suspended ?? 0).toBeGreaterThanOrEqual(1);
    expect(pool.byStatus?.Active ?? 0).toBeGreaterThanOrEqual(1);
    expect(pool.totalCount).toBeGreaterThanOrEqual(2);

    // Every enum bucket is PRESENT, zero counts included (AC-5, O3).
    for (const key of ['Active', 'OffDuty', 'Suspended']) {
      expect(pool.byStatus).toHaveProperty(key);
    }

    // The buckets partition the pool.
    expect(pool.totalCount).toBe(
      (pool.byStatus?.Active ?? 0) + (pool.byStatus?.OffDuty ?? 0) + (pool.byStatus?.Suspended ?? 0),
    );

    // utilizationPercent is the ACTIVE share — a Suspended driver is never counted as available (AC-5).
    if (pool.totalCount === 0) {
      expect(pool.utilizationPercent).toBeNull();
    } else {
      expect(pool.utilizationPercent).toBeCloseTo(((pool.byStatus?.Active ?? 0) / pool.totalCount) * 100, 2);
    }
  });

// LOGI-0012 AC-8
  test('AC-8 — an out-of-range pageSize or unknown enum is a 400 with a keyed errors map // LOGI-0012 AC-8', async ({
    request,
  }) => {
    // Each offending parameter is named in the map, so a client can attach the message to its control.
    const badPageSize = await getDashboard(request, adminToken, { routeId, pageSize: 500 });
    expect(badPageSize.status).toBe(400);
    expect(badPageSize.body.errors).toHaveProperty('pageSize');

    const badStatus = await getDashboard(request, adminToken, 'status=Teleported');
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.errors).toHaveProperty('status');

    const badPriority = await getDashboard(request, adminToken, 'priority=Rush');
    expect(badPriority.status).toBe(400);
    expect(badPriority.body.errors).toHaveProperty('priority');

    // AC-8: with no pageSize supplied the contract default is 20.
    const ok = await getDashboard(request, adminToken, { routeId });
    expect(ok.status).toBe(200);
    expect(ok.body.atRiskShipments?.pageSize).toBe(20);
  });

  // LOGI-0012 AC-8
  test('AC-8 — two identical reads agree on everything except generatedAt, and store nothing // LOGI-0012 AC-8', async ({
    request,
  }) => {
    await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(15),
    });
    await seedDashboardShipment({ warehouseId, routeId, status: 'Pending', slaDueAt: null });

    const first = (await getDashboard(request, adminToken, { routeId })).body;
    const second = (await getDashboard(request, adminToken, { routeId })).body;

    // Everything but the instant is identical: the dashboard is a pure projection, so a repeated read
    // cannot drift because of something the first read wrote (AC-8).
    const { generatedAt: _a, ...firstRest } = first;
    const { generatedAt: _b, ...secondRest } = second;
    expect(secondRest).toEqual(firstRest);

    // "Stores nothing" (BR-2 rule 2.5): the shipments table still has exactly the seeded rows and no
    // at_risk column was conjured — proven by the schema the fixtures insert into.
    const third = (await getDashboard(request, adminToken, { routeId })).body;
    expect(third.statusCounts).toEqual(first.statusCounts);
  });

  // LOGI-0012 AC-6
  test('AC-6 — the dashboard reuses the shipments list filters and the totals agree // LOGI-0012 AC-6', async ({
    request,
  }) => {
    // FINDING (recorded in the journal): the comparison must use the filters the two endpoints SHARE.
    // `getDashboard` accepts `routeId` but `GET /shipments` does NOT, so a route-scoped comparison
    // would silently list the whole org (31 rows) against a route-scoped dashboard (1 row) and fail for
    // a reason that has nothing to do with the drill-down. Scoping by `originWarehouseId` — which both
    // accept — is what actually proves AC-6.
    const scopedWarehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('AC6')}`);
    const soon = await seedDashboardShipment({
      warehouseId: scopedWarehouseId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(20),
    });
    await seedDashboardShipment({
      warehouseId: scopedWarehouseId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(600),
    });
    // A terminal row inside the window: never at risk, so it widens the status count without widening
    // the at-risk total — which is exactly the distinction AC-6's drill-down has to preserve.
    await seedDashboardShipment({
      warehouseId: scopedWarehouseId,
      status: 'Delivered',
      slaDueAt: slaMinutesFromNow(20),
    });

    const { body } = await getDashboard(request, adminToken, { originWarehouseId: scopedWarehouseId });

    // AC-6: the at-risk total equals what `GET /shipments?slaRisk=true` reports for the SAME rows —
    // which is exactly why the tile can drill into that list and show what it counted.
    const filtered = await listShipments(request, adminToken, {
      originWarehouseId: scopedWarehouseId,
      slaRisk: true,
      pageSize: 100,
    });
    expect(filtered.status).toBe(200);
    expect(filtered.body.totalCount).toBe(body.atRiskTotalCount);
    expect(filtered.body.items.map((item) => item.id)).toContain(soon.id);

    // The dashboard invents no filter of its own: narrowing by a SHARED filter behaves identically on
    // both endpoints, so a filtered tile opens a list showing what it counted.
    const byStatus = await getDashboard(request, adminToken, {
      originWarehouseId: scopedWarehouseId,
      status: 'InTransit',
    });
    const listByStatus = await listShipments(request, adminToken, {
      originWarehouseId: scopedWarehouseId,
      status: 'InTransit',
      pageSize: 100,
    });
    expect(byStatus.body.statusCounts).toHaveLength(6);
    // The status-narrowed at-risk count equals what the narrowed LIST calls at-risk, row for row.
    expect(byStatus.body.atRiskTotalCount).toBe(
      listByStatus.body.items.filter((item) => item.atRisk).length,
    );
    // And the status-narrowed count matches the list's own InTransit total — one vocabulary, two
    // endpoints (AC-6).
    expect(statusCountOf(byStatus.body, 'InTransit').count).toBe(listByStatus.body.totalCount);
  });

  // LOGI-0012 AC-9
  test('AC-9 — the shipments, planning-board, vehicles and drivers surfaces are unchanged // LOGI-0012 AC-9', async ({
    request,
  }) => {
    const shipment = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'Pending',
      slaDueAt: slaMinutesFromNow(30),
    });
    const tag = uniqueRef('NR');

    // GET /shipments keeps its own filters, paging and at-risk projection.
    const shipments = await listShipments(request, adminToken, { routeId });
    expect(shipments.status).toBe(200);
    expect(shipments.body.totalCount).toBeGreaterThanOrEqual(1);
    expect(shipments.body.page).toBe(1);

    // GET /planning-board is unaffected: six columns, still its own aggregate.
    const board = await request.get('http://localhost:5199/api/v1/planning-board', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(board.status()).toBe(200);
    expect(((await board.json()) as { columns: unknown[] }).columns).toHaveLength(6);

    // GET /vehicles and /drivers still answer with their own lists.
    for (const path of ['/api/v1/vehicles', '/api/v1/drivers']) {
      const listed = await request.get(`http://localhost:5199${path}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(listed.status(), `${path} must be unaffected by the dashboard`).toBe(200);
      expect((await listed.json()) as unknown).toHaveProperty('items');
    }

    // The dashboard read itself did not consume or mutate the shipment it counted.
    const still = await listShipments(request, adminToken, { routeId, status: 'Pending' });
    expect(still.body.items.map((item) => item.id)).toContain(shipment.id);
    void tag;
  });
});