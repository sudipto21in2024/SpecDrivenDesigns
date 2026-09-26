import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, api } from '../../api/client';
import { seedShipment, seedWarehouse, shipmentsDb } from '../../mocks/handlers';
import { renderAppAs, resetMocks } from '../../test/renderApp';
import { server } from '../../test/setup';

beforeEach(() => {
  resetMocks();
});

/**
 * Renders the app as `role` and opens the Shipments tab. The tab only exists for roles that may read
 * shipments (spec §2 excludes the Driver persona — AC-10), so the Driver role is asserted without
 * switching tabs, exactly as the DriversPage suite does for its own exclusion.
 */
async function renderShipmentsTab(role: 'Admin' | 'Dispatcher' | 'Viewer' = 'Admin') {
  const user = userEvent.setup();
  renderAppAs(role);
  await user.click(await screen.findByTestId('tab-shipments'));
  return user;
}

/** The create dialog (accessible name from its DialogTitle) — keeps dialog controls apart from the page filters. */
function createDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Create shipment' });
}

/** Cells of a body row, in column order — queried as DOM nodes (the MUI table markup is presentational). */
function cellsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll('td'));
}

/** Table body rows (header excluded), in render order. */
function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table', { name: 'Shipments table' });
  return Array.from(table.querySelectorAll('tbody tr'));
}

/** Cell text of one column across every body row — 1 status, 3 origin, 4 destination, 6 SLA due, 8 created. */
function column(index: number): (string | null)[] {
  return bodyRows().map((row) => cellsOf(row)[index]?.textContent ?? null);
}

/** Returns the table row containing `text` so cell-level assertions stay scoped. */
function rowFor(text: string): HTMLElement {
  return screen.getByText(text).closest('tr')!;
}

/** Whole-second ISO8601 UTC instant `offsetMs` from now — the precision the API works in (spec §8). */
function iso(offsetMs: number): string {
  return new Date(Math.floor((Date.now() + offsetMs) / 1000) * 1000).toISOString();
}

const HOUR = 3_600_000;

/**
 * Awaits a request that must fail and returns the `ApiError` the client throws, so assertions can
 * read `status` / `problem` / `fieldErrors` without fighting the union the `.catch` produces.
 * Fails the test if the call unexpectedly succeeds.
 */
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

/** Opens the dialog and fills a valid create body (origin warehouse picked from the seeded list). */
async function fillCreateForm(
  user: ReturnType<typeof userEvent.setup>,
  { destination, weight, priority }: { destination: string; weight: string; priority?: string },
) {
  await user.click(screen.getByTestId('new-shipment'));
  await user.click(within(createDialog()).getByRole('combobox', { name: 'Origin warehouse' }));
  await user.click(await screen.findByRole('option', { name: 'Central DC' }));
  await user.type(screen.getByLabelText('Destination address'), destination);
  await user.type(screen.getByLabelText('Weight in kilograms'), weight);
  if (priority != null) {
    await user.click(within(createDialog()).getByRole('combobox', { name: 'Priority' }));
    await user.click(await screen.findByRole('option', { name: priority }));
  }
}

