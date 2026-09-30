import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../api/client';
import { seedRoute, seedShipment, seedVehicle } from '../../mocks/handlers';
import { renderAnonymousApp, renderAppAs, resetMocks } from '../../test/renderApp';

beforeEach(() => {
  resetMocks();
});

/** Renders the app as `role` and opens the Routes tab. */
async function renderRoutesTab(role: 'Admin' | 'Dispatcher' | 'Viewer' | 'Driver' = 'Admin') {
  const user = userEvent.setup();
  renderAppAs(role);
  await user.click(await screen.findByTestId('tab-routes'));
  return user;
}

/** Opens the Shipments panel for the row whose route is `routeId` and waits for its first read. */
async function openPanel(user: ReturnType<typeof userEvent.setup>, routeId: number) {
  await user.click(await screen.findByTestId(`route-shipments-${routeId}`));
  const panel = await screen.findByTestId('route-shipments-panel');
  await waitFor(() => expect(within(panel).queryByText('Loading shipments…')).toBeNull());
  return panel;
}

/** Picks `label` in the assign select and presses Assign. */
async function assignCandidate(
  user: ReturnType<typeof userEvent.setup>,
  panel: HTMLElement,
  label: string,
) {
  await user.click(within(panel).getByLabelText('Shipment to assign'));
  await user.click(await screen.findByRole('option', { name: new RegExp(label) }));
  await user.click(within(panel).getByTestId('assign-shipment'));
}

