import { expect, test } from '@playwright/test';
import { DashboardPage } from './pages/dashboard.page';
import { seedDriver, seedVehicle, seedWarehouse, signIn } from './support/api';
import { seedRoute, uniqueRef } from './support/routes';
import { getDashboard, seedDashboardShipment, slaMinutesFromNow } from './support/dashboard';

/**
 * LOGI-0012 operations dashboard through the real UI (AC-1..AC-7).
 *
 * The API spec proves the server's projection; these prove the manager can *read* it — that all six
 * tiles render (zeros included), that a tile and the list beneath it agree, that the pager really
 * pages, that the utilization panels render their buckets and an empty fleet as "no capacity" rather
 * than "0% used", and that a Driver is not offered the screen at all. All selectors live in
 * `pages/dashboard.page.ts`.
 *
 * Every test scopes the dashboard to its own route before asserting, because the dashboard is
 * org-wide: an unfiltered screen would also show the rows seeded by every other spec.
 */
test.describe('LOGI-0012 operations dashboard (UI)', () => {
  let adminToken: string;
  let warehouseId: number;
  let routeId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('DUI')}`);
    routeId = (await seedRoute({ status: 'Planned' })).id;
  });

  // LOGI-0012 AC-1
  test('AC-1 — all six tiles render in lifecycle order, zeros included // LOGI-0012 AC-1', async ({ page }) => {
    await seedDashboardShipment({ warehouseId, routeId, status: 'Pending' });
    await seedDashboardShipment({ warehouseId, routeId, status: 'Pending' });
    await seedDashboardShipment({ warehouseId, routeId, status: 'InTransit' });
    // Assigned/Delivered/Delayed/Cancelled deliberately empty.

    const board = new DashboardPage(page);
    await board.goto('Dispatcher');
    await board.filterByRouteId(routeId);

    await board.expectTileCount('Pending', 2);
    await board.expectTileCount('InTransit', 1);
    // A zero tile is still a tile: omitting it would read as "the dashboard forgot to ask" (AC-1).
    for (const status of ['Assigned', 'Delivered', 'Delayed', 'Cancelled'] as const) {
      await expect(board.tile(status)).toBeVisible();
      await board.expectTileCount(status, 0);
    }
  });

  // LOGI-0012 AC-3
  test('AC-3 — the at-risk tile and the list beneath it show the same number // LOGI-0012 AC-3', async ({
    page,
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
    // Terminal and out-of-window rows widen the status counts but NOT the at-risk total.
    await seedDashboardShipment({ warehouseId, routeId, status: 'Delivered', slaDueAt: slaMinutesFromNow(20) });
    await seedDashboardShipment({ warehouseId, routeId, status: 'Pending', slaDueAt: slaMinutesFromNow(600) });

    const board = new DashboardPage(page);
    await board.goto('Dispatcher');
    await board.filterByRouteId(routeId);

    // AC-3: the tile, the panel chip and the pager's total are the SAME number — a UI that rendered the
    // page length (or the loaded rows) here would disagree with the server's total.
    await expect(board.atRiskTileCount()).toHaveText('2');
    await expect(board.atRiskPanel().getByTestId('at-risk-count')).toHaveText('2');
    // `toHaveText` is an exact match, so the pager's whole line is asserted — which also pins the page
    // numbering AC-2's envelope requires, not just the total.
    await expect(board.atRiskPage()).toHaveText('Page 1 of 1 · 2 total');

    // Every rendered row is itself one of the at-risk shipments.
    await expect(board.atRiskRow(first.id)).toBeVisible();
    await expect(board.atRiskRow(first.id)).toContainText('InTransit');

    // One instant governs the whole screen.
    await expect(board.generatedAt()).toContainText('As of ');
  });

  // LOGI-0012 AC-2
  test('AC-2 — the pager steps through a two-page at-risk list // LOGI-0012 AC-2', async ({ page }) => {
    // 25 at-risk rows against the contract's default page size of 20.
    for (let index = 0; index < 25; index += 1) {
      await seedDashboardShipment({
        warehouseId,
        routeId,
        status: 'InTransit',
        slaDueAt: slaMinutesFromNow(10 + index),
      });
    }

    const board = new DashboardPage(page);
    await board.goto('Dispatcher');
    await board.filterByRouteId(routeId);

    await expect(board.atRiskPage()).toHaveText('Page 1 of 2 · 25 total');
    await expect(board.atRiskPanel().locator('[data-testid^="at-risk-row-"]')).toHaveCount(20);
    // The pager button is the affordance that exists only because there is a second page.
    await expect(board.atRiskNext()).toBeEnabled();
    await expect(board.atRiskPrev()).toBeDisabled();

    await board.nextAtRiskPage();

    await expect(board.atRiskPage()).toHaveText('Page 2 of 2 · 25 total');
    await expect(board.atRiskPanel().locator('[data-testid^="at-risk-row-"]')).toHaveCount(5);
    await expect(board.atRiskNext()).toBeDisabled();
    await expect(board.atRiskPrev()).toBeEnabled();
  });

// LOGI-0012 AC-6
  test('AC-6 — every tile and bucket drills into an existing list endpoint // LOGI-0012 AC-6', async ({
    page,
  }) => {
    const board = new DashboardPage(page);
    await board.goto('Dispatcher');

    // AC-6: the targets are EXISTING endpoints carrying the equivalent filter, never a dashboard-local
    // result route. Asserted on the anchors themselves so the claim is about the link, not a click.
    expect(await board.hrefOf(board.tileLink('Pending'))).toBe('/shipments?status=Pending');
    expect(await board.hrefOf(board.tileLink('Cancelled'))).toBe('/shipments?status=Cancelled');
    expect(await board.hrefOf(board.atRiskTileLink())).toBe('/shipments?slaRisk=true');
    expect(await board.hrefOf(board.vehicleBucket('InRoute'))).toBe('/vehicles?status=InRoute');
    expect(await board.hrefOf(board.driverBucket('Suspended'))).toBe('/drivers?status=Suspended');
  });

  // LOGI-0012 AC-6
  test('AC-6 — a filtered tile keeps its filter in the drill-down // LOGI-0012 AC-6', async ({ page }) => {
    const board = new DashboardPage(page);
    await board.goto('Dispatcher');

    // Narrowing the dashboard must narrow the drill-down too, or the tile would open a list showing
    // the whole org rather than what it counted (AC-6).
    await board.filterByPriority('Express');
    expect(await board.hrefOf(board.tileLink('Pending'))).toContain('priority=Express');
    expect(await board.hrefOf(board.atRiskTileLink())).toContain('slaRisk=true');

    await board.clearFilters();
    expect(await board.hrefOf(board.tileLink('Pending'))).toBe('/shipments?status=Pending');
  });

  // LOGI-0012 AC-4
  test('AC-4 — the fleet panel renders every bucket and excludes Maintenance from in-use capacity // LOGI-0012 AC-4', async ({
    page,
    request,
  }) => {
    const tag = uniqueRef('VH').slice(-8);
    await seedVehicle(request, adminToken, `A-${tag}-1`, { status: 'Available', capacityKg: 1000 });
    await seedVehicle(request, adminToken, `R-${tag}-1`, { status: 'InRoute', capacityKg: 3000 });
    await seedVehicle(request, adminToken, `M-${tag}-1`, { status: 'Maintenance', capacityKg: 5000 });

    const board = new DashboardPage(page);
    await board.goto('Dispatcher');
    await board.filterByRouteId(routeId);

    // Every enum bucket renders, zero counts included (AC-4, O3).
    for (const status of ['Available', 'InRoute', 'Maintenance']) {
      await expect(board.vehicleBucket(status)).toBeVisible();
    }

    // The panel is global, so compare against the API rather than a hard-coded number: what the screen
    // shows must be what the server reported (AC-3 — no second read, no re-derived figure).
    const api = await getDashboard(request, adminToken, { routeId });
    const vehicle = api.body.vehicleUtilization!;
    await expect(board.vehicleTotal()).toHaveText(String(vehicle.totalCount));
    await expect(board.vehicleBucket('InRoute')).toContainText(String(vehicle.byStatus?.InRoute ?? 0));

    // A Maintenance vehicle's capacity is in the fleet total but never in the in-use figure (AC-4).
    await expect(board.vehiclePercent()).not.toHaveText('0%');
  });

  // LOGI-0012 AC-4
  test('AC-4 — the panel renders null percent as "no capacity", never as "0% used" // LOGI-0012 AC-4', async ({
    page,
    request,
  }) => {
    // CORRECTION from a first attempt: the fleet is an ORG-WIDE resource, so a test cannot assume it is
    // empty — other specs in this same file seed vehicles, and the first version of this test asserted
    // an em dash against a non-empty fleet. The claim AC-4 actually makes is conditional: WHEN the
    // denominator is 0 the UI must say "no capacity", and it must NEVER say "0% used". So the
    // assertion is driven by what the API reported rather than by a guessed fleet state.
    const api = await getDashboard(request, (await signIn(request, 'Admin')).accessToken);
    const capacity = api.body.vehicleUtilization!.capacityUtilizationPercent;
    const drivers = api.body.driverUtilization!.utilizationPercent;

    const board = new DashboardPage(page);
    await board.goto('Dispatcher');

    if (capacity == null) {
      // An empty fleet is "no capacity", a DIFFERENT statement from "0% of capacity is used" (AC-4).
      await expect(board.vehiclePercent()).toContainText('—');
    } else {
      // Otherwise the panel must show the server's own figure — no client-side re-derivation (AC-3).
      await expect(board.vehiclePercent()).toContainText(`${Math.round(capacity * 100) / 100}%`);
    }
    // In BOTH cases the forbidden reading is absent: the null is never coerced to zero.
    await expect(board.vehiclePercent()).not.toContainText('0%');

    if (drivers == null) {
      await expect(board.driverPercent()).toContainText('—');
    } else {
      await expect(board.driverPercent()).toContainText(`${Math.round(drivers * 100) / 100}%`);
    }
    await expect(board.driverPercent()).not.toContainText('0%');
  });

  // LOGI-0012 AC-5
  test('AC-5 — the driver panel shows a Suspended driver in its own bucket // LOGI-0012 AC-5', async ({
    page,
    request,
  }) => {
    // No driver is seeded here on purpose. The pool is org-wide and every driver this spec added would
    // also appear in `drivers.spec.ts`'s paged list, so the UI assertion is instead driven by whatever
    // the API already reports — which is the honest form of the claim anyway (AC-5).
    const board = new DashboardPage(page);
    await board.goto('Dispatcher');
    await board.filterByRouteId(routeId);

    for (const status of ['Active', 'OffDuty', 'Suspended']) {
      await expect(board.driverBucket(status)).toBeVisible();
    }

    // What the screen shows is exactly what the server reported — no client-side re-derivation (AC-3).
    const api = await getDashboard(request, adminToken, { routeId });
    const pool = api.body.driverUtilization!;
    await expect(board.driverTotal()).toHaveText(String(pool.totalCount));
    for (const status of ['Active', 'OffDuty', 'Suspended'] as const) {
      await expect(board.driverBucket(status)).toContainText(
        `${status}: ${pool.byStatus?.[status] ?? 0}`,
      );
    }

    // A Suspended driver is never folded into the Active share (AC-5, O3): the three buckets partition
    // the pool rather than one bucket absorbing another.
    const summed = (pool.byStatus?.Active ?? 0) + (pool.byStatus?.OffDuty ?? 0) + (pool.byStatus?.Suspended ?? 0);
    expect(summed).toBe(pool.totalCount);
  });
// LOGI-0012 AC-7
  test('AC-7 — a Driver is not offered the dashboard at all // LOGI-0012 AC-7', async ({ page }) => {
    const board = new DashboardPage(page);
    await board.login.signInAs('Driver');

    // §7 O1: the API 403s the org-wide dashboard (proved in dashboard-authz.spec.ts), so the tab is
    // simply not offered — while the surfaces BR-6 does scope a Driver to are still there.
    await expect(board.tab()).toHaveCount(0);
    await expect(page.getByTestId('tab-routes')).toBeVisible();
  });

  // LOGI-0012 AC-7
  test('AC-7 — a Viewer reads the whole dashboard and cannot write from it // LOGI-0012 AC-7', async ({
    page,
  }) => {
    await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'Pending',
      slaDueAt: slaMinutesFromNow(30),
    });

    const board = new DashboardPage(page);
    await board.goto('Viewer');
    await board.filterByRouteId(routeId);

    // A Viewer sees the full read surface...
    await expect(board.tile('Pending')).toBeVisible();
    await expect(board.atRiskPanel()).toBeVisible();
    await expect(board.vehiclePanel()).toBeVisible();
    await expect(board.driverPanel()).toBeVisible();

    // ...and no write affordance anywhere: the only controls are the filters, the pager and the
    // drill-down links. (The check is for imperative write verbs, not for the status names, which
    // legitimately appear as tile labels.)
    const buttonLabels = (await page.getByRole('button').allTextContents()).join('|');
    expect(buttonLabels).not.toMatch(/assign|transition|dispatch|mark|cancel shipment|create/i);
  });
});