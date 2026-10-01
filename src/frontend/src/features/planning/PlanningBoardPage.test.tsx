import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { PlanningBoardResponse, Role } from '../../api/client';
import { seedRoute, seedSession, seedShipment, seedVehicle } from '../../mocks/handlers';
import { renderAppAs, resetMocks } from '../../test/renderApp';
import { tokenStore } from '../../api/tokenStore';

beforeEach(() => {
  resetMocks();
});

/** Renders the app as `role` and opens the Board tab, waiting for the first board read. */
async function renderBoard(role: Role = 'Admin') {
  const user = userEvent.setup();
  renderAppAs(role);
  await user.click(await screen.findByTestId('tab-board'));
  await waitFor(() => expect(screen.queryByTestId('board-loading')).toBeNull());
  return user;
}

/**
 * A direct API call under `role`, bypassing the UI.
 *
 * The hidden tab is affordance hygiene only (spec §7 O1) — the server is the authority, so AC-6 has
 * to assert the 403 through the real client, not through the absence of a tab.
 */
async function boardAs(role: Role): Promise<PlanningBoardResponse> {
  signInAs(role);
  return api.getPlanningBoard();
}

/** Puts a genuine mock session token in the real token store, exactly as signing in would. */
function signInAs(role: Role): void {
  const { token } = seedSession(role);
  tokenStore.set({ accessToken: token, refreshToken: 'r' });
}

async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected an ApiError');
}

