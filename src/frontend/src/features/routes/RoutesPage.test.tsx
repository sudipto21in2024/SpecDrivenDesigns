import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, api } from '../../api/client';
import type { RouteUpdateInput } from '../../api/client';
import {
  driversDb,
  routesDb,
  seedDriver,
  seedRoute,
  seedShipment,
  seedVehicle,
  shipmentsDb,
  vehiclesDb,
} from '../../mocks/handlers';
import { renderAnonymousApp, renderAppAs, resetMocks } from '../../test/renderApp';
import { server } from '../../test/setup';

beforeEach(() => {
  resetMocks();
});

/**
 * Renders the app as `role` and opens the Routes tab. Every authenticated role may read routes
 * (the Driver is scoped to their own rows by the mock/server, not by hiding the tab), so unlike
 * the shipments suite this helper is a plain "click the tab".
 */
async function renderRoutesTab(role: 'Admin' | 'Dispatcher' | 'Viewer' | 'Driver' = 'Admin') {
  const user = userEvent.setup();
  renderAppAs(role);
  await user.click(await screen.findByTestId('tab-routes'));
  return user;
}

/** The create dialog (accessible name from its DialogTitle) — keeps dialog controls apart from page filters. */
function createDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Create route' });
}

/** Cells of a body row, in column order — queried as DOM nodes (the MUI table markup is presentational). */
function cellsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll('td'));
}

/** The body row whose text contains `text`. */
function rowFor(text: string): HTMLElement {
  const cell = screen.getByText(text);
  const row = cell.closest('tr');
  if (row === null) throw new Error(`No table row for '${text}'`);
  return row;
}

/** Asserts a rejected request is an ApiError and hands it back for status/field assertions. */
async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('Expected the request to fail, but it succeeded.');
}

/** The RFC 7807 body the API returns for 400s (`problem()` in the mocks) — used for forced server errors. */
function problemBody(errors: Record<string, string[]>) {
  return {
    type: 'https://logiflow.dev/errors/validation',
    title: 'Validation failed',
    status: 400,
    detail: 'One or more validation errors occurred.',
    errors,
    traceId: 'test',
  };
}

/** The contract-shaped create body, so each test only overrides the field under test. */
const CREATABLE = {
  name: 'North loop',
  plannedStart: '2026-10-01T08:00:00Z',
  plannedEnd: '2026-10-01T16:00:00Z',
} as const;

/** Opens the create dialog and fills it; vehicle/driver are only picked when named. */
async function fillCreateForm(
  user: ReturnType<typeof userEvent.setup>,
  fields: {
    name: string;
    start: string;
    end: string;
    vehiclePlate?: string;
    driverName?: string;
  },
) {
  await user.click(screen.getByTestId('new-route'));
  const dialog = createDialog();
  await user.type(within(dialog).getByLabelText('Route name'), fields.name);
  await user.type(within(dialog).getByLabelText('Planned start'), fields.start);
  await user.type(within(dialog).getByLabelText('Planned end'), fields.end);
  if (fields.vehiclePlate != null) {
    // Regex name: MUI composes the accessible name from the InputLabel *and* the selected display
    // value, so it is only ever a prefix of "Vehicle".
    await user.click(within(dialog).getByRole('combobox', { name: /Vehicle/ }));
    await user.click(await screen.findByRole('option', { name: fields.vehiclePlate }));
  }
  if (fields.driverName != null) {
    await user.click(within(dialog).getByRole('combobox', { name: /Driver/ }));
    await user.click(await screen.findByRole('option', { name: fields.driverName }));
  }
}

