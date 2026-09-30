import { expect, test, type Page } from '@playwright/test';
import { RoutesPage } from './pages/routes.page';
import { seedVehicle, seedWarehouse, signIn } from './support/api';
import { ensureDriverLinkedToUser, routeName, seedRoute, uniqueRef } from './support/routes';
import { driverScopedWindow, seedAssignedShipment } from './support/route-shipments';

/**
 * LOGI-0010 Shipments panel through the real UI (AC-1, AC-2, AC-3, AC-6, AC-7).
 *
 * The API specs prove the server enforces BR-5; these prove the operator can *act* on it — that the
 * panel opens, the candidate list offers the right shipments, the capacity projection moves as work
 * is added and removed, and a rejected assign reaches the dispatcher as a readable message rather
 * than a silent no-op. All selectors live in `pages/routes.page.ts`.
 */
test.describe('LOGI-0010 route shipments panel (UI)', () => {
  let adminToken: string;
  let warehouseId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('UI')}`);
  });

  /**
   * Signs in, filters the list to `name`, then opens that route's Shipments panel.
   *
   * The filter is not optional: the route list is paged and ordered `-createdAt`, so a freshly
   * seeded route is not reliably on page 1 once the shared database holds rows from earlier specs.
   * Searching by name is also what a dispatcher hunting for one specific route would do.
   */
  async function openPanelFor(page: Page, name: string, routeId: number): Promise<RoutesPage> {
    const routes = new RoutesPage(page);
    await routes.goto('Admin');
    await routes.search(name);
    await routes.openShipments(routeId);
    return routes;
  }

  // LOGI-0010 AC-1
  test('AC-1 — assigning from the panel shows the shipment as Assigned and moves the projection // LOGI-0010 AC-1', async ({
    page,
    request,
  }) => {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('UI1'), { capacityKg: 1000 });
    const name = routeName('UI1');
    const routeId = (await seedRoute({ status: 'Planned', vehicleId, name })).id;
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 300 });

    const routes = await openPanelFor(page, name, routeId);

    await expect(routes.emptyShipments()).toBeVisible();
    await expect(routes.capacityNumbers()).toContainText('1000 kg remaining of 1000 kg capacity');

    await routes.assignShipment(shipment.referenceCode);

    await expect(routes.shipmentRow(shipment.id)).toBeVisible();
    await expect(routes.shipmentRow(shipment.id)).toContainText('Assigned');
    await expect(routes.capacityNumbers()).toContainText('700 kg remaining of 1000 kg capacity');
    await expect(routes.capacityBanner()).toContainText('300 kg assigned across 1 shipment');
  });

  // LOGI-0010 AC-2
  test('AC-2 — a capacity breach surfaces the server detail instead of failing silently // LOGI-0010 AC-2', async ({
    page,
    request,
  }) => {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('UI2'), { capacityKg: 1000 });
    const name = routeName('UI2');
    const routeId = (await seedRoute({ status: 'Planned', vehicleId, name })).id;
    // 900 kg already on the route, leaving 100 free.
    const onRoute = await seedAssignedShipment({ warehouseId, weightKg: 900, routeId });
    const tooHeavy = await seedAssignedShipment({ warehouseId, weightKg: 200 });

    const routes = await openPanelFor(page, name, routeId);
    await expect(routes.shipmentRow(onRoute.id)).toBeVisible();

    await routes.assignShipment(tooHeavy.referenceCode);

    // The dispatcher sees all three numbers, because the panel renders ProblemDetails.detail verbatim.
    await routes.expectPanelError('900');
    await routes.expectPanelError('200');
    await routes.expectPanelError('1000');
    // And nothing was assigned.
    await expect(routes.shipmentRow(tooHeavy.id)).toHaveCount(0);
    await expect(routes.capacityNumbers()).toContainText('100 kg remaining of 1000 kg capacity');
  });

  // LOGI-0010 AC-6
  test('AC-6 — unassigning frees the weight, which the next assign then reuses // LOGI-0010 AC-6', async ({
    page,
    request,
  }) => {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('UI6'), { capacityKg: 1000 });
    const name = routeName('UI6');
    const routeId = (await seedRoute({ status: 'Planned', vehicleId, name })).id;
    const onRoute = await seedAssignedShipment({ warehouseId, weightKg: 900, routeId });
    // Fits in the 100 kg that freeing the first row will release.
    const replacement = await seedAssignedShipment({ warehouseId, weightKg: 100 });

    const routes = await openPanelFor(page, name, routeId);
    await expect(routes.shipmentRow(onRoute.id)).toBeVisible();

    await routes.unassignShipment(onRoute.id);
    await expect(routes.shipmentRow(onRoute.id)).toHaveCount(0);
    await expect(routes.capacityNumbers()).toContainText('1000 kg remaining of 1000 kg capacity');

    await routes.assignShipment(replacement.referenceCode);
    await expect(routes.shipmentRow(replacement.id)).toBeVisible();
    await expect(routes.capacityNumbers()).toContainText('900 kg remaining of 1000 kg capacity');
  });

  // LOGI-0010 AC-2
  test('AC-2 — a route with no vehicle says capacity is not checked rather than showing 0 // LOGI-0010 AC-2', async ({
    page,
  }) => {
    const name = routeName('UI2N');
    const routeId = (await seedRoute({ status: 'Planned', vehicleId: null, name })).id;
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 5000 });

    const routes = await openPanelFor(page, name, routeId);

    await expect(routes.capacityUnknown()).toBeVisible();
    await expect(routes.capacityUnknown()).toContainText('capacity is not checked');
    await expect(routes.capacityNumbers()).toHaveCount(0);

    // The assign succeeds anyway — no capacity to enforce.
    await routes.assignShipment(shipment.referenceCode);
    await expect(routes.shipmentRow(shipment.id)).toBeVisible();
  });

  // LOGI-0010 AC-3
  test('AC-3 — a non-Planned route explains why it takes no new shipments // LOGI-0010 AC-3', async ({ page }) => {
    const name = routeName('UI3');
    const routeId = (await seedRoute({ status: 'InProgress', vehicleId: null, name })).id;

    const routes = await openPanelFor(page, name, routeId);

    // A writer is told why the control is absent, rather than finding nothing unexplained.
    await expect(routes.readOnlyReason()).toContainText('InProgress');
    await expect(routes.readOnlyReason()).toContainText('Planned');
    await expect(routes.assignButton()).toHaveCount(0);
  });

  /**
   * The same flow as {@link openPanelFor} but as `role`, for the read-only personas. The search is
   * repeated here because a Viewer/Driver sees a differently-scoped route list.
   */
  async function openPanelAs(page: Page, role: 'Viewer' | 'Driver', name: string, routeId: number) {
    const routes = new RoutesPage(page);
    await routes.goto(role);
    await routes.search(name);
    await routes.openShipments(routeId);
    return routes;
  }

  // LOGI-0010 AC-7
  test('AC-7 — a Viewer sees the panel and its shipments with no write affordances // LOGI-0010 AC-7', async ({
    page,
    request,
  }) => {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('UIV'), { capacityKg: 1000 });
    const name = routeName('UIV');
    const routeId = (await seedRoute({ status: 'Planned', vehicleId, name })).id;
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 100, routeId });

    const routes = await openPanelAs(page, 'Viewer', name, routeId);

    // Readable, including the projection...
    await expect(routes.shipmentRow(shipment.id)).toBeVisible();
    await expect(routes.capacityNumbers()).toContainText('900 kg remaining of 1000 kg capacity');
    // ...but no way to change it. Hiding a control is not authorization — the API spec proves the
    // 403 — it is just that the UI does not offer an action the server will refuse.
    await expect(routes.assignSelect()).toHaveCount(0);
    await expect(routes.assignButton()).toHaveCount(0);
    await expect(routes.unassignButton(shipment.id)).toHaveCount(0);
  });

  // LOGI-0010 AC-7
  test('AC-7 — a Driver reads their own route read-only and is refused another route // LOGI-0010 AC-7', async ({
    page,
    request,
  }) => {
    const ownDriver = await ensureDriverLinkedToUser(request, adminToken, 3); // the seeded Driver user
    const ownName = routeName('UID');
    const otherName = routeName('UID2');
    // The Driver's routes are parked off the default window band, because pinning the shared driver
    // row must not collide with another spec's route (see `driverScopedWindow`).
    const ownRouteId = (await seedRoute({
      status: 'Planned',
      driverId: ownDriver.id,
      name: ownName,
      plannedStart: driverScopedWindow(0),
      plannedEnd: driverScopedWindow(480),
    })).id;
    const otherRouteId = (await seedRoute({
      status: 'Planned',
      driverId: null,
      name: otherName,
      plannedStart: driverScopedWindow(600),
      plannedEnd: driverScopedWindow(1080),
    })).id;
    const onOwnRoute = await seedAssignedShipment({ warehouseId, weightKg: 100, routeId: ownRouteId });

    const routes = await openPanelAs(page, 'Driver', ownName, ownRouteId);
    await expect(routes.shipmentRow(onOwnRoute.id)).toBeVisible();
    await expect(routes.assignButton()).toHaveCount(0);

    // The other driver's route is not merely unassignable — it is absent from this Driver's route
    // list altogether, because `GET /routes` is scoped to their own rows (BR-6). So there is no
    // Shipments button to click and no path from the UI to another driver's load. The matching 403
    // on the shipments endpoint itself is proven on the API in `route-shipments-authz.spec.ts`; what
    // belongs here is that the UI never offers the affordance in the first place.
    await routes.closeShipments();
    await routes.search(otherName);
    await expect(routes.page.getByText('No routes found')).toBeVisible();
    await expect(routes.shipmentsButton(otherRouteId)).toHaveCount(0);
  });
});