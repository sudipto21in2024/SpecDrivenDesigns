import { expect, test } from '@playwright/test';
import { API, seedVehicle, seedWarehouse, signIn } from './support/api';
import { getShipment } from './support/shipments';
import { ensureDriverLinkedToUser, seedRoute, uniqueRef } from './support/routes';
import {
  assignShipmentToRoute,
  driverScopedWindow,
  listRouteShipments,
  removeShipmentFromRoute,
  seedAssignedShipment,
} from './support/route-shipments';

/**
 * LOGI-0010 authorization (AC-7, BR-6) against the real API with real JWTs.
 *
 * The matrix is asserted on the API, never on a hidden UI affordance: the panel renders no assign
 * or unassign control for a Viewer, but that is hygiene, not enforcement, and a test that proved it
 * would pass even if the endpoint were wide open. Every rejection is followed by a read-back
 * asserting nothing was written.
 *
 * The Driver row is the interesting one: the role *may* read the list, but only for a route assigned
 * to the driver row linked to their own user — a whitelist alone cannot express that, so it is
 * proven with a 200 on their own route and a 403 on someone else's.
 */
test.describe('LOGI-0010 route-shipment authorization (API)', () => {
  let adminToken: string;
  let dispatcherToken: string;
  let viewerToken: string;
  let driverToken: string;
  let warehouseId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;
    viewerToken = (await signIn(request, 'Viewer')).accessToken;
    driverToken = (await signIn(request, 'Driver')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('AZ')}`);
  });

  /** A Planned route with no driver, so it belongs to nobody and a Driver must be refused it. */
  async function seedUnownedRoute(vehicleId: number | null = null): Promise<number> {
    return (await seedRoute({ status: 'Planned', vehicleId })).id;
  }

  // LOGI-0010 AC-7
  test('AC-7 — anonymous is 401 on all three operations // LOGI-0010 AC-7', async ({ request }) => {
    const routeId = await seedUnownedRoute();
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 100, routeId });

    expect({
      list: (await listRouteShipments(request, null, routeId)).status,
      assign: (await assignShipmentToRoute(request, null, routeId, { shipmentId: shipment.id })).status,
      unassign: (await removeShipmentFromRoute(request, null, routeId, shipment.id)).status,
    }).toEqual({ list: 401, assign: 401, unassign: 401 });

    // The 401 is a bearer challenge, not an opaque refusal (LOGI-0003 contract behaviour).
    const challenged = await request.get(`${API}/api/v1/routes/1/shipments`);
    expect(challenged.status()).toBe(401);
    expect(challenged.headers()['www-authenticate']).toContain('Bearer');
  });

  // LOGI-0010 AC-7
  test('AC-7 — a Viewer reads but never writes, and the rejected write changed nothing // LOGI-0010 AC-7', async ({
    request,
  }) => {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('AZV'), { capacityKg: 1000 });
    const routeId = await seedUnownedRoute(vehicleId);
    const candidate = await seedAssignedShipment({ warehouseId, weightKg: 100 });

    expect((await listRouteShipments(request, viewerToken, routeId)).status).toBe(200);
    expect((await assignShipmentToRoute(request, viewerToken, routeId, { shipmentId: candidate.id })).status).toBe(403);

    // The refused assign wrote nothing.
    const untouched = await getShipment(request, adminToken, candidate.id);
    expect(untouched.body.routeId).toBeNull();
    expect(untouched.body.status).toBe('Pending');
    expect((await listRouteShipments(request, adminToken, routeId)).body.capacity?.shipmentCount).toBe(0);
  });

  // LOGI-0010 AC-7
  test('AC-7 — a Driver may never write, and reading is scoped to their own route // LOGI-0010 AC-7', async ({
    request,
  }) => {
    const ownDriver = await ensureDriverLinkedToUser(request, adminToken, 3); // the seeded Driver user
    expect(ownDriver.userId).toBe(3);

    // Both driver-scoped routes sit on `driverScopedWindow` so they never overlap the default band
    // that other specs' routes occupy (see the helper's note on the shared driver row).
    const ownRouteId = (await seedRoute({
      status: 'Planned',
      driverId: ownDriver.id,
      plannedStart: driverScopedWindow(0),
      plannedEnd: driverScopedWindow(480),
    })).id;
    const otherRouteId = (await seedRoute({
      status: 'Planned',
      driverId: null,
      plannedStart: driverScopedWindow(600),
      plannedEnd: driverScopedWindow(1080),
    })).id;
    const onOwnRoute = await seedAssignedShipment({ warehouseId, weightKg: 100, routeId: ownRouteId });
    const candidate = await seedAssignedShipment({ warehouseId, weightKg: 100 });

    // 200 for their own route...
    expect((await listRouteShipments(request, driverToken, ownRouteId)).status).toBe(200);
    // ...403 for a route belonging to another driver (BR-6 row-level ownership).
    expect((await listRouteShipments(request, driverToken, otherRouteId)).status).toBe(403);

    // Writes are refused outright, on their own route included.
    expect(
      (await assignShipmentToRoute(request, driverToken, ownRouteId, { shipmentId: candidate.id })).status,
    ).toBe(403);
    expect((await removeShipmentFromRoute(request, driverToken, ownRouteId, onOwnRoute.id)).status).toBe(403);

    // Neither rejection moved a row.
    expect((await getShipment(request, adminToken, candidate.id)).body.routeId).toBeNull();
    expect((await getShipment(request, adminToken, onOwnRoute.id)).body.routeId).toBe(ownRouteId);
  });

  // LOGI-0010 AC-7
  test('AC-7 — Admin and Dispatcher both get the full write surface // LOGI-0010 AC-7', async ({ request }) => {
    const dispatcherRouteId = await seedUnownedRoute();
    const adminRouteId = await seedUnownedRoute();
    const forDispatcher = await seedAssignedShipment({ warehouseId, weightKg: 100 });
    const forAdmin = await seedAssignedShipment({ warehouseId, weightKg: 100 });

    expect((await listRouteShipments(request, dispatcherToken, dispatcherRouteId)).status).toBe(200);
    expect(
      (await assignShipmentToRoute(request, dispatcherToken, dispatcherRouteId, { shipmentId: forDispatcher.id }))
        .status,
    ).toBe(200);
    expect((await removeShipmentFromRoute(request, dispatcherToken, dispatcherRouteId, forDispatcher.id)).status).toBe(204);

    expect((await listRouteShipments(request, adminToken, adminRouteId)).status).toBe(200);
    expect((await assignShipmentToRoute(request, adminToken, adminRouteId, { shipmentId: forAdmin.id })).status).toBe(200);
    expect((await removeShipmentFromRoute(request, adminToken, adminRouteId, forAdmin.id)).status).toBe(204);
  });
});