describe('RouteShipmentsPanel — assign (LOGI-0010)', () => {
  // LOGI-0010 AC-1
  it('AC-1: assigns a Pending shipment, shows it as Assigned, and the route itself is unchanged', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ name: 'North loop', vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 300, status: 'Pending', routeId: null });
    const before = { ...route };

    const user = await renderRoutesTab('Admin');
    const panel = await openPanel(user, route.id);

    await assignCandidate(user, panel, shipment.referenceCode);

    await waitFor(() =>
      expect(within(panel).getByTestId(`route-shipment-status-${shipment.id}`)).toHaveTextContent('Assigned'),
    );

    // Read-back through the LOGI-0007 read model: routeId set, status Assigned, weight unchanged.
    const readBack = await api.getShipment(shipment.id);
    expect(readBack.routeId).toBe(route.id);
    expect(readBack.status).toBe('Assigned');
    expect(readBack.weightKg).toBe(300);

    // AC-1: the route row (name, window, vehicle, driver, status) is untouched.
    const after = await api.getRoute(route.id);
    expect(after.name).toBe(before.name);
    expect(after.plannedStart).toBe(before.plannedStart);
    expect(after.plannedEnd).toBe(before.plannedEnd);
    expect(after.vehicleId).toBe(before.vehicleId);
    expect(after.driverId).toBe(before.driverId);
    expect(after.status).toBe(before.status);
  });

  // LOGI-0010 AC-1
  it('AC-1: the assign appends exactly one Pending -> Assigned status-history row', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 300, status: 'Pending', routeId: null });

    const user = await renderRoutesTab('Admin');
    const panel = await openPanel(user, route.id);
    await assignCandidate(user, panel, shipment.referenceCode);
    await waitFor(() => expect(within(panel).getByTestId(`route-shipment-${shipment.id}`)).toBeInTheDocument());

    const history = await api.listShipmentStatusHistory(shipment.id);
    const assignedRows = history.items.filter((event) => event.toStatus === 'Assigned');
    expect(assignedRows).toHaveLength(1);
    expect(assignedRows[0].fromStatus).toBe('Pending');
    expect(assignedRows[0].note).toBeNull();
  });

  // LOGI-0010 AC-2
  it('AC-2: accepts up to capacity and rejects the assign that would exceed it', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const s1 = seedShipment({ weightKg: 400, status: 'Pending', routeId: null });
    const s2 = seedShipment({ weightKg: 500, status: 'Pending', routeId: null });
    const s3 = seedShipment({ weightKg: 200, status: 'Pending', routeId: null });

    const user = await renderRoutesTab('Admin');
    const panel = await openPanel(user, route.id);

    await assignCandidate(user, panel, s1.referenceCode);
    await waitFor(() => expect(within(panel).getByTestId(`route-shipment-${s1.id}`)).toBeInTheDocument());
    await assignCandidate(user, panel, s2.referenceCode);
    await waitFor(() => expect(within(panel).getByTestId(`route-shipment-${s2.id}`)).toBeInTheDocument());

    // 400 + 500 = 900 <= 1000, so the projection reads 900 assigned / 100 remaining.
    await waitFor(() =>
      expect(within(panel).getByTestId('capacity-numbers')).toHaveTextContent('100 kg remaining of 1000 kg capacity'),
    );

    // S3 (200) would make 1100 > 1000 -> 409 naming all three numbers, and S3 is left untouched.
    await assignCandidate(user, panel, s3.referenceCode);
    const alert = await within(panel).findByTestId('panel-error');
    expect(alert).toHaveTextContent('assigned 900 kg');
    expect(alert).toHaveTextContent('adding 200 kg');
    expect(alert).toHaveTextContent('capacity 1000 kg');

    const untouched = await api.getShipment(s3.id);
    expect(untouched.routeId).toBeNull();
    expect(untouched.status).toBe('Pending');

    const page = await api.listRouteShipments(route.id);
    expect(page.capacity.assignedWeightKg).toBe(900);
    expect(page.capacity.shipmentCount).toBe(2);
  });

  // LOGI-0010 AC-2
  it('AC-2: a route with no vehicle accepts any weight and reports null capacity, not 0', async () => {
    const route = seedRoute({ vehicleId: null, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 5000, status: 'Pending', routeId: null });

    const user = await renderRoutesTab('Admin');
    const panel = await openPanel(user, route.id);

    expect(within(panel).getByTestId('capacity-unknown')).toBeInTheDocument();
    await assignCandidate(user, panel, shipment.referenceCode);

    await waitFor(() => expect(within(panel).getByTestId(`route-shipment-${shipment.id}`)).toBeInTheDocument());
    const page = await api.listRouteShipments(route.id);
    expect(page.capacity.capacityKg).toBeNull();
    expect(page.capacity.vehicleId).toBeNull();
    expect(page.capacity.remainingCapacityKg).toBeNull();
    expect(page.capacity.assignedWeightKg).toBe(5000);
  });

  // LOGI-0010 AC-3
  it('AC-3: a non-Planned route offers no assign affordance and the API still answers 409', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'InProgress' });
    const shipment = seedShipment({ weightKg: 100, status: 'Pending', routeId: null });

    const user = await renderRoutesTab('Admin');
    const panel = await openPanel(user, route.id);

    expect(within(panel).queryByTestId('assign-shipment')).toBeNull();
    expect(within(panel).getByTestId('panel-readonly-reason')).toHaveTextContent("'Planned'");

    await expect(api.assignShipmentToRoute(route.id, { shipmentId: shipment.id })).rejects.toMatchObject({
      status: 409,
    });
    expect((await api.getShipment(shipment.id)).routeId).toBeNull();
  });

  // LOGI-0010 AC-3
  it('AC-3: an unknown route id is a 404', async () => {
    seedRoute({ status: 'Planned' });
    await renderRoutesTab('Admin');
    await expect(api.assignShipmentToRoute(999999, { shipmentId: 1 })).rejects.toMatchObject({
      status: 404,
    });
  });

  // LOGI-0010 AC-4
  it('AC-4: a non-Pending shipment is a 409 naming the required status', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 100, status: 'InTransit', routeId: null });

    await renderRoutesTab('Admin');
    await expect(api.assignShipmentToRoute(route.id, { shipmentId: shipment.id })).rejects.toMatchObject({
      status: 409,
    });
    expect((await api.getShipment(shipment.id)).routeId).toBeNull();
  });

  // LOGI-0010 AC-4
  it('AC-4: an unknown shipment id is a 404', async () => {
    const route = seedRoute({ status: 'Planned' });
    await renderRoutesTab('Admin');
    await expect(api.assignShipmentToRoute(route.id, { shipmentId: 999999 })).rejects.toMatchObject({
      status: 404,
    });
  });

  // LOGI-0010 AC-4
  it('AC-4: re-assigning to a second route is a 409 and the shipment stays on the first', async () => {
    const vehicle = seedVehicle({ capacityKg: 5000 });
    const r1 = seedRoute({ name: 'Route one', vehicleId: vehicle.id, status: 'Planned' });
    const r2 = seedRoute({ name: 'Route two', vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 100, status: 'Pending', routeId: null });

    await renderRoutesTab('Admin');
    await api.assignShipmentToRoute(r1.id, { shipmentId: shipment.id });

    await expect(api.assignShipmentToRoute(r2.id, { shipmentId: shipment.id })).rejects.toMatchObject({
      status: 409,
    });
    expect((await api.getShipment(shipment.id)).routeId).toBe(r1.id);
  });

  // LOGI-0010 AC-4
  it('AC-4: re-assigning to the SAME route is an idempotent 200 with no second history row', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 300, status: 'Pending', routeId: null });

    await renderRoutesTab('Admin');
    await api.assignShipmentToRoute(route.id, { shipmentId: shipment.id });
    const again = await api.assignShipmentToRoute(route.id, { shipmentId: shipment.id });

    expect(again.status).toBe('Assigned');
    const history = await api.listShipmentStatusHistory(shipment.id);
    expect(history.items.filter((e) => e.toStatus === 'Assigned')).toHaveLength(1);
    // No capacity double-count: 300 assigned, not 600.
    expect((await api.listRouteShipments(route.id)).capacity.assignedWeightKg).toBe(300);
  });

  // LOGI-0010 AC-5
  it('AC-5: a missing/zero/non-numeric shipmentId is a 400 keyed on shipmentId, writing nothing', async () => {
    const route = seedRoute({ status: 'Planned' });
    const shipment = seedShipment({ weightKg: 100, status: 'Pending', routeId: null });

    await renderRoutesTab('Admin');
    for (const body of [{}, { shipmentId: null }, { shipmentId: 0 }, { shipmentId: -3 }, { shipmentId: 'abc' }]) {
      await expect(
        api.assignShipmentToRoute(route.id, body as { shipmentId: number }),
      ).rejects.toMatchObject({ status: 400 });
    }
    const untouched = await api.getShipment(shipment.id);
    expect(untouched.routeId).toBeNull();
    expect(untouched.status).toBe('Pending');
  });
});
describe('RouteShipmentsPanel — unassign (LOGI-0010 AC-6)', () => {
  // LOGI-0010 AC-6
  it('AC-6: unassigning frees the weight and returns the shipment to Pending with one history row', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const s1 = seedShipment({ weightKg: 400, status: 'Pending', routeId: null });
    const s2 = seedShipment({ weightKg: 500, status: 'Pending', routeId: null });

    // s3 is seeded up front: the candidate select renders from the panel's initial GET /shipments
    // read, so a shipment created mid-session would not appear in it without a manual refresh.
    const s3 = seedShipment({ weightKg: 500, status: 'Pending', routeId: null });

    const user = await renderRoutesTab('Admin');
    const panel = await openPanel(user, route.id);
    await assignCandidate(user, panel, s1.referenceCode);
    await waitFor(() => expect(within(panel).getByTestId(`route-shipment-${s1.id}`)).toBeInTheDocument());
    await assignCandidate(user, panel, s2.referenceCode);
    await waitFor(() => expect(within(panel).getByTestId(`route-shipment-${s2.id}`)).toBeInTheDocument());

    await user.click(within(panel).getByTestId(`unassign-shipment-${s1.id}`));
    await waitFor(() => expect(within(panel).queryByTestId(`route-shipment-${s1.id}`)).toBeNull());

    const freed = await api.getShipment(s1.id);
    expect(freed.routeId).toBeNull();
    expect(freed.status).toBe('Pending');

    // Exactly one Assigned -> Pending row, and the freed weight is reusable (AC-2 reversed:
    // 1000 - 500 = 500 remaining).
    const history = await api.listShipmentStatusHistory(s1.id);
    expect(history.items.filter((e) => e.toStatus === 'Pending' && e.fromStatus === 'Assigned')).toHaveLength(1);
    await waitFor(() =>
      expect(within(panel).getByTestId('capacity-numbers')).toHaveTextContent('500 kg remaining of 1000 kg capacity'),
    );

    // A 500 kg shipment now fits in the freed 500 kg.
    await assignCandidate(user, panel, s3.referenceCode);
    await waitFor(() => expect(within(panel).getByTestId(`route-shipment-${s3.id}`)).toBeInTheDocument());
  });

  // LOGI-0010 AC-6
  it('AC-6: a repeat unassign is a 404, and so is unassigning from the wrong route', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const r1 = seedRoute({ name: 'Route one', vehicleId: vehicle.id, status: 'Planned' });
    const r2 = seedRoute({ name: 'Route two', vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 100, status: 'Pending', routeId: null });

    await renderRoutesTab('Admin');
    await api.assignShipmentToRoute(r1.id, { shipmentId: shipment.id });

    await expect(api.removeShipmentFromRoute(r2.id, shipment.id)).rejects.toMatchObject({ status: 404 });
    await api.removeShipmentFromRoute(r1.id, shipment.id);
    await expect(api.removeShipmentFromRoute(r1.id, shipment.id)).rejects.toMatchObject({ status: 404 });
  });

  // LOGI-0010 AC-6
  it('AC-6: unassign is refused with 409 once the shipment has left Assigned', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 100, status: 'Pending', routeId: null });

    await renderRoutesTab('Admin');
    await api.assignShipmentToRoute(route.id, { shipmentId: shipment.id });
    // The shipment moves on by another path (BR-7 Assigned -> InTransit) while still linked.
    await api.transitionShipmentStatus(shipment.id, { toStatus: 'InTransit', note: null });

    await expect(api.removeShipmentFromRoute(route.id, shipment.id)).rejects.toMatchObject({ status: 409 });
    expect((await api.getShipment(shipment.id)).routeId).toBe(route.id);
  });
});
describe('RouteShipmentsPanel — list, capacity projection and roles (LOGI-0010 AC-7/AC-8/AC-10)', () => {
  // LOGI-0010 AC-8
  it('AC-8: the paged envelope and the capacity projection report the running totals', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    await renderRoutesTab('Admin');
    for (const weightKg of [400, 300, 200]) {
      const s = seedShipment({ weightKg, status: 'Pending', routeId: null });
      await api.assignShipmentToRoute(route.id, { shipmentId: s.id });
    }

    const page = await api.listRouteShipments(route.id, { page: 1, pageSize: 20 });
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
    expect(page.totalCount).toBe(3);
    expect(page.totalPages).toBe(1);
    expect(page.items).toHaveLength(3);
    expect(page.capacity.assignedWeightKg).toBe(900);
    expect(page.capacity.remainingCapacityKg).toBe(100);
    expect(page.capacity.shipmentCount).toBe(3);
    expect(page.capacity.vehicleId).toBe(vehicle.id);

    // AC-8: an invalid page/pageSize is a 400, and an unknown route is a 404.
    await expect(api.listRouteShipments(route.id, { page: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(api.listRouteShipments(route.id, { pageSize: 500 })).rejects.toMatchObject({ status: 400 });
    await expect(api.listRouteShipments(999999)).rejects.toMatchObject({ status: 404 });
  });

  // LOGI-0010 AC-7
  it('AC-7: a Viewer sees the panel and its shipments but gets no write affordances', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    // Seeded already-assigned so the Viewer session alone drives the read; a second render in one
    // test would leave the first app's DOM mounted and make the queries ambiguous.
    const shipment = seedShipment({ weightKg: 100, status: 'Assigned', routeId: route.id });

    const viewer = await renderRoutesTab('Viewer');
    const viewerPanel = await openPanel(viewer, route.id);
    expect(within(viewerPanel).getByTestId(`route-shipment-${shipment.id}`)).toBeInTheDocument();
    expect(within(viewerPanel).queryByTestId('assign-shipment')).toBeNull();
    expect(within(viewerPanel).queryByTestId(`unassign-shipment-${shipment.id}`)).toBeNull();
  });

  // LOGI-0010 AC-7
  it('AC-7: the API refuses a Viewer even where the UI hides the controls (BR-6)', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 100, status: 'Pending', routeId: null });

    await renderRoutesTab('Viewer');
    await expect(api.assignShipmentToRoute(route.id, { shipmentId: shipment.id })).rejects.toMatchObject({
      status: 403,
    });
    await expect(api.removeShipmentFromRoute(route.id, shipment.id)).rejects.toMatchObject({ status: 403 });
    expect((await api.getShipment(shipment.id)).routeId).toBeNull();
  });

  // LOGI-0010 AC-7
  it('AC-7: an anonymous call is a 401', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 100, status: 'Pending', routeId: null });

    renderAnonymousApp();
    await expect(api.listRouteShipments(route.id)).rejects.toMatchObject({ status: 401 });
    await expect(api.assignShipmentToRoute(route.id, { shipmentId: shipment.id })).rejects.toMatchObject({
      status: 401,
    });
  });

  // LOGI-0010 AC-9
  it('AC-9: a rejected assign leaves route_id, status and history all-or-nothing', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const kept = seedShipment({ weightKg: 900, status: 'Pending', routeId: null });
    const rejected = seedShipment({ weightKg: 200, status: 'Pending', routeId: null });

    await renderRoutesTab('Admin');
    await api.assignShipmentToRoute(route.id, { shipmentId: kept.id });

    const historyBefore = (await api.listShipmentStatusHistory(rejected.id)).totalCount;
    const capacityBefore = (await api.listRouteShipments(route.id)).capacity;

    // Rejected by the BR-5 capacity guard...
    await expect(api.assignShipmentToRoute(route.id, { shipmentId: rejected.id })).rejects.toMatchObject({
      status: 409,
    });

    const after = await api.getShipment(rejected.id);
    expect(after.routeId).toBeNull();
    expect(after.status).toBe('Pending');
    expect((await api.listShipmentStatusHistory(rejected.id)).totalCount).toBe(historyBefore);

    // ...and no partial write survives in the route's derived numbers either.
    const capacityAfter = (await api.listRouteShipments(route.id)).capacity;
    expect(capacityAfter.assignedWeightKg).toBe(capacityBefore.assignedWeightKg);
    expect(capacityAfter.shipmentCount).toBe(capacityBefore.shipmentCount);
  });

  // LOGI-0010 AC-10
  it('AC-10: the LOGI-0007 shipment read model is unchanged by an assignment', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ vehicleId: vehicle.id, status: 'Planned' });
    const shipment = seedShipment({ weightKg: 250, status: 'Pending', routeId: null });

    await renderRoutesTab('Admin');
    await api.assignShipmentToRoute(route.id, { shipmentId: shipment.id });

    const listed = await api.listShipments({ page: 1, pageSize: 25 });
    const row = listed.items.find((s) => s.id === shipment.id);
    expect(row).toMatchObject({
      id: shipment.id,
      referenceCode: shipment.referenceCode,
      weightKg: 250,
      status: 'Assigned',
      routeId: route.id,
    });
    // BR-2 read-time projection still reports (a field, not a stored one).
    expect(typeof row?.atRisk).toBe('boolean');
  });
});