describe('RoutesPage (LOGI-0009)', () => {
  it('AC-1: a Dispatcher creates an assigned route, which reads back and touches no shipment', async () => {
    const vehicle = seedVehicle({ plateNumber: 'RT-1001-A' });
    const driver = seedDriver({ fullName: 'Dana Driver' });
    const shipment = seedShipment({ destinationAddress: 'Untouched 1' });
    const user = await renderRoutesTab('Dispatcher');

    await fillCreateForm(user, {
      name: CREATABLE.name,
      start: CREATABLE.plannedStart,
      end: CREATABLE.plannedEnd,
      vehiclePlate: 'RT-1001-A',
      driverName: 'Dana Driver',
    });
    await user.click(screen.getByTestId('route-submit'));

    // AC-1: the 201 read-back is surfaced and the row appears.
    expect(await screen.findByText("Route 'North loop' created")).toBeInTheDocument();

    const cells = cellsOf(await waitFor(() => rowFor('North loop')));
    expect(cells[0]).toHaveTextContent('North loop');
    expect(cells[1]).toHaveTextContent('2026-10-01T08:00:00.000Z');
    expect(cells[2]).toHaveTextContent('2026-10-01T16:00:00.000Z');
    expect(cells[3]).toHaveTextContent('RT-1001-A');
    expect(cells[4]).toHaveTextContent('Dana Driver');
    expect(cells[5]).toHaveTextContent('Planned'); // status is never client-supplied (AC-10)

    // GET /routes/{id} reads back the same values (AC-1).
    const created = routesDb[0];
    expect(await api.getRoute(created.id)).toMatchObject({
      name: 'North loop',
      plannedStart: '2026-10-01T08:00:00.000Z',
      plannedEnd: '2026-10-01T16:00:00.000Z',
      status: 'Planned',
      vehicleId: vehicle.id,
      driverId: driver.id,
    });

    // …and creating a route never moves a shipment (shipment→route is LOGI-0010).
    expect(shipmentsDb).toHaveLength(1);
    expect(shipmentsDb[0].routeId).toBeNull();
    expect(shipmentsDb[0].status).toBe(shipment.status);
  });

  it('AC-2: a route is created unassigned — vehicleId and driverId come back null', async () => {
    const user = await renderRoutesTab('Dispatcher');

    await fillCreateForm(user, {
      name: 'Spare run',
      start: '2026-10-02T08:00:00Z',
      end: '2026-10-02T16:00:00Z',
    });
    await user.click(screen.getByTestId('route-submit'));

    const cells = cellsOf(await waitFor(() => rowFor('Spare run')));
    expect(cells[3]).toHaveTextContent('Unassigned');
    expect(cells[4]).toHaveTextContent('Unassigned');
    expect(routesDb[0].vehicleId).toBeNull();
    expect(routesDb[0].driverId).toBeNull();
  });

  it('AC-2: an unassigned route is assigned vehicle+driver through the edit dialog', async () => {
    seedVehicle({ plateNumber: 'RT-2002-B' });
    seedDriver({ fullName: 'Ravi Rana' });
    seedRoute({ name: 'Spare run' });
    const user = await renderRoutesTab('Dispatcher');

    // findByRole rather than getByRole: after a modal closes it stays mounted through its exit
    // transition, during which the page behind it is aria-hidden and so invisible to role queries.
    await user.click(await screen.findByRole('button', { name: 'Edit Spare run' }));
    const edit = await screen.findByRole('dialog', { name: 'Edit route' });
    await user.click(within(edit).getByRole('combobox', { name: /Vehicle/ }));
    await user.click(await screen.findByRole('option', { name: 'RT-2002-B' }));
    await user.click(within(edit).getByRole('combobox', { name: /Driver/ }));
    await user.click(await screen.findByRole('option', { name: 'Ravi Rana' }));
    await user.click(screen.getByTestId('route-save'));

    expect(await screen.findByText("Route 'Spare run' updated")).toBeInTheDocument();
    const cells = cellsOf(await waitFor(() => rowFor('Spare run')));
    expect(cells[3]).toHaveTextContent('RT-2002-B');
    expect(cells[4]).toHaveTextContent('Ravi Rana');
    expect(routesDb[0].vehicleId).not.toBeNull();
    expect(routesDb[0].driverId).not.toBeNull();
  });

  it('AC-2: an explicit null unassigns the vehicle while keeping the driver', async () => {
    const vehicle = seedVehicle({ plateNumber: 'RT-2002-B' });
    const driver = seedDriver({ fullName: 'Ravi Rana' });
    seedRoute({ name: 'Spare run', vehicleId: vehicle.id, driverId: driver.id });
    const user = await renderRoutesTab('Dispatcher');

    await user.click(await screen.findByRole('button', { name: 'Edit Spare run' }));
    const edit = await screen.findByRole('dialog', { name: 'Edit route' });
    // The dialog pre-fills from GET /routes/{id}, so the current assignment is what is shown.
    await waitFor(() =>
      expect(within(edit).getByRole('combobox', { name: /Vehicle/ })).toHaveTextContent(
        'RT-2002-B',
      ),
    );
    await user.click(within(edit).getByRole('combobox', { name: /Vehicle/ }));
    await user.click(await screen.findByRole('option', { name: 'Unassigned' }));
    await user.click(screen.getByTestId('route-save'));

    await waitFor(() => {
      const cells = cellsOf(rowFor('Spare run'));
      expect(cells[3]).toHaveTextContent('Unassigned');
      expect(cells[4]).toHaveTextContent('Ravi Rana'); // the driver is kept
    });
    expect(routesDb[0].vehicleId).toBeNull();
    expect(routesDb[0].driverId).toBe(driver.id);
  });
});

