import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, authHeaders, seedDriver, seedVehicle, signIn } from './support/api';
import {
  createRoute,
  ensureDriverLinkedToUser,
  findDriverLinkedToUser,
  getRoute,
  listRoutes,
  patchRoute,
  routeName,
  unlinkDriver,
  uniqueRef,
  window,
} from './support/routes';

/**
 * LOGI-0009 route authorization (AC-7, BR-6) and the delete-when-referenced guards (AC-8) against
 * the real API, real JWTs and the throwaway SQLite database.
 *
 * The role matrix is asserted on the API with tokens obtained from the real `/auth/login`
 * endpoint — hidden UI affordances are never the proof of authorization. AC-8 is cross-ticket
 * behaviour: LOGI-0004's and LOGI-0005's *deferred* delete 409s become enforceable the moment a
 * route references a vehicle or a driver, so it is verified here, on this ticket.
 */
test.describe('LOGI-0009 route authorization + referenced-row guards (API)', () => {
  let adminToken: string;
  let dispatcherToken: string;
  let viewerToken: string;
  let driverToken: string;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;
    viewerToken = (await signIn(request, 'Viewer')).accessToken;
    driverToken = (await signIn(request, 'Driver')).accessToken;
  });

  /** A route created through the API, so the matrix has a real id to read and patch. */
  async function seedPlannedRoute(request: APIRequestContext, name: string): Promise<number> {
    const created = await createRoute(request, adminToken, {
      name,
      plannedStart: window(0),
      plannedEnd: window(480),
    });
    expect(created.status, `seeding '${name}' must succeed`).toBe(201);
    return Number(created.body.id);
  }

  test('AC-7 — anonymous 401, Viewer reads but never writes, Driver never writes, Admin/Dispatcher do // LOGI-0009 AC-7', async ({
    request,
  }) => {
    const targetName = routeName('AC7-target');
    const targetId = await seedPlannedRoute(request, targetName);

    // Anonymous: rejected before authorization even matters, and challenged as a bearer API.
    const anonymousList = await listRoutes(request, null);
    const anonymousCreateName = routeName('AC7-anon');
    expect({
      list: anonymousList.status,
      detail: (await getRoute(request, null, targetId)).status,
      create: (
        await createRoute(request, null, {
          name: anonymousCreateName,
          plannedStart: window(0),
          plannedEnd: window(480),
        })
      ).status,
      patch: (await patchRoute(request, null, targetId, { name: routeName('AC7-anon-patch') })).status,
    }).toEqual({ list: 401, detail: 401, create: 401, patch: 401 });
    // The 401 is a bearer challenge, not an opaque refusal (LOGI-0003 contract behaviour).
    const challenge = await request.get(`${API}/api/v1/routes`);
    expect(challenge.status()).toBe(401);
    expect(challenge.headers()['www-authenticate']).toContain('Bearer');

    // Viewer: authenticated reads succeed, both writes are forbidden.
    const viewerList = await listRoutes(request, viewerToken, { q: targetName });
    expect(viewerList.status).toBe(200);
    expect((viewerList.body.items ?? []).map((route) => route.id)).toContain(targetId);
    expect((await getRoute(request, viewerToken, targetId)).status).toBe(200);

    const viewerCreateName = routeName('AC7-viewer-create');
    expect(
      (
        await createRoute(request, viewerToken, {
          name: viewerCreateName,
          plannedStart: window(0),
          plannedEnd: window(480),
        })
      ).status,
    ).toBe(403);
    expect((await patchRoute(request, viewerToken, targetId, { name: routeName('AC7-viewer-patch') })).status).toBe(
      403,
    );

    // Driver: no writes either (BR-6 keeps route planning with Admin/Dispatcher).
    const driverCreateName = routeName('AC7-driver-create');
    expect(
      (
        await createRoute(request, driverToken, {
          name: driverCreateName,
          plannedStart: window(0),
          plannedEnd: window(480),
        })
      ).status,
    ).toBe(403);
    expect((await patchRoute(request, driverToken, targetId, { name: routeName('AC7-driver-patch') })).status).toBe(
      403,
    );

    // Every rejected call wrote nothing and left the target untouched.
    const afterRejects = await listRoutes(request, adminToken, { q: 'AC7' });
    const namesAfterRejects = (afterRejects.body.items ?? []).map((route) => route.name);
    expect(namesAfterRejects).not.toContain(anonymousCreateName);
    expect(namesAfterRejects).not.toContain(viewerCreateName);
    expect(namesAfterRejects).not.toContain(driverCreateName);
    expect((await getRoute(request, adminToken, targetId)).body.name).toBe(targetName);

    // Admin and Dispatcher: both can read and write (subject to AC-4/AC-5/AC-6).
    const adminCreated = await createRoute(request, adminToken, {
      name: routeName('AC7-admin'),
      plannedStart: window(600),
      plannedEnd: window(1080),
    });
    expect(adminCreated.status).toBe(201);
    const adminRouteId = Number(adminCreated.body.id);
    const patchedName = routeName('AC7-dispatcher-patch');
    expect((await patchRoute(request, dispatcherToken, adminRouteId, { name: patchedName })).status).toBe(200);
    const readBack = await getRoute(request, dispatcherToken, adminRouteId);
    expect(readBack.status).toBe(200);
    expect(readBack.body.name).toBe(patchedName);
  });

  test('AC-7 — a Driver reads only routes assigned to the driver row linked to their account // LOGI-0009 AC-7', async ({
    request,
  }) => {
    // Driver scoping keys off `drivers.user_id = <the JWT user>`; the 1:1 link is shared suite
    // state, so an existing link (LOGI-0005's driver suite creates one) is reused, and only a link
    // this test created is removed again — leaving the drivers suite exactly as it found the data.
    const driverUserId = (await signIn(request, 'Driver')).user.id;
    const existing = await findDriverLinkedToUser(request, adminToken, driverUserId);
    const linked = existing ?? (await ensureDriverLinkedToUser(request, adminToken, driverUserId));

    try {
      const otherDriverId = await seedDriver(
        request,
        adminToken,
        `Route QA other ${routeName('SCOPE')}`,
        uniqueRef('RDL'),
      );
      const mine = await seedPlannedRoute(request, routeName('AC7-mine'));
      const other = await seedPlannedRoute(request, routeName('AC7-other'));

      expect((await patchRoute(request, adminToken, mine, { driverId: linked.id })).status).toBe(200);
      expect((await patchRoute(request, adminToken, other, { driverId: otherDriverId })).status).toBe(200);

      // Own routes are visible; the other driver's route never is (own-routes-only, spec §7 O4).
      const scoped = await listRoutes(request, driverToken, { pageSize: 100 });
      expect(scoped.status).toBe(200);
      const visibleIds = (scoped.body.items ?? []).map((route) => route.id);
      expect(visibleIds).toContain(mine);
      expect(visibleIds).not.toContain(other);
      expect(
        (scoped.body.items ?? []).every((route) => route.driverId === linked.id),
        'every visible route belongs to the linked driver',
      ).toBe(true);

      // Detail follows the same rule: 200 for an own route, 403 for another driver's.
      expect((await getRoute(request, driverToken, mine)).status).toBe(200);
      expect((await getRoute(request, driverToken, other)).status).toBe(403);
    } finally {
      // Always relink-free afterwards: a run must not leave the seeded Driver account linked to a
      // row (drivers.spec's AC-5 POST requires the link to be free), and the UI Driver seam asserts
      // a Driver with no link sees no routes at all.
      await unlinkDriver(request, adminToken, linked);
    }
  });

  test('AC-8 — deleting a vehicle or driver a route references is a 409; unreferenced rows still delete // LOGI-0009 AC-8', async ({
    request,
  }) => {
    const headers = authHeaders(adminToken);
    const plate = uniqueRef('AC8V');
    const vehicleId = await seedVehicle(request, adminToken, plate);
    const driverId = await seedDriver(request, adminToken, `Route QA ref ${routeName('AC8')}`, uniqueRef('RDL'));

    const created = await createRoute(request, adminToken, {
      name: routeName('AC8-route'),
      plannedStart: window(0),
      plannedEnd: window(480),
      vehicleId,
      driverId,
    });
    expect(created.status, 'the referencing route must exist for the guard to be live').toBe(201);

    // LOGI-0004's deferred 409: a referenced vehicle may not be deleted.
    const vehicleDelete = await request.delete(`${API}/api/v1/vehicles/${vehicleId}`, { headers });
    expect(vehicleDelete.status()).toBe(409);
    const vehicleAfter = await request.get(`${API}/api/v1/vehicles/${vehicleId}`, { headers });
    expect(vehicleAfter.status(), 'the rejected delete left the row in place').toBe(200);
    expect(((await vehicleAfter.json()) as { plateNumber: string }).plateNumber).toBe(plate);

    // LOGI-0005's deferred 409: a referenced driver may not be deleted.
    const driverDelete = await request.delete(`${API}/api/v1/drivers/${driverId}`, { headers });
    expect(driverDelete.status()).toBe(409);
    const driverAfter = await request.get(`${API}/api/v1/drivers/${driverId}`, { headers });
    expect(driverAfter.status(), 'the rejected delete left the row in place').toBe(200);
    expect(((await driverAfter.json()) as { id: number }).id).toBe(driverId);

    // A vehicle/driver no route references still deletes as before (204 → gone).
    const freeVehicleId = await seedVehicle(request, adminToken, uniqueRef('AC8F'));
    const freeVehicleDelete = await request.delete(`${API}/api/v1/vehicles/${freeVehicleId}`, { headers });
    expect(freeVehicleDelete.status()).toBe(204);
    expect((await request.get(`${API}/api/v1/vehicles/${freeVehicleId}`, { headers })).status()).toBe(404);

    const freeDriverId = await seedDriver(request, adminToken, `Route QA free ${routeName('AC8')}`, uniqueRef('RDL'));
    const freeDriverDelete = await request.delete(`${API}/api/v1/drivers/${freeDriverId}`, { headers });
    expect(freeDriverDelete.status()).toBe(204);
    expect((await request.get(`${API}/api/v1/drivers/${freeDriverId}`, { headers })).status()).toBe(404);
  });
});