describe('PlanningBoardPage — columns and cards (LOGI-0011)', () => {
  // LOGI-0011 AC-1
  it('AC-1: renders one column per BR-7 status in lifecycle order, empty ones included', async () => {
    seedShipment({ status: 'Pending', destinationAddress: 'Rotterdam Dock' });
    seedShipment({ status: 'InTransit', destinationAddress: 'Antwerp Terminal' });
    // Assigned/Delivered/Delayed/Cancelled are deliberately empty.

    await renderBoard('Admin');

    const board = screen.getByTestId('planning-board');
    for (const status of ['Pending', 'Assigned', 'InTransit', 'Delayed']) {
      expect(within(board).getByTestId(`board-column-${status}`)).toBeInTheDocument();
    }
    // Delivered/Cancelled are in the response but collapsed by default (spec §7 O2) — the chip is the
    // affordance that proves the column exists and was counted, not omitted.
    expect(within(board).getByTestId('board-show-Delivered')).toHaveTextContent('Delivered (0)');
    expect(within(board).getByTestId('board-show-Cancelled')).toHaveTextContent('Cancelled (0)');

    expect(within(board).getByTestId('board-column-count-Pending')).toHaveTextContent('1');
    expect(within(board).getByTestId('board-column-count-InTransit')).toHaveTextContent('1');
    expect(within(board).getByTestId('board-column-empty-Assigned')).toBeInTheDocument();
  });

  // LOGI-0011 AC-1
  it('AC-1: expanding a collapsed terminal column shows its cards without losing another status', async () => {
    const delivered = seedShipment({ status: 'Delivered', destinationAddress: 'Ghent Hub' });
    const pending = seedShipment({ status: 'Pending', destinationAddress: 'Rotterdam Dock' });

    const user = await renderBoard('Admin');
    const chip = screen.getByTestId('board-show-Delivered');
    expect(chip).toHaveTextContent('Delivered (1)');

    await user.click(chip);

    expect(await screen.findByTestId('board-column-Delivered')).toBeInTheDocument();
    expect(screen.getByTestId(`board-card-${delivered.id}`)).toBeInTheDocument();
    // The other statuses are untouched by expanding one.
    expect(screen.getByTestId(`board-card-${pending.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('board-column-Pending')).toBeInTheDocument();
  });

  // LOGI-0011 AC-2
  it('AC-2: the list view shows exactly the cards the kanban shows, and no extras', async () => {
    const pending = seedShipment({ status: 'Pending' });
    const transit = seedShipment({ status: 'InTransit' });
    const assigned = seedShipment({ status: 'Assigned' });

    const user = await renderBoard('Admin');
    for (const id of [pending.id, transit.id, assigned.id]) {
      expect(screen.getByTestId(`board-card-${id}`)).toBeInTheDocument();
    }

    await user.click(screen.getByTestId('view-list'));

    const list = await screen.findByTestId('board-list');
    for (const id of [pending.id, transit.id, assigned.id]) {
      expect(within(list).getByTestId(`board-list-row-${id}`)).toBeInTheDocument();
    }
    // Same count on both sides: the list is a projection of the same response, not a second read.
    expect(within(list).getAllByRole('row')).toHaveLength(4); // 1 header + 3 cards
  });

  // LOGI-0011 AC-2
  it('AC-2: changing the sort re-reads the board and the list order follows it', async () => {
    const later = seedShipment({ status: 'Pending', createdAt: '2026-09-10T08:00:00Z' });
    const earlier = seedShipment({ status: 'Pending', createdAt: '2026-09-01T08:00:00Z' });

    const user = await renderBoard('Admin');
    await user.click(screen.getByTestId('view-list'));

    const order = () =>
      within(screen.getByTestId('board-list'))
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.getAttribute('data-testid'));

    // Default slaDueAt ascending follows createdAt for equal-priority Standard shipments.
    await waitFor(() =>
      expect(order()).toEqual([`board-list-row-${earlier.id}`, `board-list-row-${later.id}`]),
    );

    await user.click(screen.getByLabelText('Sort'));
    await user.click(await screen.findByRole('option', { name: 'Created (newest first)' }));

    await waitFor(() =>
      expect(order()).toEqual([`board-list-row-${later.id}`, `board-list-row-${earlier.id}`]),
    );
  });

  // LOGI-0011 AC-3
  it('AC-3: filters compose with AND and the applied set is echoed back to the caller', async () => {
    const route = seedRoute({ name: 'North loop', status: 'Planned' });
    const match = seedShipment({
      status: 'Pending',
      priority: 'Express',
      originWarehouseId: 1,
      routeId: route.id,
      destinationAddress: 'Rotterdam Dock',
    });
    seedShipment({ status: 'Pending', priority: 'Standard', destinationAddress: 'Rotterdam Other' });
    seedShipment({ status: 'Assigned', priority: 'Express', originWarehouseId: 2 });

    const user = await renderBoard('Admin');
    await user.click(screen.getByLabelText('Priority'));
    await user.click(await screen.findByRole('option', { name: 'Express' }));
    await user.click(screen.getByLabelText('Status'));
    await user.click(await screen.findByRole('option', { name: 'Pending' }));
    await user.type(screen.getByLabelText('Route id'), String(route.id));

    await waitFor(() => expect(screen.getByTestId(`board-card-${match.id}`)).toBeInTheDocument());
    expect(screen.getByTestId('board-column-count-Pending')).toHaveTextContent('1');
    // AC-1 still holds under a filter: every column is present, the non-matching ones are simply
    // empty — filtering narrows the CARDS, it never omits a column.
    expect(screen.getByTestId('board-column-Assigned')).toBeInTheDocument();
    expect(screen.getByTestId('board-column-count-Assigned')).toHaveTextContent('0');
    expect(screen.getByTestId('board-column-empty-Assigned')).toBeInTheDocument();

    // The echo is the authority on what the server applied (AC-3): every supplied filter comes back,
    // and the ones the caller left unset come back null rather than omitted.
    const echoed = await api.getPlanningBoard({ priority: 'Express', status: 'Pending', routeId: route.id });
    expect(echoed.appliedFilters.priority).toBe('Express');
    expect(echoed.appliedFilters.status).toBe('Pending');
    expect(echoed.appliedFilters.routeId).toBe(route.id);
    expect(echoed.appliedFilters.q).toBeNull();
    expect(echoed.appliedFilters.slaRisk).toBeNull();
    expect(echoed.appliedFilters.sort).toBe('slaDueAt');
    expect(echoed.appliedFilters.maxPerColumn).toBe(50);

    await user.click(screen.getByTestId('filter-clear'));
    await waitFor(() => expect(screen.getByTestId('board-column-count-Pending')).toHaveTextContent('2'));
  });


  // LOGI-0011 AC-4
  it('AC-4: the route card capacity bar matches GET /routes/{id}/shipments exactly', async () => {
    const vehicle = seedVehicle({ capacityKg: 1000 });
    const route = seedRoute({ name: 'North loop', vehicleId: vehicle.id, status: 'Planned' });
    seedShipment({ routeId: route.id, weightKg: 700, status: 'Assigned' });

    await renderBoard('Admin');

    const numbers = await screen.findByTestId(`board-route-capacity-${route.id}-numbers`);
    expect(numbers).toHaveTextContent('300 kg free of 1000 kg');

    // One source of truth (spec §7 O4): the assign dialog's projection must equal the board's.
    const page = await api.listRouteShipments(route.id);
    expect(page.capacity.remainingCapacityKg).toBe(300);
    expect(page.capacity.assignedWeightKg).toBe(700);
    expect(page.capacity.shipmentCount).toBe(1);
  });

  // LOGI-0011 AC-4
  it('AC-4: a route with no vehicle reads "no vehicle assigned", never 0 kg free', async () => {
    const route = seedRoute({ name: 'Unprovisioned', vehicleId: null, status: 'Planned' });
    seedShipment({ routeId: route.id, weightKg: 500, status: 'Assigned' });

    await renderBoard('Admin');

    const card = await screen.findByTestId(`board-route-${route.id}`);
    expect(within(card).getByTestId(`board-route-capacity-${route.id}-unknown`)).toHaveTextContent(
      'No vehicle assigned',
    );
    // The load is still reported — what is unknown is the capacity, not the assigned weight.
    expect(within(card).getByTestId(`board-route-load-${route.id}`)).toHaveTextContent(
      '500 kg across 1 shipment',
    );
    expect(within(card).queryByTestId(`board-route-capacity-${route.id}-numbers`)).toBeNull();
  });

  // LOGI-0011 AC-5
  it('AC-5: the unassigned lane counts unassigned shipments and survives a routeId filter', async () => {
    const route = seedRoute({ name: 'North loop', status: 'Planned' });
    const unassigned = seedShipment({ status: 'Pending', routeId: null });
    seedShipment({ status: 'Pending', routeId: route.id });

    const user = await renderBoard('Admin');
    expect(await screen.findByTestId('unassigned-lane')).toHaveTextContent('1 shipment awaiting assignment');
    expect(screen.getByTestId(`board-card-unassigned-${unassigned.id}`)).toBeInTheDocument();
    // The lane is a COUNT, not a synthetic route row: no fake route id appears on the board.
    expect(screen.queryByTestId('board-route-0')).toBeNull();

    await user.type(screen.getByLabelText('Route id'), String(route.id));

    // routeId is a filter, not an implicit equality on null — the unassigned backlog is hidden by
    // the caller's own choice, not silently.
    await waitFor(() =>
      expect(screen.getByTestId('board-column-count-Pending')).toHaveTextContent('1'),
    );
    expect(screen.getByTestId('unassigned-lane')).toHaveTextContent('0 shipments awaiting assignment');
  });


  // LOGI-0011 AC-6
  it('AC-6: the Board tab is hidden for Driver, and a direct Driver read is 403', async () => {
    renderAppAs('Driver');
    expect(await screen.findByTestId('tab-warehouses')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-board')).not.toBeInTheDocument();

    expect((await expectApiError(boardAs('Driver'))).status).toBe(403);
  });

  // LOGI-0011 AC-6
  it('AC-6: anonymous is 401 and Viewer receives the same body as Admin', async () => {
    tokenStore.clear();
    expect((await expectApiError(api.getPlanningBoard())).status).toBe(401);

    const shipment = seedShipment({ status: 'Pending', destinationAddress: 'Rotterdam Dock' });
    const adminBoard = await boardAs('Admin');
    const viewerBoard = await boardAs('Viewer');
    // Viewer is read-allowed like on every other v1 read (spec §7 O1).
    const strip = (board: PlanningBoardResponse) =>
      JSON.stringify(board).replace(/"generatedAt":"[^"]+"/, '');
    expect(strip(viewerBoard)).toBe(strip(adminBoard));
    expect(viewerBoard.columns.flatMap((c) => c.cards.map((card) => card.id))).toEqual([shipment.id]);
  });

  // LOGI-0011 AC-6
  it('AC-6: a Viewer sees the board with no write affordance anywhere on it', async () => {
    seedShipment({ status: 'Pending', destinationAddress: 'Rotterdam Dock' });

    await renderBoard('Viewer');

    const board = await screen.findByTestId('planning-board');
    // Every control is navigation, filtering, sorting, view switching or load-more (AC-7) — none of
    // these names a mutation, and a Viewer has no write capability on any surface. The collapsed
    // column chips are excluded because "Cancelled — show" would otherwise match /Cancel/i.
    const buttons = within(board)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('data-testid')?.startsWith('board-show-') !== true);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      for (const label of ['Transition', 'Assign', 'Unassign', 'Cancel', 'Edit', 'Save', 'Delete']) {
        expect(button).not.toHaveAccessibleName(new RegExp(label, 'i'));
      }
    }
    expect(within(board).getByTestId('view-list')).toBeInTheDocument();
    expect(within(board).getByLabelText('Status')).toBeInTheDocument();
  });

  // LOGI-0011 AC-7
  it('AC-7: the board is read-only — exercising every control mutates nothing', async () => {
    const shipment = seedShipment({ status: 'Pending', routeId: null });
    const before = { ...shipment };

    const user = await renderBoard('Admin');
    // Filters, sort, view switch, expand and clear: the complete set of board affordances.
    await user.click(screen.getByTestId('view-list'));
    await user.click(screen.getByTestId('view-kanban'));
    await user.click(screen.getByTestId('board-show-Cancelled'));
    await user.click(screen.getByTestId('filter-sla-risk'));
    await user.click(screen.getByTestId('filter-clear'));
    await screen.findByTestId(`board-card-${shipment.id}`);

    // Transitions (BR-7) and assignment (BR-5) live on their own surfaces, so the board holds no
    // state at all: nothing it did changed the shipment.
    expect({ ...shipment }).toEqual(before);
  });


  // LOGI-0011 AC-8
  it('AC-8: an untruncated column shows the full count and offers no "load more"', async () => {
    for (let i = 0; i < 3; i += 1) {
      seedShipment({ status: 'Pending', destinationAddress: `Dock ${i}` });
    }

    await renderBoard('Admin');

    await screen.findByTestId('board-column-Pending');
    expect(screen.getByTestId('board-column-count-Pending')).toHaveTextContent('3');
    expect(screen.queryByTestId('board-load-more-Pending')).toBeNull();

    // The count and the flag agree with the response, so the UI cannot render "50 of 312" as "50".
    const board = await boardAs('Admin');
    const pending = board.columns.find((c) => c.status === 'Pending')!;
    expect(pending.totalCount).toBe(3);
    expect(pending.truncated).toBe(false);
    expect(pending.cards).toHaveLength(3);
  });

  // LOGI-0011 AC-8
  it('AC-8: maxPerColumn 0 and 201 are field-keyed 400s and mutate nothing', async () => {
    const shipment = seedShipment({ status: 'Pending' });
    const before = { ...shipment };
    signInAs('Admin');

    const tooSmall = await expectApiError(api.getPlanningBoard({ maxPerColumn: 0 }));
    expect(tooSmall.status).toBe(400);
    expect(tooSmall.fieldErrors.maxPerColumn).toBeDefined();

    const tooLarge = await expectApiError(api.getPlanningBoard({ maxPerColumn: 201 }));
    expect(tooLarge.fieldErrors.maxPerColumn).toBeDefined();

    const badStatus = await expectApiError(api.getPlanningBoard({ status: 'Bogus' as never }));
    expect(badStatus.fieldErrors.status).toBeDefined();

    // The board holds no state, so a rejected read changed nothing.
    expect({ ...shipment }).toEqual(before);
  });

  // LOGI-0011 AC-9
  it('AC-9: two identical reads return the same column order and the same card order', async () => {
    for (let i = 0; i < 4; i += 1) {
      // Identical SLA due dates on purpose: the id tiebreak is what keeps them from reordering.
      seedShipment({
        status: 'Pending',
        slaDueAt: '2026-09-20T08:00:00Z',
        createdAt: '2026-09-18T08:00:00Z',
      });
    }

    const first = await boardAs('Admin');
    const second = await boardAs('Admin');

    expect(second.columns.map((c) => c.status)).toEqual(first.columns.map((c) => c.status));
    expect(second.columns.map((c) => c.cards.map((card) => card.id))).toEqual(
      first.columns.map((c) => c.cards.map((card) => card.id)),
    );
    const ids = first.columns.flatMap((c) => c.cards.map((card) => card.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  // LOGI-0011 AC-9
  it('AC-9: a card agrees with GET /shipments on status, routeId and atRisk', async () => {
    const route = seedRoute({ name: 'North loop', status: 'Planned' });
    const shipment = seedShipment({ status: 'Assigned', routeId: route.id });

    await renderBoard('Admin');
    await screen.findByTestId(`board-card-${shipment.id}`);

    const board = await boardAs('Admin');
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === shipment.id)!;
    const readBack = await api.getShipment(shipment.id);
    expect(card.status).toBe(readBack.status);
    expect(card.routeId).toBe(readBack.routeId);
    expect(card.atRisk).toBe(readBack.atRisk);
  });

  // LOGI-0011 AC-10
  it('AC-10: the other master-data surfaces are unchanged by the board tab', async () => {
    seedShipment({ status: 'Pending' });

    const user = await renderBoard('Admin');
    await user.click(screen.getByTestId('tab-warehouses'));
    expect(await screen.findByText('No warehouses found')).toBeInTheDocument();
    await user.click(screen.getByTestId('tab-shipments'));
    expect(await screen.findByTestId('shipments-title')).toBeInTheDocument();
  });
});