describe('RoutesPage validation (LOGI-0009 AC-3)', () => {
  it('AC-3: the API rejects an invalid create with field-keyed 400s and writes nothing', async () => {
    renderAppAs('Dispatcher');

    const blankName = await expectApiError(api.createRoute({ ...CREATABLE, name: '   ' }));
    expect(blankName.status).toBe(400);
    expect(Object.keys(blankName.fieldErrors)).toEqual(['name']);

    const longName = await expectApiError(api.createRoute({ ...CREATABLE, name: 'x'.repeat(201) }));
    expect(longName.fieldErrors.name).toBeDefined();

    // A missing, unparseable or inverted window is a field-keyed 400, not a 404/409.
    const missingWindow = await expectApiError(
      api.createRoute({ name: 'No window', plannedStart: '', plannedEnd: '' }),
    );
    expect(missingWindow.fieldErrors.plannedStart).toBeDefined();
    expect(missingWindow.fieldErrors.plannedEnd).toBeDefined();

    const unparseable = await expectApiError(
      api.createRoute({ ...CREATABLE, plannedEnd: 'next Tuesday' }),
    );
    expect(unparseable.fieldErrors.plannedEnd).toBeDefined();

    const inverted = await expectApiError(
      api.createRoute({ ...CREATABLE, plannedEnd: '2026-10-01T07:00:00Z' }),
    );
    expect(inverted.fieldErrors.plannedEnd).toBeDefined();

    expect(routesDb).toHaveLength(0);
  });

  it('AC-3: the API rejects malformed assignments and an empty PATCH body, writing nothing', async () => {
    const route = seedRoute({ name: 'Guarded' });
    renderAppAs('Dispatcher');
    const before = JSON.stringify(routesDb[0]);

    for (const vehicleId of [0, -1, 'abc' as unknown as number]) {
      const error = await expectApiError(api.updateRoute(route.id, { vehicleId }));
      expect(error.status).toBe(400);
      expect(Object.keys(error.fieldErrors)).toEqual(['vehicleId']);
    }

    const badDriver = await expectApiError(api.updateRoute(route.id, { driverId: 0 }));
    expect(badDriver.status).toBe(400);
    expect(Object.keys(badDriver.fieldErrors)).toEqual(['driverId']);

    const empty = await expectApiError(api.updateRoute(route.id, {}));
    expect(empty.status).toBe(400);
    expect(Object.keys(empty.fieldErrors)).toEqual(['body']);

    // Every rejection above left the row byte-identical.
    expect(JSON.stringify(routesDb[0])).toBe(before);
  });

  it('AC-3: the dialog blocks a blank name and an inverted window before sending', async () => {
    const user = await renderRoutesTab('Admin');

    await user.click(screen.getByTestId('new-route'));
    await user.click(screen.getByTestId('route-submit'));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(await screen.findByText('Planned start is required')).toBeInTheDocument();
    expect(await screen.findByText('Planned end is required')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Route name'), 'Bad window');
    await user.type(screen.getByLabelText('Planned start'), '2026-10-01T16:00:00Z');
    await user.type(screen.getByLabelText('Planned end'), '2026-10-01T08:00:00Z');
    await user.click(screen.getByTestId('route-submit'));

    expect(await screen.findByText('Planned end must be after planned start')).toBeInTheDocument();
    expect(createDialog()).toBeInTheDocument();
    expect(routesDb).toHaveLength(0);
  });

  it('AC-3: a server field error maps back onto the dialog field', async () => {
    // The dialog mirrors the server validator, so a server-only 400 has to be forced — this
    // asserts the field backstop rather than the happy path.
    server.use(
      http.post('/api/v1/routes', () =>
        HttpResponse.json(problemBody({ plannedStart: ['Planned start must be a valid date-time'] }), {
          status: 400,
        }),
      ),
    );
    const user = await renderRoutesTab('Admin');

    await fillCreateForm(user, {
      name: 'Server guarded',
      start: CREATABLE.plannedStart,
      end: CREATABLE.plannedEnd,
    });
    await user.click(screen.getByTestId('route-submit'));

    expect(await screen.findByText('Planned start must be a valid date-time')).toBeInTheDocument();
    expect(createDialog()).toBeInTheDocument();
    expect(routesDb).toHaveLength(0);
  });
});


describe('Routes read/write guards (LOGI-0009 AC-4..AC-6)', () => {
  it('AC-4: unknown vehicle/driver and unknown route respond 404 without writing', async () => {
    seedVehicle({ plateNumber: 'RT-4004-D' });
    seedDriver({ fullName: 'Ok Driver' });
    renderAppAs('Dispatcher');

    const ghostVehicle = await expectApiError(
      api.createRoute({ ...CREATABLE, name: 'Ghost vehicle', vehicleId: 999_999 }),
    );
    expect(ghostVehicle.status).toBe(404);

    const ghostDriver = await expectApiError(
      api.createRoute({ ...CREATABLE, name: 'Ghost driver', driverId: 999_999 }),
    );
    expect(ghostDriver.status).toBe(404);
    expect(routesDb).toHaveLength(0);

    // A dangling FK on PATCH leaves the row byte-identical (AC-4).
    const route = seedRoute({ name: 'Stable' });
    const before = JSON.stringify(routesDb.find((r) => r.id === route.id));
    const dangling = await expectApiError(api.updateRoute(route.id, { vehicleId: 999_999 }));
    expect(dangling.status).toBe(404);
    expect(JSON.stringify(routesDb.find((r) => r.id === route.id))).toBe(before);

    // An unknown route id is a 404 on both the read and the write, and writes nothing.
    expect((await expectApiError(api.getRoute(999_999))).status).toBe(404);
    expect((await expectApiError(api.updateRoute(999_999, { name: 'Nope' }))).status).toBe(404);
    expect(routesDb).toHaveLength(1);
  });

  it('AC-5: overlapping windows double-book with 409 and the detail names the conflict', async () => {
    const vehicle = seedVehicle({ plateNumber: 'RT-5005-E' });
    const driver = seedDriver({ fullName: 'Busy Driver' });
    seedRoute({
      name: 'Morning loop',
      plannedStart: '2026-10-01T08:00:00Z',
      plannedEnd: '2026-10-01T16:00:00Z',
      vehicleId: vehicle.id,
    });
    renderAppAs('Dispatcher');

    const overlap = await expectApiError(
      api.createRoute({
        ...CREATABLE,
        name: 'Vehicle clash',
        plannedStart: '2026-10-01T12:00:00Z',
        plannedEnd: '2026-10-01T20:00:00Z',
        vehicleId: vehicle.id,
      }),
    );
    expect(overlap.status).toBe(409);
    expect(overlap.problem.detail).toContain(`Vehicle with id '${vehicle.id}'`);
    expect(routesDb).toHaveLength(1);

    // The same guard applies to a PATCH (assign the driver onto an overlapping window).
    const target = seedRoute({
      name: 'Afternoon loop',
      plannedStart: '2026-10-01T08:00:00Z',
      plannedEnd: '2026-10-01T16:00:00Z',
    });
    const busy = seedRoute({
      name: 'Evening loop',
      plannedStart: '2026-10-01T12:00:00Z',
      plannedEnd: '2026-10-01T20:00:00Z',
      driverId: driver.id,
    });
    const before = JSON.stringify(routesDb.find((r) => r.id === target.id));
    const patchConflict = await expectApiError(api.updateRoute(target.id, { driverId: driver.id }));
    expect(patchConflict.status).toBe(409);
    expect(patchConflict.problem.detail).toContain(`Driver with id '${driver.id}'`);
    expect(JSON.stringify(routesDb.find((r) => r.id === target.id))).toBe(before);

    // A window that merely touches at the boundary is not an overlap (the vehicle's
    // 08:00-16:00 loop and a 16:00-20:00 run share only the instant 16:00)…
    const touching = await api.createRoute({
      ...CREATABLE,
      name: 'Night run',
      plannedStart: '2026-10-01T16:00:00Z',
      plannedEnd: '2026-10-01T20:00:00Z',
      vehicleId: vehicle.id,
    });
    expect(touching.status).toBe('Planned');
    // …and the conflicted driver's own route was never mutated by the rejected PATCH.
    expect(busy.driverId).toBe(driver.id);
  });

  it('AC-5: a terminal route never conflicts', async () => {
    const vehicle = seedVehicle({ plateNumber: 'RT-5006-E' });
    seedRoute({
      name: 'Closed loop',
      status: 'Completed',
      plannedStart: '2026-10-02T08:00:00Z',
      plannedEnd: '2026-10-02T16:00:00Z',
      vehicleId: vehicle.id,
    });
    renderAppAs('Dispatcher');

    const reused = await api.createRoute({
      ...CREATABLE,
      name: 'Reused window',
      plannedStart: '2026-10-02T08:00:00Z',
      plannedEnd: '2026-10-02T16:00:00Z',
      vehicleId: vehicle.id,
    });
    expect(reused.status).toBe('Planned');
    expect(routesDb).toHaveLength(2);
  });
});


describe('Routes assignment UI (LOGI-0009 AC-5, AC-6)', () => {
  it('AC-5: the create dialog surfaces the conflict detail and adds no row', async () => {
    const vehicle = seedVehicle({ plateNumber: 'RT-5005-E' });
    seedRoute({
      name: 'Morning loop',
      plannedStart: '2026-10-01T08:00:00Z',
      plannedEnd: '2026-10-01T16:00:00Z',
      vehicleId: vehicle.id,
    });
    const user = await renderRoutesTab('Dispatcher');

    await fillCreateForm(user, {
      name: 'Vehicle clash',
      start: '2026-10-01T12:00:00Z',
      end: '2026-10-01T20:00:00Z',
      vehiclePlate: 'RT-5005-E',
    });
    await user.click(screen.getByTestId('route-submit'));

    // The 409's detail names the conflicting vehicle and the dialog stays open (AC-5).
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Vehicle with id '${vehicle.id}'`,
    );
    expect(createDialog()).toBeInTheDocument();
    expect(routesDb).toHaveLength(1);
    expect(screen.queryByText('Vehicle clash')).not.toBeInTheDocument();
  });

  it('AC-6: assignment and rename are Planned-only, with a 409 naming the required status', async () => {
    const vehicle = seedVehicle({ plateNumber: 'RT-6006-F' });
    renderAppAs('Dispatcher');

    const inProgress = seedRoute({ name: 'Rolling', status: 'InProgress' });
    const before = JSON.stringify(routesDb.find((r) => r.id === inProgress.id));
    const blocked = await expectApiError(api.updateRoute(inProgress.id, { vehicleId: vehicle.id }));
    expect(blocked.status).toBe(409);
    expect(blocked.problem.detail).toContain('Planned');
    expect(JSON.stringify(routesDb.find((r) => r.id === inProgress.id))).toBe(before);

    // Terminal statuses behave the same: nothing is written.
    for (const status of ['Completed', 'Cancelled'] as const) {
      const terminal = seedRoute({ name: `Terminal ${status}`, status });
      const terminalBefore = JSON.stringify(routesDb.find((r) => r.id === terminal.id));
      const terminalBlocked = await expectApiError(api.updateRoute(terminal.id, { name: 'Renamed' }));
      expect(terminalBlocked.status).toBe(409);
      expect(JSON.stringify(routesDb.find((r) => r.id === terminal.id))).toBe(terminalBefore);
    }
  });

  it('AC-6: the UI offers Edit only on Planned routes', async () => {
    seedRoute({ name: 'Planned route', status: 'Planned' });
    seedRoute({ name: 'Rolling route', status: 'InProgress' });
    await renderRoutesTab('Admin');

    expect(await screen.findByRole('button', { name: 'Edit Planned route' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Rolling route' })).not.toBeInTheDocument();
  });
});


describe('Routes authorization (LOGI-0009 AC-7)', () => {
  const driverIdentity = 3; // mockUsers' Driver account (raj@logiflow.dev)

  it('AC-7: every /routes call without a token is 401', async () => {
    renderAnonymousApp();

    expect((await expectApiError(api.listRoutes())).status).toBe(401);
    expect((await expectApiError(api.getRoute(1))).status).toBe(401);
    expect((await expectApiError(api.createRoute(CREATABLE))).status).toBe(401);
    expect((await expectApiError(api.updateRoute(1, { name: 'Nope' }))).status).toBe(401);
    expect(routesDb).toHaveLength(0);
  });

  it('AC-7: a Driver lists own routes only, is 403 on another driver, and cannot write', async () => {
    const own = seedDriver({ fullName: 'Own Routes', userId: driverIdentity });
    const others = seedDriver({ fullName: 'Other Driver' });
    const mine = seedRoute({ name: 'Mine', driverId: own.id });
    const theirs = seedRoute({ name: 'Theirs', driverId: others.id });
    renderAppAs('Driver');

    const list = await api.listRoutes();
    expect(list.items.map((route) => route.id)).toEqual([mine.id]);

    expect((await expectApiError(api.getRoute(theirs.id))).status).toBe(403);
    expect((await expectApiError(api.createRoute(CREATABLE))).status).toBe(403);
    expect((await expectApiError(api.updateRoute(mine.id, { name: 'Renamed' }))).status).toBe(403);
    expect(routesDb.find((route) => route.id === mine.id)?.name).toBe('Mine');
  });

  it('AC-7: a Driver with no linked driver row sees an empty page, not the fleet', async () => {
    seedRoute({ name: 'Someone else route' });
    renderAppAs('Driver');

    const list = await api.listRoutes();
    expect(list.items).toHaveLength(0);
    expect(list.totalCount).toBe(0);
  });

  it('AC-7: a Viewer may read list and detail but every write is 403', async () => {
    seedRoute({ name: 'Viewable' });
    renderAppAs('Viewer');

    expect((await api.listRoutes()).totalCount).toBe(1);
    expect((await api.getRoute(routesDb[0].id)).name).toBe('Viewable');

    const rejected = await expectApiError(api.createRoute(CREATABLE));
    expect(rejected.status).toBe(403);
    const patch = await expectApiError(api.updateRoute(routesDb[0].id, { name: 'Renamed' }));
    expect(patch.status).toBe(403);

    // Every rejected call wrote nothing.
    expect(routesDb).toHaveLength(1);
    expect(routesDb[0].name).toBe('Viewable');
  });

  it('AC-7: Admin and Dispatcher may create, assign and read', async () => {
    const vehicle = seedVehicle({ plateNumber: 'RT-7007-G' });
    renderAppAs('Admin');

    const created = await api.createRoute({ ...CREATABLE, name: 'Admin made' });
    expect(created.status).toBe('Planned');
    const assigned = await api.updateRoute(created.id, { vehicleId: vehicle.id });
    expect(assigned.vehicleId).toBe(vehicle.id);
    expect((await api.listRoutes()).totalCount).toBe(1);

    renderAppAs('Dispatcher');
    const dispatcherCreated = await api.createRoute({
      ...CREATABLE,
      name: 'Dispatcher made',
      plannedStart: '2026-10-07T08:00:00Z',
      plannedEnd: '2026-10-07T16:00:00Z',
    });
    expect(dispatcherCreated.status).toBe('Planned');
    expect((await api.listRoutes()).totalCount).toBe(2);
  });

  it('AC-7: a Driver sees the Routes tab, own routes only, and no write affordances', async () => {
    const own = seedDriver({ fullName: 'Own Routes', userId: driverIdentity });
    const other = seedDriver({ fullName: 'Other Driver' });
    seedRoute({ name: 'Mine list', driverId: own.id });
    seedRoute({ name: 'Theirs list', driverId: other.id });

    await renderRoutesTab('Driver');

    expect(await screen.findByText('Mine list')).toBeInTheDocument();
    expect(screen.queryByText('Theirs list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-route')).not.toBeInTheDocument();
    expect(screen.queryByTestId('routes-actions-header')).not.toBeInTheDocument();
  });

  it('AC-7: a Viewer sees the list with no New or Edit affordances', async () => {
    seedRoute({ name: 'Viewer visible' });
    await renderRoutesTab('Viewer');

    expect(await screen.findByText('Viewer visible')).toBeInTheDocument();
    expect(screen.queryByTestId('new-route')).not.toBeInTheDocument();
    expect(screen.queryByTestId('routes-actions-header')).not.toBeInTheDocument();
  });
});


describe('Routes list & data rules (LOGI-0009 AC-8..AC-10)', () => {
  it('AC-8: a referenced vehicle/driver cannot be deleted, an unreferenced one still can', async () => {
    const referencedVehicle = seedVehicle({ plateNumber: 'RT-8008-H' });
    const referencedDriver = seedDriver({ fullName: 'Referenced Driver' });
    const freeVehicle = seedVehicle({ plateNumber: 'RT-8009-H' });
    const freeDriver = seedDriver({ fullName: 'Spare Driver' });
    seedRoute({ name: 'Holder', vehicleId: referencedVehicle.id, driverId: referencedDriver.id });
    renderAppAs('Admin');

    const vehicleBlocked = await expectApiError(api.deleteVehicle(referencedVehicle.id));
    expect(vehicleBlocked.status).toBe(409);
    const driverBlocked = await expectApiError(api.deleteDriver(referencedDriver.id));
    expect(driverBlocked.status).toBe(409);

    // The rejected deletes left both rows in place (AC-8: "row unchanged").
    expect(vehiclesDb.some((v) => v.id === referencedVehicle.id)).toBe(true);
    expect(driversDb.some((d) => d.id === referencedDriver.id)).toBe(true);

    await expect(api.deleteVehicle(freeVehicle.id)).resolves.toBeUndefined();
    await expect(api.deleteDriver(freeDriver.id)).resolves.toBeUndefined();
    expect(vehiclesDb.some((v) => v.id === freeVehicle.id)).toBe(false);
    expect(driversDb.some((d) => d.id === freeDriver.id)).toBe(false);
  });

  it('AC-9: the list is paged, filters combine with AND, and an unknown status is a 400', async () => {
    const vehicle = seedVehicle({ plateNumber: 'RT-9009-I' });
    const driver = seedDriver({ fullName: 'Filter Driver' });
    // Distinct createdAt values so the default `-createdAt` sort is observable.
    for (const [i, leg] of ['A', 'B', 'C'].entries()) {
      seedRoute({
        name: `North leg ${leg}`,
        vehicleId: vehicle.id,
        createdAt: new Date(Date.UTC(2026, 9, 1, 8 + i, 0, 0)).toISOString(),
      });
    }
    seedRoute({
      name: 'South leg',
      status: 'Completed',
      driverId: driver.id,
      createdAt: new Date(Date.UTC(2026, 9, 1, 6, 0, 0)).toISOString(),
    });
    renderAppAs('Admin');

    // Paged envelope: page/pageSize in, totalCount/totalPages over every match (AC-9).
    const page = await api.listRoutes({ page: 1, pageSize: 2 });
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(2);
    expect(page.totalCount).toBe(4);
    expect(page.totalPages).toBe(2);
    expect(page.items).toHaveLength(2);

    // q is a case-insensitive name contains; filters AND together.
    const anded = await api.listRoutes({ q: 'north', status: 'Planned', vehicleId: vehicle.id });
    expect(anded.totalCount).toBe(3);
    expect(anded.items.every((r) => r.name.startsWith('North') && r.status === 'Planned')).toBe(true);
    expect((await api.listRoutes({ q: 'LEG' })).totalCount).toBe(4);
    expect((await api.listRoutes({ driverId: driver.id })).items.map((r) => r.name)).toEqual([
      'South leg',
    ]);

    // Sort defaults to -createdAt: newest first (and the oldest row last).
    const all = await api.listRoutes({ pageSize: 100 });
    expect(all.items.map((r) => r.name)).toEqual([
      'North leg C',
      'North leg B',
      'North leg A',
      'South leg',
    ]);

    const badStatus = await expectApiError(api.listRoutes({ status: 'Flying' as never }));
    expect(badStatus.status).toBe(400);
    expect(badStatus.fieldErrors.status).toBeDefined();
    const badPage = await expectApiError(api.listRoutes({ page: 0 }));
    expect(badPage.fieldErrors.page).toBeDefined();
    const badPageSize = await expectApiError(api.listRoutes({ pageSize: 101 }));
    expect(badPageSize.fieldErrors.pageSize).toBeDefined();
  });

  it('AC-9: the page renders the list and narrows it with the status filter', async () => {
    seedRoute({ name: 'Planned North', status: 'Planned' });
    seedRoute({ name: 'Done South', status: 'Completed' });
    const user = await renderRoutesTab('Admin');

    expect(await screen.findByText('Planned North')).toBeInTheDocument();
    expect(screen.getByText('Done South')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: /Status/ }));
    await user.click(await screen.findByRole('option', { name: 'Planned' }));

    await waitFor(() => expect(screen.queryByText('Done South')).not.toBeInTheDocument());
    expect(screen.getByText('Planned North')).toBeInTheDocument();
  });

  it('AC-10: server-owned fields are 400s and no shipment row is ever written', async () => {
    const shipment = seedShipment({ destinationAddress: 'Untouched AC-10' });
    renderAppAs('Admin');

    // The UI never sends these keys, so they have to be forced through the client call.
    const create = await expectApiError(
      api.createRoute({
        ...CREATABLE,
        name: 'Owned fields',
        id: 5,
        status: 'Completed',
        createdAt: '2026-10-06T00:00:00Z',
      } as unknown as Parameters<typeof api.createRoute>[0]),
    );
    expect(create.status).toBe(400);
    expect(Object.keys(create.fieldErrors).sort()).toEqual(['createdAt', 'id', 'status']);
    expect(routesDb).toHaveLength(0);

    const route = seedRoute({ name: 'Owned patch' });
    const patch = await expectApiError(
      api.updateRoute(route.id, { status: 'Completed' } as unknown as RouteUpdateInput),
    );
    expect(patch.status).toBe(400);
    expect(patch.fieldErrors.status).toBeDefined();
    expect(routesDb.find((r) => r.id === route.id)?.status).toBe('Planned');

    // Across every rejected write: no shipment.routeId was set and no shipment moved.
    expect(shipmentsDb).toHaveLength(1);
    expect(shipmentsDb[0].routeId).toBeNull();
    expect(shipmentsDb[0].status).toBe(shipment.status);
  });
});