describe('ShipmentsPage (LOGI-0007)', () => {
  it('AC-1/AC-2/AC-3: a Dispatcher creates a shipment — server-owned code, status and Standard SLA', async () => {
    seedWarehouse();
    const user = await renderShipmentsTab('Dispatcher');

    await fillCreateForm(user, { destination: 'Harbour Way 5, Hamburg', weight: '42' });
    await user.click(screen.getByTestId('shipment-submit'));

    // AC-1: the 201 read-back is surfaced with the server-generated reference code.
    expect(await screen.findByText(/^Shipment SHP-\d{6} created$/)).toBeInTheDocument();

    const row = await waitFor(() => rowFor('Harbour Way 5, Hamburg'));
    const cells = cellsOf(row);
    expect(cells[0].textContent).toMatch(/^SHP-\d{6}$/);
    expect(cells[1]).toHaveTextContent('Pending'); // AC-1: status is never client-supplied
    expect(cells[2]).toHaveTextContent('Standard'); // AC-3/BR-1: priority omitted → Standard
    expect(cells[3]).toHaveTextContent('Central DC'); // origin resolved through the warehouse list
    expect(cells[5]).toHaveTextContent('42');

    // AC-2/BR-1: slaDueAt = server createdAt + 48h, both whole-second UTC instants.
    const createdAt = Date.parse(cells[8].textContent!);
    const slaDueAt = Date.parse(cells[6].textContent!);
    expect(slaDueAt - createdAt).toBe(48 * HOUR);
    expect(Date.now() - createdAt).toBeLessThan(HOUR);
  });

  it('AC-2: an Express shipment gets a 12-hour SLA', async () => {
    seedWarehouse();
    const user = await renderShipmentsTab('Dispatcher');

    await fillCreateForm(user, { destination: 'Express Lane 1, Lyon', weight: '7', priority: 'Express' });
    await user.click(screen.getByTestId('shipment-submit'));

    const row = await waitFor(() => rowFor('Express Lane 1, Lyon'));
    const cells = cellsOf(row);
    expect(cells[2]).toHaveTextContent('Express');
    expect(Date.parse(cells[6].textContent!) - Date.parse(cells[8].textContent!)).toBe(12 * HOUR);
  });

  it('AC-3: a server 400 for an unknown priority surfaces on the priority field', async () => {
    seedWarehouse();
    // The dialog mirrors the server validator, so an unknown priority can only reach the API as a
    // forced 400 — this asserts the field backstop while BR-1 rule 1.7 stays fail-loud server-side.
    server.use(
      http.post('/api/v1/shipments', () =>
        HttpResponse.json(problemBody({ priority: ['Priority must be one of: Standard, Express.'] }), {
          status: 400,
        }),
      ),
    );
    const user = await renderShipmentsTab('Dispatcher');

    await fillCreateForm(user, { destination: 'Bad Priority Rd 1', weight: '5' });
    await user.click(screen.getByTestId('shipment-submit'));

    expect(await screen.findByText('Priority must be one of: Standard, Express.')).toBeInTheDocument();
    // A rejected create is not a completed create: the dialog stays open and no row was added.
    expect(createDialog()).toBeInTheDocument();
    expect(screen.queryByText('Bad Priority Rd 1')).not.toBeInTheDocument();
  });

  it('AC-4: the API rejects an invalid create with field-keyed 400s and writes no row', async () => {
    renderAppAs('Dispatcher');

    const error = await api
      .createShipment({ originWarehouseId: 999_999, destinationAddress: '   ', weightKg: 0, priority: 'Standard' })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(Object.keys(apiError.fieldErrors).sort()).toEqual([
      'destinationAddress',
      'originWarehouseId',
      'weightKg',
    ]);
    // AC-4: an unknown origin is a validation failure, not a missing request resource (spec §7).
    expect(apiError.fieldErrors.originWarehouseId[0]).toMatch(/does not exist/);
    expect(shipmentsDb).toHaveLength(0);
  });

  it('AC-4: server field errors map onto the dialog fields', async () => {
    seedWarehouse();
    server.use(
      http.post('/api/v1/shipments', () =>
        HttpResponse.json(
          problemBody({
            weightKg: ['Weight must be greater than 0'],
            destinationAddress: ['Destination address must be at most 500 characters'],
          }),
          { status: 400 },
        ),
      ),
    );
    const user = await renderShipmentsTab('Dispatcher');

    await fillCreateForm(user, { destination: 'Field Error Ave 9', weight: '3' });
    await user.click(screen.getByTestId('shipment-submit'));

    expect(await screen.findByText('Weight must be greater than 0')).toBeInTheDocument();
    expect(screen.getByText('Destination address must be at most 500 characters')).toBeInTheDocument();
  });

  it('AC-6: the list is paged 25 per page and totalCount spans every match', async () => {
    for (let i = 1; i <= 30; i += 1) {
      seedShipment({ destinationAddress: `Depot ${String(i).padStart(2, '0')}` });
    }
    const user = await renderShipmentsTab();

    await waitFor(() => expect(bodyRows()).toHaveLength(25));
    // AC-6: page defaults to 1 and pageSize to 25, with totalCount counted over all matches.
    expect(await screen.findByText(/1[–-]25 of 30/)).toBeInTheDocument();
    expect(screen.getByText('Depot 30')).toBeInTheDocument(); // default sort -createdAt, id tiebreak

    await user.click(screen.getByRole('button', { name: /next page/i }));

    await waitFor(() => expect(bodyRows()).toHaveLength(5));
    expect(screen.getByText('Depot 01')).toBeInTheDocument();
    expect(screen.queryByText('Depot 30')).not.toBeInTheDocument();
  });

  it('AC-7: filters combine with AND and q is a case-insensitive contains', async () => {
    seedShipment({ destinationAddress: 'Rotterdam Harbour', status: 'Pending' });
    seedShipment({ destinationAddress: 'Rotterdam Harbour', status: 'Assigned' });
    seedShipment({ destinationAddress: 'Utrecht Yard', status: 'Pending' });
    const user = await renderShipmentsTab();

    await waitFor(() => expect(bodyRows()).toHaveLength(3));

    // q matches referenceCode/destinationAddress with contains + case-insensitive semantics (spec §7).
    await user.type(screen.getByLabelText('Search shipments by reference or destination'), 'harbour');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(column(4)).toEqual(['Rotterdam Harbour', 'Rotterdam Harbour']));

    // Adding the status filter narrows the same result set (AND, not OR).
    await user.click(screen.getByLabelText('Filter by status'));
    await user.click(await screen.findByRole('option', { name: 'Assigned' }));
    await waitFor(() => expect(column(4)).toEqual(['Rotterdam Harbour']));
    expect(column(1)).toEqual(['Assigned']);
  });

  it('AC-8: sorting by SLA due date puts nulls last in both directions', async () => {
    seedShipment({ destinationAddress: 'Due Later', slaDueAt: iso(30 * HOUR) });
    seedShipment({ destinationAddress: 'Due Soon', slaDueAt: iso(10 * HOUR) });
    seedShipment({ destinationAddress: 'No Due', slaDueAt: null }); // pre-LOGI-0007 style row
    const user = await renderShipmentsTab();

    await waitFor(() => expect(bodyRows()).toHaveLength(3));

    await user.click(screen.getByLabelText('Sort shipments'));
    await user.click(await screen.findByRole('option', { name: 'Due descending' }));
    await waitFor(() => expect(column(4)).toEqual(['Due Later', 'Due Soon', 'No Due']));

    await user.click(screen.getByLabelText('Sort shipments'));
    await user.click(await screen.findByRole('option', { name: 'Due ascending' }));
    await waitFor(() => expect(column(4)).toEqual(['Due Soon', 'Due Later', 'No Due']));
  });

  it('AC-9: atRisk is a read-time projection and slaRisk filters true/false', async () => {
    seedShipment({ destinationAddress: 'Risk Row', slaDueAt: iso(-HOUR) });
    seedShipment({ destinationAddress: 'Safe Row', slaDueAt: iso(48 * HOUR) });
    seedShipment({ destinationAddress: 'Delivered Risk Row', slaDueAt: iso(-HOUR), status: 'Delivered' });
    const user = await renderShipmentsTab();

    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    // BR-2: only the Pending row past its 2h cutoff is at risk — Delivered rows never are.
    expect(within(rowFor('Risk Row')).getByText('At risk')).toBeInTheDocument();
    expect(within(rowFor('Safe Row')).queryByText('At risk')).not.toBeInTheDocument();
    expect(within(rowFor('Delivered Risk Row')).queryByText('At risk')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Filter by SLA risk'));
    await user.click(await screen.findByRole('option', { name: 'At risk' }));
    await waitFor(() => expect(column(4)).toEqual(['Risk Row']));

    // slaRisk=false is the exact complement of slaRisk=true.
    await user.click(screen.getByLabelText('Filter by SLA risk'));
    await user.click(await screen.findByRole('option', { name: 'OK' }));
    await waitFor(() => expect(column(4)).toEqual(['Delivered Risk Row', 'Safe Row']));
  });

  it('AC-10: a Viewer can read the list but cannot create (no affordance, API 403)', async () => {
    seedShipment({ destinationAddress: 'Viewer Visible Row' });
    await renderShipmentsTab('Viewer');

    expect(await screen.findByText('Viewer Visible Row')).toBeInTheDocument();
    expect(screen.queryByTestId('new-shipment')).not.toBeInTheDocument();

    // Hiding the button is affordance hygiene only — the API is the authority (BR-6).
    const error = await api
      .createShipment({ originWarehouseId: 1, destinationAddress: 'Forged Row', weightKg: 1, priority: 'Standard' })
      .catch((reason: unknown) => reason);
    expect((error as ApiError).status).toBe(403);
    expect(shipmentsDb).toHaveLength(1);
  });

  it('AC-10: an Admin gets the create affordance', async () => {
    await renderShipmentsTab('Admin');

    expect(await screen.findByTestId('new-shipment')).toBeInTheDocument();
  });

  it('AC-10: the Driver role has no Shipments tab at all (own-route scoping is LOGI-0009/0010)', async () => {
    renderAppAs('Driver');

    expect(await screen.findByTestId('tab-warehouses')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-shipments')).not.toBeInTheDocument();
  });
});

describe('ShipmentsPage - edit & cancel row actions (LOGI-0008)', () => {
  /** Opens the edit dialog for a row and returns it (pre-filled from the detail read). */
  async function openEditDialog(user: ReturnType<typeof userEvent.setup>, referenceCode: string) {
    await user.click(within(rowFor(referenceCode)).getByRole('button', { name: `Edit ${referenceCode}` }));
    return screen.getByRole('dialog', { name: 'Edit shipment' });
  }

  it('AC-11: Edit + Cancel on a Pending row, Cancel only on Assigned', async () => {
    const pending = seedShipment({ status: 'Pending' });
    const assigned = seedShipment({ status: 'Assigned' });
    await renderShipmentsTab('Admin');

    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    const pendingRow = rowFor(pending.referenceCode);
    expect(within(pendingRow).getByRole('button', { name: `Edit ${pending.referenceCode}` })).toBeInTheDocument();
    expect(within(pendingRow).getByRole('button', { name: `Cancel ${pending.referenceCode}` })).toBeInTheDocument();
    // AC-11: an Assigned row offers Cancel but not Edit.
    const assignedRow = rowFor(assigned.referenceCode);
    expect(within(assignedRow).getByRole('button', { name: `Cancel ${assigned.referenceCode}` })).toBeInTheDocument();
    expect(within(assignedRow).queryByRole('button', { name: `Edit ${assigned.referenceCode}` })).not.toBeInTheDocument();
  });

  it('AC-11: InTransit, Delayed, Delivered and Cancelled rows offer neither action', async () => {
    const rows = [
      seedShipment({ status: 'InTransit' }),
      seedShipment({ status: 'Delayed' }),
      seedShipment({ status: 'Delivered' }),
      seedShipment({ status: 'Cancelled' }),
    ];
    await renderShipmentsTab('Admin');

    await waitFor(() => expect(bodyRows()).toHaveLength(4));
    for (const shipment of rows) {
      const row = rowFor(shipment.referenceCode);
      expect(within(row).queryByRole('button', { name: `Edit ${shipment.referenceCode}` })).not.toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: `Cancel ${shipment.referenceCode}` })).not.toBeInTheDocument();
    }
  });

  it('AC-11: a Viewer sees no row actions at all', async () => {
    const pending = seedShipment({ status: 'Pending' });
    await renderShipmentsTab('Viewer');

    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    const row = rowFor(pending.referenceCode);
    expect(within(row).queryByRole('button', { name: `Edit ${pending.referenceCode}` })).toBeNull();
    expect(within(row).queryByRole('button', { name: `Cancel ${pending.referenceCode}` })).toBeNull();
  });

  it('AC-6/AC-11: Edit pre-fills from GET /shipments/{id} and saves a PATCH that refreshes the row', async () => {
    seedWarehouse();
    const shipment = seedShipment({ destinationAddress: 'Old Address 1', weightKg: 10 });
    const user = await renderShipmentsTab('Dispatcher');

    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    const dialog = await openEditDialog(user, shipment.referenceCode);

    // AC-6: the dialog is pre-filled from the detail read, not from the row.
    const address = await within(dialog).findByLabelText('Destination address');
    await waitFor(() => expect(address).toHaveValue('Old Address 1'));
    expect(within(dialog).getByLabelText('Weight in kilograms')).toHaveValue(10);

    await user.clear(address);
    await user.type(address, 'New Address 9');
    await user.click(within(dialog).getByTestId('shipment-save'));

    // AC-1: the row reads back the new value and untouched fields are not resent.
    await waitFor(() => expect(screen.getByText('New Address 9')).toBeInTheDocument());
    expect(shipmentsDb[0].destinationAddress).toBe('New Address 9');
    expect(shipmentsDb[0].weightKg).toBe(10);
    expect(shipmentsDb[0].statusHistory).toHaveLength(1); // an edit writes no audit row
  });

  it('AC-1/AC-12: an edit leaves status, priority, slaDueAt and createdAt untouched', async () => {
    const shipment = seedShipment({ priority: 'Express', destinationAddress: 'Immutable Check 1' });
    const before = { ...shipment };
    const user = await renderShipmentsTab('Admin');

    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    const dialog = await openEditDialog(user, shipment.referenceCode);
    const weight = await within(dialog).findByLabelText('Weight in kilograms');
    await user.clear(weight);
    await user.type(weight, '250');
    await user.click(within(dialog).getByTestId('shipment-save'));

    await waitFor(() => expect(screen.getByText('250')).toBeInTheDocument());
    expect(shipmentsDb[0].status).toBe(before.status);
    expect(shipmentsDb[0].priority).toBe('Express');
    expect(shipmentsDb[0].slaDueAt).toBe(before.slaDueAt);
    expect(shipmentsDb[0].createdAt).toBe(before.createdAt);
  });

  it('AC-3: a server 400 for the edited field surfaces on that field and nothing is written', async () => {
    const shipment = seedShipment({ destinationAddress: 'Blanked Address' });
    const user = await renderShipmentsTab('Admin');

    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    const dialog = await openEditDialog(user, shipment.referenceCode);
    const address = await within(dialog).findByLabelText('Destination address');
    // Force the server path: the endpoint answers 400 keyed to destinationAddress.
    server.use(
      http.patch('/api/v1/shipments/:id', () =>
        HttpResponse.json(problemBody({ destinationAddress: ['Destination address is required'] }), { status: 400 }),
      ),
    );
    await user.clear(address);
    await user.type(address, 'Forced');
    await user.click(within(dialog).getByTestId('shipment-save'));

    expect(await within(dialog).findByText('Destination address is required')).toBeInTheDocument();
    expect(shipmentsDb[0].destinationAddress).toBe('Blanked Address');
  });

  it('AC-11: a 409 from the PATCH surfaces a message and refreshes the row', async () => {
    const shipment = seedShipment({ destinationAddress: 'Race Condition 1' });
    const user = await renderShipmentsTab('Admin');

    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    server.use(
      http.patch('/api/v1/shipments/:id', () =>
        HttpResponse.json(
          {
            type: 'https://logiflow.dev/errors/conflict',
            title: 'Conflict',
            status: 409,
            detail: "Shipment is in status 'Assigned' and can no longer be edited. Required status: 'Pending'.",
            traceId: 'test',
          },
          { status: 409 },
        ),
      ),
    );
    const dialog = await openEditDialog(user, shipment.referenceCode);
    const address = await within(dialog).findByLabelText('Destination address');
    await user.clear(address);
    await user.type(address, 'Never Saved');
    await user.click(within(dialog).getByTestId('shipment-save'));

    expect(await screen.findByTestId('snackbar')).toHaveTextContent(/can no longer be edited/);
    expect(screen.getByRole('dialog', { name: 'Edit shipment' })).toBeInTheDocument();
    expect(shipmentsDb[0].destinationAddress).toBe('Race Condition 1');
  });

  it('AC-8/AC-11: Cancel requires a confirmation and then transitions the row to Cancelled', async () => {
    const shipment = seedShipment({ destinationAddress: 'Withdraw Me 1' });
    const user = await renderShipmentsTab('Dispatcher');

    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    await user.click(
      within(rowFor(shipment.referenceCode)).getByRole('button', { name: `Cancel ${shipment.referenceCode}` }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Cancel shipment' });
    await user.type(within(dialog).getByLabelText('Cancellation note'), 'Customer withdrew the order');
    await user.click(within(dialog).getByTestId('confirm-cancel'));

    // AC-8: the row reports Cancelled and the note is in the append-only audit trail.
    await waitFor(() => expect(within(rowFor(shipment.referenceCode)).getByText('Cancelled')).toBeInTheDocument());
    const history = await api.listShipmentStatusHistory(shipment.id);
    const last = history.items[history.items.length - 1];
    expect(last.toStatus).toBe('Cancelled');
    expect(last.fromStatus).toBe('Pending');
    expect(last.note).toBe('Customer withdrew the order');
  });

  it('AC-11: dismissing the cancel confirmation sends no request', async () => {
    const shipment = seedShipment({ destinationAddress: 'Keep Me 1' });
    const user = await renderShipmentsTab('Admin');

    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    await user.click(
      within(rowFor(shipment.referenceCode)).getByRole('button', { name: `Cancel ${shipment.referenceCode}` }),
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Cancel shipment' })).getByRole('button', { name: 'Keep shipment' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cancel shipment' })).not.toBeInTheDocument());
    expect(shipmentsDb[0].status).toBe('Pending');
  });

  it('AC-7: PATCH is Admin/Dispatcher-only — a Viewer gets 403, not a silent no-op', async () => {
    const pending = seedShipment({ status: 'Pending' });
    renderAppAs('Viewer'); // a Viewer may read but not write
    const viewerError = await expectApiError(
      api.updateShipment(pending.id, { destinationAddress: 'Forged' }),
    );
    expect(viewerError.status).toBe(403); // hiding the button is not authorization
    expect(shipmentsDb[0].destinationAddress).toBe('12 Dock Road, Rotterdam');
  });

  it('AC-5: PATCH 404s an unknown shipment id', async () => {
    renderAppAs('Admin');
    const missing = await expectApiError(api.updateShipment(999999, { weightKg: 5 }));
    expect(missing.status).toBe(404);
    expect(shipmentsDb).toHaveLength(0);
  });

  it('AC-2: a non-Pending shipment is 409 and nothing is applied', async () => {
    const assigned = seedShipment({ status: 'Assigned' });
    renderAppAs('Admin');
    const conflict = await expectApiError(
      api.updateShipment(assigned.id, { destinationAddress: 'Too Late' }),
    );

    expect(conflict.status).toBe(409);
    expect(conflict.problem.detail).toMatch(/Required status: 'Pending'/);
    expect(shipmentsDb[0].destinationAddress).toBe('12 Dock Road, Rotterdam');
  });

  it('AC-4: server-owned and immutable fields are rejected per field and nothing is applied', async () => {
    const shipment = seedShipment({ destinationAddress: 'Untouched 1' });
    renderAppAs('Admin');
    const errors = await expectApiError(
      api.updateShipment(shipment.id, { priority: 'Express', status: 'Assigned' } as never),
    );

    expect(errors.status).toBe(400);
    expect(errors.fieldErrors.priority?.[0]).toMatch(/immutable/i);
    expect(errors.fieldErrors.status?.[0]).toMatch(/server-owned/i);
    expect(shipmentsDb[0].priority).toBe('Standard');
    expect(shipmentsDb[0].status).toBe('Pending');
  });

  it('AC-3: an empty PATCH body is rejected with errors.body', async () => {
    const shipment = seedShipment();
    renderAppAs('Admin');
    const errors = await expectApiError(api.updateShipment(shipment.id, {}));

    expect(errors.status).toBe(400);
    expect(errors.fieldErrors.body?.[0]).toMatch(/at least one editable field/i);
  });

  it('AC-6: GET /shipments/{id} returns the detail and 404s an unknown id', async () => {
    const shipment = seedShipment({ destinationAddress: 'Detail Read 1', destinationLat: 51.92 });
    renderAppAs('Viewer'); // AC-7: Viewer may read the detail
    const detail = await api.getShipment(shipment.id);

    expect(detail.referenceCode).toBe(shipment.referenceCode);
    expect(detail.destinationAddress).toBe('Detail Read 1');
    expect(detail.destinationLat).toBe(51.92);
    expect(detail.routeId).toBeNull();

    const missing = await expectApiError(api.getShipment(999999));
    expect(missing.status).toBe(404);
  });

  it('AC-10: a Driver may not cancel (403) but still transitions a non-terminal status (200)', async () => {
    renderAppAs('Driver');
    const assigned = seedShipment({ status: 'Assigned' });
    const pending = seedShipment({ status: 'Pending' });

    const forbidden = await expectApiError(
      api.transitionShipmentStatus(pending.id, { toStatus: 'Cancelled' }),
    );
    expect(forbidden.status).toBe(403);
    expect(shipmentsDb[1].status).toBe('Pending');
    expect(shipmentsDb[1].statusHistory).toHaveLength(1); // no audit row for the rejected attempt

    // LOGI-0006 behaviour is unchanged for a non-terminal transition.
    const ok = await api.transitionShipmentStatus(assigned.id, { toStatus: 'InTransit' });
    expect(ok.toStatus).toBe('InTransit');
    expect(shipmentsDb[0].statusHistory).toHaveLength(2);
  });
});
