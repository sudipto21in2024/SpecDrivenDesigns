import { expect, test, type APIRequestContext } from '@playwright/test';
import { seedDriver, seedVehicle, seedWarehouse, signIn } from './support/api';
import {
  createRoute,
  getRoute,
  listRoutes,
  patchRoute,
  routeName,
  seedRoute,
  uniqueRef,
  window,
} from './support/routes';
import { createShipment, getShipment } from './support/shipments';

/**
 * LOGI-0009 route create + assignment (AC-1..AC-6, AC-10) against the real API and the throwaway
 * SQLite database — no MSW, no mocks.
 *
 * Idiom mirrors `vehicles.spec.ts`/`drivers.spec.ts`: every name/plate/licence is unique per run
 * (`routeName`/`uniqueRef`), windows come from the per-run base in `support/routes.ts` (never the
 * wall clock), and each test owns the vehicle/driver ids it books — so the BR-3/BR-4 guards can
 * only ever fire on this run's own rows.
 */
test.describe('LOGI-0009 route create + assignment (API)', () => {
  let adminToken: string;
  let dispatcherToken: string;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;
  });

  /** A fresh vehicle no other test (or run) books, so its overlap window is ours alone. */
  async function freshVehicle(request: APIRequestContext): Promise<number> {
    return seedVehicle(request, adminToken, uniqueRef('RTV'));
  }

  /** A fresh driver no other test (or run) books. */
  async function freshDriver(request: APIRequestContext): Promise<number> {
    return seedDriver(request, adminToken, `Route QA ${routeName('DRV')}`, uniqueRef('RDL'));
  }

  /** How many routes match a name filter — the "nothing was written" probe. */
  async function countByName(request: APIRequestContext, name: string): Promise<number> {
    const response = await listRoutes(request, dispatcherToken, { q: name });
    expect(response.status).toBe(200);
    return response.body.totalCount ?? -1;
  }

  test('AC-1 — create an assigned route, read it back and never touch a shipment // LOGI-0009 AC-1', async ({
    request,
  }) => {
    const vehicleId = await freshVehicle(request);
    const driverId = await freshDriver(request);
    const name = routeName('AC1');

    // A shipment that must stay untouched: route creation never assigns shipments (LOGI-0010 owns it).
    const warehouseId = await seedWarehouse(request, adminToken, `${name} WH`);
    const shipment = await createShipment(request, dispatcherToken, {
      originWarehouseId: warehouseId,
      destinationAddress: '1 Route Road',
      weightKg: 12,
    });
    const shipmentId = Number(shipment.body.id);
    expect((await getShipment(request, dispatcherToken, shipmentId)).body.routeId ?? null).toBeNull();

    const created = await createRoute(request, dispatcherToken, {
      name,
      plannedStart: window(0),
      plannedEnd: window(480),
      vehicleId,
      driverId,
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe(name);
    expect(created.body.status).toBe('Planned');
    expect(created.body.vehicleId).toBe(vehicleId);
    expect(created.body.driverId).toBe(driverId);
    expect(Number(created.body.id)).toBeGreaterThan(0);
    expect(Date.parse(String(created.body.plannedStart)), 'plannedStart round-trips').toBe(
      Date.parse(window(0)),
    );
    expect(Date.parse(String(created.body.plannedEnd)), 'plannedEnd round-trips').toBe(
      Date.parse(window(480)),
    );

    const routeId = Number(created.body.id);
    const detail = await getRoute(request, dispatcherToken, routeId);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ name, status: 'Planned', vehicleId, driverId });

    const listed = await listRoutes(request, dispatcherToken, { q: name });
    expect(listed.status).toBe(200);
    expect((listed.body.items ?? []).map((route) => route.id)).toContain(routeId);

    // AC-1's last line (+ AC-10): no shipment row is modified by route creation.
    expect((await getShipment(request, dispatcherToken, shipmentId)).body.routeId ?? null).toBeNull();
  });

  test('AC-2 — create unassigned, then assign, then unassign the vehicle only // LOGI-0009 AC-2', async ({
    request,
  }) => {
    const vehicleId = await freshVehicle(request);
    const driverId = await freshDriver(request);

    const created = await createRoute(request, dispatcherToken, {
      name: routeName('AC2'),
      plannedStart: window(600),
      plannedEnd: window(1080),
    });
    expect(created.status).toBe(201);
    expect(created.body.vehicleId ?? null).toBeNull();
    expect(created.body.driverId ?? null).toBeNull();
    const routeId = Number(created.body.id);

    const assigned = await patchRoute(request, dispatcherToken, routeId, { vehicleId, driverId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.vehicleId).toBe(vehicleId);
    expect(assigned.body.driverId).toBe(driverId);
    const persisted = await getRoute(request, dispatcherToken, routeId);
    expect(persisted.body.vehicleId).toBe(vehicleId);
    expect(persisted.body.driverId).toBe(driverId);

    // An explicit null is the contract's "unassign" — and it leaves the driver alone.
    const unassigned = await patchRoute(request, dispatcherToken, routeId, { vehicleId: null });
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.vehicleId ?? null).toBeNull();
    expect(unassigned.body.driverId).toBe(driverId);
    const afterUnassign = await getRoute(request, dispatcherToken, routeId);
    expect(afterUnassign.body.vehicleId ?? null).toBeNull();
    expect(afterUnassign.body.driverId).toBe(driverId);
  });

  test('AC-3 — field-keyed 400s for name, window, ids and an empty body // LOGI-0009 AC-3', async ({
    request,
  }) => {
    // POST name: blank, whitespace-only, over 200 characters — each keyed on `name`.
    const blankName = await createRoute(request, dispatcherToken, {
      name: '',
      plannedStart: window(0),
      plannedEnd: window(480),
    });
    expect(blankName.status).toBe(400);
    expect(Object.keys(blankName.body.errors ?? {})).toContain('name');

    // Whitespace survives JSON, so the validator (not the parser) has to catch it.
    const whitespaceName = await createRoute(request, dispatcherToken, {
      name: '   ',
      plannedStart: window(0),
      plannedEnd: window(480),
    });
    expect(whitespaceName.status).toBe(400);
    expect(Object.keys(whitespaceName.body.errors ?? {})).toContain('name');

    const tooLong = await createRoute(request, dispatcherToken, {
      name: routeName('AC3-long').padEnd(201, 'x'),
      plannedStart: window(0),
      plannedEnd: window(480),
    });
    expect(tooLong.status).toBe(400);
    expect(Object.keys(tooLong.body.errors ?? {})).toContain('name');

    // POST window: missing, unparseable and plannedEnd <= plannedStart. Each carries a valid,
    // findable name so "no route row is created" is provable with a name filter.
    const windowCases: { label: string; body: Record<string, unknown>; field: string }[] = [
      { label: 'missing start', body: { plannedEnd: window(480) }, field: 'plannedStart' },
      { label: 'unparseable start', body: { plannedStart: 'not-a-date', plannedEnd: window(480) }, field: 'plannedStart' },
      { label: 'end before start', body: { plannedStart: window(480), plannedEnd: window(0) }, field: 'plannedEnd' },
      { label: 'end equals start', body: { plannedStart: window(480), plannedEnd: window(480) }, field: 'plannedEnd' },
    ];
    for (const { label, body, field } of windowCases) {
      const name = routeName(`AC3-${field}`);
      const rejected = await createRoute(request, dispatcherToken, { name, ...body });
      expect(rejected.status, `${label} must be a 400`).toBe(400);
      expect(Object.keys(rejected.body.errors ?? {}), `${label} keys ${field}`).toContain(field);
      expect(await countByName(request, name), `${label} writes nothing`).toBe(0);
    }

    // PATCH: a non-positive or non-numeric vehicleId/driverId is keyed on its own field.
    const target = await createRoute(request, dispatcherToken, {
      name: routeName('AC3-target'),
      plannedStart: window(0),
      plannedEnd: window(480),
    });
    const routeId = Number(target.body.id);
    const before = (await getRoute(request, dispatcherToken, routeId)).body;

    const idCases: Record<string, Record<string, unknown>> = {
      vehicleId: { vehicleId: 0 },
      driverId: { driverId: -1 },
    };
    for (const [label, body] of Object.entries(idCases)) {
      const rejected = await patchRoute(request, dispatcherToken, routeId, body);
      expect(rejected.status, `${label} out of range must be a 400`).toBe(400);
      expect(Object.keys(rejected.body.errors ?? {}), `${label} keys itself`).toContain(label);
    }

    // A non-integer id is rejected by the parser, which keys the same field.
    for (const label of ['vehicleId', 'driverId']) {
      const rejected = await patchRoute(request, dispatcherToken, routeId, { [label]: 'abc' });
      expect(rejected.status, `a non-numeric ${label} must be a 400`).toBe(400);
      expect(Object.keys(rejected.body.errors ?? {}), `a non-numeric ${label} keys itself`).toContain(label);
    }

    // An empty body has no field to key on, so the parser keys it on `body`.
    const emptyBody = await patchRoute(request, dispatcherToken, routeId, {});
    expect(emptyBody.status).toBe(400);
    expect(Object.keys(emptyBody.body.errors ?? {})).toContain('body');

    // Nothing above may have touched the route.
    expect((await getRoute(request, dispatcherToken, routeId)).body).toEqual(before);
  });

  test('AC-4 — unknown vehicle/driver and unknown route ids are 404s that write nothing // LOGI-0009 AC-4', async ({
    request,
  }) => {
    const missingVehicleName = routeName('AC4-missing-vehicle');
    const missingVehicle = await createRoute(request, dispatcherToken, {
      name: missingVehicleName,
      plannedStart: window(0),
      plannedEnd: window(480),
      vehicleId: 999_999,
    });
    expect(missingVehicle.status).toBe(404);
    expect(await countByName(request, missingVehicleName), 'a dangling FK create writes nothing').toBe(0);

    const missingDriverName = routeName('AC4-missing-driver');
    const missingDriver = await createRoute(request, dispatcherToken, {
      name: missingDriverName,
      plannedStart: window(0),
      plannedEnd: window(480),
      driverId: 999_999,
    });
    expect(missingDriver.status).toBe(404);
    expect(await countByName(request, missingDriverName), 'a dangling FK create writes nothing').toBe(0);

    const target = await createRoute(request, dispatcherToken, {
      name: routeName('AC4-target'),
      plannedStart: window(0),
      plannedEnd: window(480),
    });
    const routeId = Number(target.body.id);
    const before = JSON.stringify((await getRoute(request, dispatcherToken, routeId)).body);

    expect((await patchRoute(request, dispatcherToken, routeId, { vehicleId: 999_999 })).status).toBe(404);
    expect((await patchRoute(request, dispatcherToken, routeId, { driverId: 999_999 })).status).toBe(404);
    expect(
      JSON.stringify((await getRoute(request, dispatcherToken, routeId)).body),
      'a dangling FK patch leaves every column untouched',
    ).toBe(before);

    expect((await getRoute(request, dispatcherToken, 999_999)).status).toBe(404);
    expect((await patchRoute(request, dispatcherToken, 999_999, { vehicleId: null })).status).toBe(404);
  });

  test('AC-5 — BR-3/BR-4 window overlap is a 409 naming the resource; boundaries and terminal routes do not conflict // LOGI-0009 AC-5', async ({
    request,
  }) => {
    const vehicleId = await freshVehicle(request);

    // Route A: Planned 08:00-16:00 with the vehicle.
    const routeA = await createRoute(request, dispatcherToken, {
      name: routeName('AC5-a'),
      plannedStart: window(0),
      plannedEnd: window(480),
      vehicleId,
    });
    expect(routeA.status).toBe(201);

    // Overlapping create on the same vehicle → 409 naming that vehicle, nothing written.
    const overlapName = routeName('AC5-overlap');
    const overlap = await createRoute(request, dispatcherToken, {
      name: overlapName,
      plannedStart: window(240),
      plannedEnd: window(720),
      vehicleId,
    });
    expect(overlap.status).toBe(409);
    expect(String(overlap.body.detail), 'the detail names the conflicting vehicle').toContain(
      `Vehicle ${vehicleId}`,
    );
    expect(await countByName(request, overlapName), 'a conflicting create writes nothing').toBe(0);

    // Touching at the boundary (16:00-20:00) is not an overlap.
    const touch = await createRoute(request, dispatcherToken, {
      name: routeName('AC5-touch'),
      plannedStart: window(480),
      plannedEnd: window(720),
      vehicleId,
    });
    expect(touch.status, 'a window that merely touches the boundary does not conflict').toBe(201);

    // Driver half of BR-4: an InProgress route (seeded — the API only mints Planned) blocks a
    // Planned route that would put the same driver on an overlapping window.
    const driverId = await freshDriver(request);
    await seedRoute({
      name: routeName('AC5-driver-busy'),
      status: 'InProgress',
      driverId,
      plannedStart: window(0),
      plannedEnd: window(480),
    });

    const driverTarget = await createRoute(request, dispatcherToken, {
      name: routeName('AC5-driver-target'),
      plannedStart: window(240),
      plannedEnd: window(720),
    });
    const driverTargetId = Number(driverTarget.body.id);
    const before = JSON.stringify((await getRoute(request, dispatcherToken, driverTargetId)).body);

    const driverConflict = await patchRoute(request, dispatcherToken, driverTargetId, { driverId });
    expect(driverConflict.status).toBe(409);
    expect(String(driverConflict.body.detail), 'the detail names the conflicting driver').toContain(
      `Driver ${driverId}`,
    );
    expect(
      JSON.stringify((await getRoute(request, dispatcherToken, driverTargetId)).body),
      'the conflicted route is unchanged',
    ).toBe(before);

    // A terminal (Cancelled) route holding the same vehicle and window never conflicts.
    const terminalVehicleId = await freshVehicle(request);
    await seedRoute({
      name: routeName('AC5-cancelled'),
      status: 'Cancelled',
      vehicleId: terminalVehicleId,
      plannedStart: window(0),
      plannedEnd: window(480),
    });
    const terminalTarget = await createRoute(request, dispatcherToken, {
      name: routeName('AC5-terminal-target'),
      plannedStart: window(0),
      plannedEnd: window(480),
    });
    const terminalAssign = await patchRoute(request, dispatcherToken, Number(terminalTarget.body.id), {
      vehicleId: terminalVehicleId,
    });
    expect(terminalAssign.status, 'a Cancelled route does not block the window').toBe(200);
    expect(terminalAssign.body.vehicleId).toBe(terminalVehicleId);
  });

  test('AC-6 — assigning is Planned-only: a non-Planned route is a 409 that changes nothing // LOGI-0009 AC-6', async ({
    request,
  }) => {
    const vehicleId = await freshVehicle(request);

    for (const status of ['InProgress', 'Completed', 'Cancelled'] as const) {
      const seeded = await seedRoute({ name: routeName(`AC6-${status}`), status });

      // The row stays readable — the guard lives on PATCH, not on read.
      const readable = await getRoute(request, dispatcherToken, seeded.id);
      expect(readable.status).toBe(200);
      expect(readable.body.status).toBe(status);
      const before = JSON.stringify(readable.body);

      const rejected = await patchRoute(request, dispatcherToken, seeded.id, { vehicleId });
      expect(rejected.status, `PATCH on a ${status} route must be a 409`).toBe(409);
      expect(String(rejected.body.detail), 'the detail names the required status').toContain('Planned');
      expect(
        JSON.stringify((await getRoute(request, dispatcherToken, seeded.id)).body),
        `every column of the ${status} route is unchanged`,
      ).toBe(before);
    }
  });

  test('AC-10 — server-owned fields are rejected field-keyed and no shipment write happens // LOGI-0009 AC-10', async ({
    request,
  }) => {
    const serverOwned: Record<string, unknown> = {
      id: 42,
      status: 'Completed',
      createdAt: window(0),
      updatedAt: window(0),
    };

    for (const [field, value] of Object.entries(serverOwned)) {
      const name = routeName(`AC10-${field}`);
      const rejected = await createRoute(request, dispatcherToken, {
        name,
        plannedStart: window(0),
        plannedEnd: window(480),
        [field]: value,
      });
      expect(rejected.status, `POST with ${field} must be a 400`).toBe(400);
      expect(Object.keys(rejected.body.errors ?? {}), `POST with ${field} keys ${field}`).toContain(field);
      expect(await countByName(request, name), `POST with ${field} writes nothing`).toBe(0);
    }

    const target = await createRoute(request, dispatcherToken, {
      name: routeName('AC10-target'),
      plannedStart: window(0),
      plannedEnd: window(480),
    });
    const routeId = Number(target.body.id);
    const before = JSON.stringify((await getRoute(request, dispatcherToken, routeId)).body);

    for (const [field, value] of Object.entries(serverOwned)) {
      const rejected = await patchRoute(request, dispatcherToken, routeId, { [field]: value });
      expect(rejected.status, `PATCH with ${field} must be a 400`).toBe(400);
      expect(Object.keys(rejected.body.errors ?? {}), `PATCH with ${field} keys ${field}`).toContain(field);
    }
    expect(
      JSON.stringify((await getRoute(request, dispatcherToken, routeId)).body),
      'a rejected PATCH is never partially applied',
    ).toBe(before);

    // Route create/assign never writes a shipment row (LOGI-0010 owns shipment→route assignment).
    const warehouseId = await seedWarehouse(request, adminToken, `${routeName('AC10')} WH`);
    const shipment = await createShipment(request, dispatcherToken, {
      originWarehouseId: warehouseId,
      destinationAddress: '2 Route Road',
      weightKg: 5,
    });
    const shipmentId = Number(shipment.body.id);
    await patchRoute(request, dispatcherToken, routeId, { vehicleId: await freshVehicle(request) });
    expect((await getShipment(request, dispatcherToken, shipmentId)).body.routeId ?? null).toBeNull();
  });
});
