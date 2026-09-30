import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, seedVehicle, seedWarehouse, signIn } from './support/api';
import { getHistory, getShipment } from './support/shipments';
import { createRoute, getRoute, routeName, seedRoute, uniqueRef, window } from './support/routes';
import {
  assignShipmentToRoute,
  listRouteShipments,
  removeShipmentFromRoute,
  seedAssignedShipment,
} from './support/route-shipments';

/**
 * LOGI-0010 assign / unassign / list against the real API, real JWTs and the throwaway SQLite
 * database (AC-1..AC-6, AC-8, AC-9).
 *
 * Everything asserted here is behaviour the MSW mock also models, but the mock proves the *client
 * and UI* behave — only this suite proves the *server* enforces BR-5 and O2/O3. The two agree by
 * construction on the one point that matters most: spec §7 O1 made capacity and status violations
 * 409 (not the 400 the HLD sketch suggested), and both layers assert 409.
 */
test.describe('LOGI-0010 assign a shipment to a route (API)', () => {
  let adminToken: string;
  let warehouseId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('AC')}`);
  });

  /**
   * A Planned route carrying a vehicle of exactly `capacityKg` (the BR-5 fixture).
   *
   * `request` is passed explicitly rather than closed over: the `beforeEach` fixture's `request` is
   * not in lexical scope here, so a closure would only compile by accident and fail at runtime.
   */
  async function seedRouteWithVehicle(request: APIRequestContext, capacityKg: number): Promise<number> {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('CAP'), { capacityKg });
    const route = await seedRoute({ status: 'Planned', vehicleId });
    return route.id;
  }

  /** A Planned route with no vehicle — the AC-2 "capacity is simply not checked" case. */
  async function seedVehicleLessRoute(): Promise<number> {
    return (await seedRoute({ status: 'Planned', vehicleId: null })).id;
  }

  // LOGI-0010 AC-1
  test('AC-1 — assign 200s, auto-transitions Pending -> Assigned, and the route row is unchanged // LOGI-0010 AC-1', async ({
    request,
  }) => {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('AC1'));
    const created = await createRoute(request, adminToken, {
      name: routeName('AC1'),
      plannedStart: window(0),
      plannedEnd: window(480),
      vehicleId,
    });
    expect(created.status).toBe(201);
    const routeId = Number(created.body.id);

    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 300 });

    const assigned = await assignShipmentToRoute(request, adminToken, routeId, {
      shipmentId: shipment.id,
    });

    // The 200 body is the authoritative read-back: routeId set, status Assigned, weight unchanged.
    expect(assigned.status).toBe(200);
    expect(assigned.body.routeId).toBe(routeId);
    expect(assigned.body.status).toBe('Assigned');
    expect(assigned.body.weightKg).toBe(300);

    // Readable through the LOGI-0007 read model, and listed by the route.
    const readBack = await getShipment(request, adminToken, shipment.id);
    expect(readBack.status).toBe(200);
    expect(readBack.body.routeId).toBe(routeId);
    expect(readBack.body.status).toBe('Assigned');

    const listed = await listRouteShipments(request, adminToken, routeId);
    expect(listed.status).toBe(200);
    expect(listed.body.items?.map((s) => s.id)).toContain(shipment.id);

    // Exactly one Pending -> Assigned history row, with a null note.
    const history = await getHistory(request, adminToken, shipment.id);
    expect(history.status).toBe(200);
    const assignedRows = (history.body.items ?? []).filter((e) => e.toStatus === 'Assigned');
    expect(assignedRows).toHaveLength(1);
    expect(assignedRows[0].fromStatus).toBe('Pending');
    expect(assignedRows[0].note).toBeNull();

    // The route row itself (name, window, vehicle, driver, status) is untouched.
    const routeAfter = await getRoute(request, adminToken, routeId);
    expect(routeAfter.status).toBe(200);
    expect(routeAfter.body.name).toBe(created.body.name);
    expect(routeAfter.body.vehicleId).toBe(vehicleId);
    expect(routeAfter.body.status).toBe('Planned');
  });

  // LOGI-0010 AC-2
  test('AC-2 — the BR-5 guard accepts up to capacity and 409s with all three numbers // LOGI-0010 AC-2', async ({
    request,
  }) => {
    const routeId = await seedRouteWithVehicle(request, 1000);
    const s1 = await seedAssignedShipment({ warehouseId, weightKg: 400 });
    const s2 = await seedAssignedShipment({ warehouseId, weightKg: 500 });
    const s3 = await seedAssignedShipment({ warehouseId, weightKg: 200 });

    // 400 <= 1000, then 900 <= 1000: both fit.
    expect((await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: s1.id })).status).toBe(200);
    expect((await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: s2.id })).status).toBe(200);

    // 900 + 200 > 1000 -> 409, and the detail names assigned / adding / capacity (§7 O1: 409).
    const rejected = await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: s3.id });
    expect(rejected.status).toBe(409);
    expect(rejected.body.detail).toContain('900');
    expect(rejected.body.detail).toContain('200');
    expect(rejected.body.detail).toContain('1000');

    // S3 is byte-identical afterwards and R's numbers are unchanged (AC-2, AC-9).
    const untouched = await getShipment(request, adminToken, s3.id);
    expect(untouched.body.routeId).toBeNull();
    expect(untouched.body.status).toBe('Pending');
    const page = await listRouteShipments(request, adminToken, routeId);
    expect(page.body.capacity.assignedWeightKg).toBe(900);
    expect(page.body.capacity.shipmentCount).toBe(2);
  });

  // LOGI-0010 AC-2
  test('AC-2 — a route with no vehicle assigns any weight and the projection reports nulls // LOGI-0010 AC-2', async ({
    request,
  }) => {
    const routeId = await seedVehicleLessRoute();
    const heavy = await seedAssignedShipment({ warehouseId, weightKg: 9000 });

    const assigned = await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: heavy.id });
    expect(assigned.status).toBe(200);

    const page = await listRouteShipments(request, adminToken, routeId);
    expect(page.status).toBe(200);
    // null, NOT 0: an unknown capacity is not a full truck.
    expect(page.body.capacity.capacityKg).toBeNull();
    expect(page.body.capacity.vehicleId).toBeNull();
    expect(page.body.capacity.remainingCapacityKg).toBeNull();
    expect(page.body.capacity.assignedWeightKg).toBe(9000);
  });

  // LOGI-0010 AC-3
  test('AC-3 — an unknown route is 404 and a non-Planned route is 409 naming "Planned" // LOGI-0010 AC-3', async ({
    request,
  }) => {
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 100 });

    const missing = await assignShipmentToRoute(request, adminToken, 999999, { shipmentId: shipment.id });
    expect(missing.status).toBe(404);

    // O2: assignment is Planned-only. InProgress is server-owned, so the row is seeded.
    const inProgress = await seedRoute({ status: 'InProgress', vehicleId: null });
    const conflict = await assignShipmentToRoute(request, adminToken, inProgress.id, { shipmentId: shipment.id });
    expect(conflict.status).toBe(409);
    expect(conflict.body.detail).toContain('Planned');

    // The shipment is unchanged by either rejection.
    const untouched = await getShipment(request, adminToken, shipment.id);
    expect(untouched.body.routeId).toBeNull();
    expect(untouched.body.status).toBe('Pending');
  });

  // LOGI-0010 AC-4
  test('AC-4 — an unknown shipment is 404, a non-Pending one is 409 naming "Pending" // LOGI-0010 AC-4', async ({
    request,
  }) => {
    const routeId = await seedVehicleLessRoute();

    expect((await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: 999999 })).status).toBe(404);

    // A non-Pending shipment is one already linked to a *different* route — that is the "Assigned"
    // state, and it is the only such state reachable here: re-assigning a shipment to the route it
    // already belongs to is the idempotent 200, which AC-4 proves as its own case. Asserting 409 for
    // a same-route re-assign would be asserting the wrong contract.
    const otherRouteId = (await seedRoute({ status: 'Planned' })).id;
    const alreadyAssigned = await seedAssignedShipment({ warehouseId, weightKg: 100, routeId: otherRouteId });
    expect(alreadyAssigned.routeId).toBe(otherRouteId);

    const conflict = await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: alreadyAssigned.id });
    expect(conflict.status).toBe(409);
    // It stays with its original owner.
    expect((await getShipment(request, adminToken, alreadyAssigned.id)).body.routeId).toBe(otherRouteId);
  });

  // LOGI-0010 AC-4
  test('AC-4 — one route at a time: a second route 409s and keeps the first owner // LOGI-0010 AC-4', async ({
    request,
  }) => {
    const r1 = await seedRouteWithVehicle(request, 5000);
    const r2 = await seedRouteWithVehicle(request, 5000);
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 100 });

    expect((await assignShipmentToRoute(request, adminToken, r1, { shipmentId: shipment.id })).status).toBe(200);

    // O3: moving requires an explicit unassign first.
    const conflict = await assignShipmentToRoute(request, adminToken, r2, { shipmentId: shipment.id });
    expect(conflict.status).toBe(409);
    expect((await getShipment(request, adminToken, shipment.id)).body.routeId).toBe(r1);
  });

  // LOGI-0010 AC-4
  test('AC-4 — re-assigning to the SAME route is an idempotent 200 with no second row // LOGI-0010 AC-4', async ({
    request,
  }) => {
    const routeId = await seedRouteWithVehicle(request, 1000);
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 300 });

    expect((await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: shipment.id })).status).toBe(200);
    const again = await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: shipment.id });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('Assigned');

    const history = await getHistory(request, adminToken, shipment.id);
    expect((history.body.items ?? []).filter((e) => e.toStatus === 'Assigned')).toHaveLength(1);

    // No capacity double-count: 300, not 600.
    const page = await listRouteShipments(request, adminToken, routeId);
    expect(page.body.capacity.assignedWeightKg).toBe(300);
    expect(page.body.capacity.shipmentCount).toBe(1);
  });

  // LOGI-0010 AC-5
  test('AC-5 — a missing/zero/negative/non-numeric shipmentId is a 400 keyed on shipmentId // LOGI-0010 AC-5', async ({
    request,
  }) => {
    const routeId = await seedVehicleLessRoute();
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 100 });

    for (const body of [{}, { shipmentId: null }, { shipmentId: 0 }, { shipmentId: -3 }, { shipmentId: 'abc' }]) {
      const rejected = await assignShipmentToRoute(request, adminToken, routeId, body);
      expect(rejected.status, `body ${JSON.stringify(body)} must be a 400`).toBe(400);
      expect(rejected.body.errors?.shipmentId, 'the error must be keyed on shipmentId').toBeDefined();
    }

    // Nothing was written by any of the five rejections.
    const untouched = await getShipment(request, adminToken, shipment.id);
    expect(untouched.body.routeId).toBeNull();
    expect(untouched.body.status).toBe('Pending');
  });

  // LOGI-0010 AC-8
  test('AC-8 — the paged envelope carries the projection; bad paging is 400, unknown route 404 // LOGI-0010 AC-8', async ({
    request,
  }) => {
    const routeId = await seedRouteWithVehicle(request, 1000);
    // Seeded already linked: three rows at 400 + 300 + 200 = 900 of 1000 kg.
    for (const weightKg of [400, 300, 200]) {
      await seedAssignedShipment({ warehouseId, weightKg, routeId });
    }

    const page = await listRouteShipments(request, adminToken, routeId, { page: 1, pageSize: 20 });
    expect(page.status).toBe(200);
    expect(page.body.page).toBe(1);
    expect(page.body.pageSize).toBe(20);
    expect(page.body.totalCount).toBe(3);
    expect(page.body.items).toHaveLength(3);
    expect(page.body.capacity.assignedWeightKg).toBe(900);
    expect(page.body.capacity.remainingCapacityKg).toBe(100);
    expect(page.body.capacity.shipmentCount).toBe(3);

    // Paging really pages: pageSize 2 of 3 rows, and the projection still covers the whole route.
    const firstPage = await listRouteShipments(request, adminToken, routeId, { page: 1, pageSize: 2 });
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.totalPages).toBe(2);
    expect(firstPage.body.capacity.assignedWeightKg).toBe(900);

    expect((await listRouteShipments(request, adminToken, routeId, { page: 0 })).status).toBe(400);
    expect((await listRouteShipments(request, adminToken, routeId, { pageSize: 500 })).status).toBe(400);
    expect((await listRouteShipments(request, adminToken, 999999)).status).toBe(404);
  });

  // LOGI-0010 AC-9
  test('AC-9 — a rejected assign leaves route_id, status and history all-or-nothing // LOGI-0010 AC-9', async ({
    request,
  }) => {
    const routeId = await seedRouteWithVehicle(request, 1000);
    const kept = await seedAssignedShipment({ warehouseId, weightKg: 900, routeId });
    const rejected = await seedAssignedShipment({ warehouseId, weightKg: 200 });

    const historyBefore = (await getHistory(request, adminToken, rejected.id)).body.totalCount;
    const capacityBefore = (await listRouteShipments(request, adminToken, routeId)).body.capacity;

    const conflict = await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: rejected.id });
    expect(conflict.status).toBe(409);

    const after = await getShipment(request, adminToken, rejected.id);
    expect(after.body.routeId).toBeNull();
    expect(after.body.status).toBe('Pending');
    expect((await getHistory(request, adminToken, rejected.id)).body.totalCount).toBe(historyBefore);

    const capacityAfter = (await listRouteShipments(request, adminToken, routeId)).body.capacity;
    expect(capacityAfter?.assignedWeightKg).toBe(capacityBefore?.assignedWeightKg);
    expect(capacityAfter?.shipmentCount).toBe(capacityBefore?.shipmentCount);
    expect(kept.routeId).toBe(routeId);
  });
});

test.describe('LOGI-0010 unassign (API)', () => {
  let adminToken: string;
  let warehouseId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('UN')}`);
  });

  // LOGI-0010 AC-6
  test('AC-6 — unassign 204s, returns the shipment to Pending and frees the capacity // LOGI-0010 AC-6', async ({
    request,
  }) => {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('UN6'), { capacityKg: 1000 });
    const routeId = (await seedRoute({ status: 'Planned', vehicleId })).id;
    const s1 = await seedAssignedShipment({ warehouseId, weightKg: 400, routeId });
    const s2 = await seedAssignedShipment({ warehouseId, weightKg: 500, routeId });

    expect((await listRouteShipments(request, adminToken, routeId)).body.capacity?.remainingCapacityKg).toBe(100);

    const removed = await removeShipmentFromRoute(request, adminToken, routeId, s1.id);
    expect(removed.status).toBe(204);
    expect(removed.body).toEqual({}); // an empty body, per the contract

    const freed = await getShipment(request, adminToken, s1.id);
    expect(freed.body.routeId).toBeNull();
    expect(freed.body.status).toBe('Pending');

    // Exactly one Assigned -> Pending row, and the weight is reusable.
    const history = await getHistory(request, adminToken, s1.id);
    expect(
      (history.body.items ?? []).filter((e) => e.toStatus === 'Pending' && e.fromStatus === 'Assigned'),
    ).toHaveLength(1);
    expect((await listRouteShipments(request, adminToken, routeId)).body.capacity?.remainingCapacityKg).toBe(500);
    expect((await listRouteShipments(request, adminToken, routeId)).body.capacity?.shipmentCount).toBe(1);

    // The freed 500 kg now admits a 500 kg shipment (the AC-2 scenario reversed).
    const s3 = await seedAssignedShipment({ warehouseId, weightKg: 500 });
    expect((await assignShipmentToRoute(request, adminToken, routeId, { shipmentId: s3.id })).status).toBe(200);
    expect((await listRouteShipments(request, adminToken, routeId)).body.capacity?.remainingCapacityKg).toBe(0);
    // The untouched sibling is unaffected.
    expect((await getShipment(request, adminToken, s2.id)).body.routeId).toBe(routeId);
  });

  // LOGI-0010 AC-6
  test('AC-6 — a repeat unassign, a wrong-route unassign and unknown ids are 404 // LOGI-0010 AC-6', async ({
    request,
  }) => {
    const r1 = (await seedRoute({ status: 'Planned' })).id;
    const r2 = (await seedRoute({ status: 'Planned' })).id;
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 100, routeId: r1 });

    // Not on this route -> 404, as do unknown route and shipment ids.
    expect((await removeShipmentFromRoute(request, adminToken, r2, shipment.id)).status).toBe(404);
    expect((await removeShipmentFromRoute(request, adminToken, 999999, shipment.id)).status).toBe(404);
    expect((await removeShipmentFromRoute(request, adminToken, r1, 999999)).status).toBe(404);

    expect((await removeShipmentFromRoute(request, adminToken, r1, shipment.id)).status).toBe(204);
    // Already unassigned -> 404 again (a repeat DELETE is deliberately not idempotent here).
    expect((await removeShipmentFromRoute(request, adminToken, r1, shipment.id)).status).toBe(404);
  });

  // LOGI-0010 AC-6
  test('AC-6 — unassign is refused once the shipment has left "Assigned" by another path // LOGI-0010 AC-6', async ({
    request,
  }) => {
    const routeId = (await seedRoute({ status: 'Planned' })).id;
    const shipment = await seedAssignedShipment({ warehouseId, weightKg: 100, routeId });

    // Drive it out of Assigned through the BR-7 transition endpoint (LOGI-0006), leaving the
    // route_id link in place — precisely the state AC-6 says must be refused.
    const driven = await request.post(`${API}/api/v1/shipments/${shipment.id}/status-transitions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { toStatus: 'InTransit', note: null },
    });
    expect(driven.status()).toBe(200);

    const conflict = await removeShipmentFromRoute(request, adminToken, routeId, shipment.id);
    expect(conflict.status).toBe(409);
    // Refused, and the link survives.
    expect((await getShipment(request, adminToken, shipment.id)).body.routeId).toBe(routeId);
  });
});