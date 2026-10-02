import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { DashboardResponse, Role } from '../../api/client';
import { seedDriver, seedSession, seedShipment, seedVehicle } from '../../mocks/handlers';
import { renderAppAs, resetMocks } from '../../test/renderApp';
import { tokenStore } from '../../api/tokenStore';

beforeEach(() => {
  resetMocks();
});

/** Renders the app as `role` and opens the Dashboard tab, waiting for the first read. */
async function renderDashboard(role: Role = 'Admin') {
  const user = userEvent.setup();
  renderAppAs(role);
  await user.click(await screen.findByTestId('tab-dashboard'));
  await waitFor(() => expect(screen.queryByTestId('dashboard-loading')).toBeNull());
  return user;
}

/**
 * Puts a genuine mock session token in the real token store, exactly as signing in would, so a direct
 * API call carries a real Authorization header and the MSW role rules are actually exercised.
 */
function signInAs(role: Role): void {
  const { token } = seedSession(role);
  tokenStore.set({ accessToken: token, refreshToken: 'r' });
}

/**
 * A direct `api.getDashboard` under `role`, bypassing the UI.
 *
 * The hidden tab is affordance hygiene only (spec §7 O1) — the server is the authority, so AC-7 has to
 * assert the 403 through the real client, not merely through the absence of a tab.
 */
async function dashboardAs(role: Role): Promise<DashboardResponse> {
  signInAs(role);
  return api.getDashboard();
}

async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected an ApiError');
}

/** An SLA due `hours` from now, as a whole-second ISO instant. */
function slaIn(hours: number): string {
  return new Date(Math.floor((Date.now() + hours * 3_600_000) / 1000) * 1000).toISOString();
}

describe('DashboardPage — status counts (LOGI-0012)', () => {
  // LOGI-0012 AC-1
  it('AC-1: renders all six tiles in lifecycle order, zero-count statuses included', async () => {
    seedShipment({ status: 'Pending' });
    seedShipment({ status: 'InTransit' });
    // Assigned/Delivered/Delayed/Cancelled are deliberately empty.

    await renderDashboard('Admin');

    const board = screen.getByTestId('dashboard');
    // A zero-count status is still rendered: omitting it would read as "the dashboard forgot to ask",
    // which is a very different statement from "there are none" (AC-1).
    for (const status of ['Pending', 'Assigned', 'InTransit', 'Delivered', 'Delayed', 'Cancelled']) {
      expect(within(board).getByTestId(`tile-${status}`)).toBeInTheDocument();
    }
    expect(within(board).getByTestId('tile-count-Pending')).toHaveTextContent('1');
    expect(within(board).getByTestId('tile-count-InTransit')).toHaveTextContent('1');
    expect(within(board).getByTestId('tile-count-Assigned')).toHaveTextContent('0');
    expect(within(board).getByTestId('tile-count-Cancelled')).toHaveTextContent('0');

    const order = Array.from(board.querySelectorAll('[data-testid^="tile-count-"]')).map((node) =>
      node.getAttribute('data-testid'),
    );
    expect(order).toEqual([
      'tile-count-Pending',
      'tile-count-Assigned',
      'tile-count-InTransit',
      'tile-count-Delivered',
      'tile-count-Delayed',
      'tile-count-Cancelled',
      'tile-count-at-risk',
    ]);
  });

  // LOGI-0012 AC-1
  it('AC-1: every count is untruncated and recomputed for the active filters', async () => {
    // 30 Pending shipments — far more than the default page size, so a truncated count would show.
    for (let i = 0; i < 30; i += 1) seedShipment({ status: 'Pending' });
    seedShipment({ status: 'Assigned' });

    await renderDashboard('Admin');

    expect(screen.getByTestId('tile-count-Pending')).toHaveTextContent('30');
    expect(screen.getByTestId('tile-count-Assigned')).toHaveTextContent('1');

    // AC-1/AC-6: narrowing to Assigned must recount — the tiles are a filtered view, not a global tally.
    const user = userEvent.setup();
    renderAppAs('Admin');
    await user.click(await screen.findByTestId('tab-dashboard'));
    await waitFor(() => expect(screen.queryByTestId('dashboard-loading')).toBeNull());
    // MUI's Select hides its real input behind a rendered div, so the control is driven through its
    // combobox role (the same reason the board's filter testids sit on the control root).
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Assigned' }));

    await waitFor(() => expect(screen.getByTestId('tile-count-Assigned')).toHaveTextContent('1'));
    expect(screen.getByTestId('tile-count-Pending')).toHaveTextContent('0');
  });
});

describe('DashboardPage — SLA at risk (LOGI-0012)', () => {
  // LOGI-0012 AC-2
  it('AC-2: lists at-risk shipments by SLA ascending and excludes Delivered/Cancelled', async () => {
    // Inside the BR-2 2h window: at risk.
    const soon = seedShipment({ status: 'InTransit', slaDueAt: slaIn(0.5) });
    // Outside the window: not at risk.
    const later = seedShipment({ status: 'InTransit', slaDueAt: slaIn(10) });
    // A Delivered shipment is never at risk however close its promise (BR-2 2.4).
    const delivered = seedShipment({ status: 'Delivered', slaDueAt: slaIn(0.25) });
    const cancelled = seedShipment({ status: 'Cancelled', slaDueAt: slaIn(0.25) });
    // No promise recorded at all: never at risk (BR-2 2.7).
    const noSla = seedShipment({ status: 'Pending', slaDueAt: null });
    // A Delayed shipment IS at risk and cannot escape by being delayed (BR-2 2.4).
    const delayed = seedShipment({ status: 'Delayed', slaDueAt: slaIn(-1) });

    await renderDashboard('Admin');

    expect(screen.getByTestId(`at-risk-row-${soon.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`at-risk-row-${delayed.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`at-risk-row-${later.id}`)).toBeNull();
    expect(screen.queryByTestId(`at-risk-row-${delivered.id}`)).toBeNull();
    expect(screen.queryByTestId(`at-risk-row-${cancelled.id}`)).toBeNull();
    expect(screen.queryByTestId(`at-risk-row-${noSla.id}`)).toBeNull();

    // Ordering: the overdue Delayed row sorts before the soon-due InTransit row.
    const rows = Array.from(document.querySelectorAll('[data-testid^="at-risk-row-"]')).map((n) =>
      n.getAttribute('data-testid'),
    );
    expect(rows).toEqual([`at-risk-row-${delayed.id}`, `at-risk-row-${soon.id}`]);

    // AC-2: minutesToDue is negative once overdue, and the row says so.
    expect(within(screen.getByTestId(`at-risk-row-${delayed.id}`)).getByText(/overdue/)).toBeInTheDocument();
  });

  // LOGI-0012 AC-3
  it('AC-3: the at-risk tile equals the page total and every carried row is itself at risk', async () => {
    const a = seedShipment({ status: 'InTransit', slaDueAt: slaIn(0.5) });
    const b = seedShipment({ status: 'Assigned', slaDueAt: slaIn(1) });
    seedShipment({ status: 'Pending', slaDueAt: slaIn(20) });
    seedShipment({ status: 'Delivered', slaDueAt: slaIn(0.5) });

    await renderDashboard('Admin');

    // The tile and the pager's total are the SAME number by construction (AC-3).
    expect(screen.getByTestId('tile-count-at-risk')).toHaveTextContent('2');
    expect(screen.getByTestId('at-risk-count')).toHaveTextContent('2');
    expect(screen.getByTestId('at-risk-page')).toHaveTextContent('2 total');

    // Every carried row is itself at risk — the list is the at-risk subset, not the whole list.
    expect(screen.getByTestId(`at-risk-row-${a.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`at-risk-row-${b.id}`)).toBeInTheDocument();

    // One instant governs the whole response (AC-3).
    expect(screen.getByTestId('dashboard-generated-at')).toHaveTextContent(/As of \d{4}-\d{2}-\d{2}T/);
  });

  // LOGI-0012 AC-2
  it('AC-2: the pager steps through the pages of the at-risk set', async () => {
    for (let i = 0; i < 25; i += 1) seedShipment({ status: 'InTransit', slaDueAt: slaIn(0.2 + i / 100) });

    await renderDashboard('Admin');

    // The contract default page size is 20 (AC-8), so 25 at-risk rows span two pages.
    expect(screen.getByTestId('at-risk-page')).toHaveTextContent('Page 1 of 2');
    expect(document.querySelectorAll('[data-testid^="at-risk-row-"]')).toHaveLength(20);

    const user = userEvent.setup();
    renderAppAs('Admin');
    await user.click(await screen.findByTestId('tab-dashboard'));
    await waitFor(() => expect(screen.queryByTestId('dashboard-loading')).toBeNull());
    await user.click(screen.getByTestId('at-risk-next'));

    await waitFor(() => expect(screen.getByTestId('at-risk-page')).toHaveTextContent('Page 2 of 2'));
    expect(document.querySelectorAll('[data-testid^="at-risk-row-"]')).toHaveLength(5);
  });
});

describe('DashboardPage — utilization panels (LOGI-0012)', () => {
  // LOGI-0012 AC-4
  it('AC-4: reports vehicle buckets, counts only InRoute capacity in use and excludes Maintenance', async () => {
    seedVehicle({ status: 'Available', capacityKg: 1000 });
    seedVehicle({ status: 'Available', capacityKg: 1000 });
    seedVehicle({ status: 'InRoute', capacityKg: 3000 });
    // A Maintenance vehicle has real capacity but must never count as capacity in use.
    seedVehicle({ status: 'Maintenance', capacityKg: 5000 });

    await renderDashboard('Admin');

    expect(screen.getByTestId('vehicle-utilization-total')).toHaveTextContent('4');
    expect(screen.getByTestId('vehicle-utilization-bucket-Available')).toHaveTextContent('Available: 2');
    expect(screen.getByTestId('vehicle-utilization-bucket-InRoute')).toHaveTextContent('InRoute: 1');
    expect(screen.getByTestId('vehicle-utilization-bucket-Maintenance')).toHaveTextContent('Maintenance: 1');

    // Only the InRoute vehicle's 3000kg is in use; Maintenance's 5000kg is excluded, and the total is
    // every vehicle's capacity (AC-4).
    expect(screen.getByTestId('vehicle-utilization-capacity')).toHaveTextContent(
      '3000 kg in use of 10000 kg total capacity',
    );
    expect(screen.getByTestId('vehicle-utilization-percent')).toHaveTextContent('30%');
  });

  // LOGI-0012 AC-5
  it('AC-5: reports driver buckets and never counts a Suspended driver as available', async () => {
    seedDriver({ status: 'Active' });
    seedDriver({ status: 'OffDuty' });
    seedDriver({ status: 'Suspended' });
    seedDriver({ status: 'Active' });

    await renderDashboard('Admin');

    expect(screen.getByTestId('driver-utilization-total')).toHaveTextContent('4');
    expect(screen.getByTestId('driver-utilization-bucket-Active')).toHaveTextContent('Active: 2');
    expect(screen.getByTestId('driver-utilization-bucket-OffDuty')).toHaveTextContent('OffDuty: 1');
    // Suspended is shown as its own bucket rather than folded into Active/OffDuty (AC-5, O3).
    expect(screen.getByTestId('driver-utilization-bucket-Suspended')).toHaveTextContent('Suspended: 1');
    expect(screen.getByTestId('driver-utilization-percent')).toHaveTextContent('Active share: 50%');
  });

  // LOGI-0012 AC-4
  it('AC-4: an empty fleet reads "no capacity" rather than "0% used"', async () => {
    await renderDashboard('Admin');

    // The API's null percentage means "no capacity", which is NOT the same statement as 0% used —
    // so the UI renders an em dash and never asserts "0%" (AC-4/AC-5).
    expect(screen.getByTestId('vehicle-utilization-total')).toHaveTextContent('0');
    expect(screen.getByTestId('vehicle-utilization-percent')).toHaveTextContent('Capacity in use: —');
    expect(screen.getByTestId('vehicle-utilization-percent')).not.toHaveTextContent('0%');
    expect(screen.getByTestId('driver-utilization-percent')).toHaveTextContent('Active share: —');
    // Every enum bucket is still rendered, zero included (AC-5).
    expect(screen.getByTestId('driver-utilization-bucket-Active')).toHaveTextContent('Active: 0');
  });
});

describe('DashboardPage — drill-down, authorization and validation (LOGI-0012)', () => {
  // LOGI-0012 AC-6
  it('AC-6: every tile and bucket links to an existing endpoint with the equivalent filter', async () => {
    renderAppAs('Admin');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('tab-dashboard'));
    await waitFor(() => expect(screen.queryByTestId('dashboard-loading')).toBeNull());

    // The targets are asserted on the anchors themselves: a tile is a link to an EXISTING list, never a
    // dashboard-local result route (AC-6).
    expect(screen.getByTestId('tile-link-Pending').closest('a')).toHaveAttribute(
      'href',
      '/shipments?status=Pending',
    );
    expect(screen.getByTestId('vehicle-utilization-bucket-InRoute')).toHaveAttribute(
      'href',
      '/vehicles?status=InRoute',
    );
    expect(screen.getByTestId('driver-utilization-bucket-Suspended')).toHaveAttribute(
      'href',
      '/drivers?status=Suspended',
    );
  });

  // LOGI-0012 AC-6
  it('AC-6: the at-risk tile targets the shipments list own slaRisk filter', async () => {
    renderAppAs('Admin');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('tab-dashboard'));
    await waitFor(() => expect(screen.queryByTestId('dashboard-loading')).toBeNull());

    // The at-risk tile is the one drill-down that filters on risk rather than on a status (AC-6).
    expect(screen.getByTestId('tile-link-at-risk').closest('a')).toHaveAttribute(
      'href',
      '/shipments?slaRisk=true',
    );
  });

  // LOGI-0012 AC-7
  it('AC-7: Viewer, Dispatcher and Admin get 200; Driver gets 403 and no tab; anonymous gets 401', async () => {
    for (const role of ['Viewer', 'Dispatcher', 'Admin'] as Role[]) {
      await expect(dashboardAs(role)).resolves.toMatchObject({ generatedAt: expect.any(String) });
    }

    // Driver is 403 at the API, which the hidden tab alone would not prove (spec §7 O1).
    const forbidden = await expectApiError(dashboardAs('Driver'));
    expect(forbidden.status).toBe(403);

    // ...and the Driver has no Dashboard tab at all.
    renderAppAs('Driver');
    await screen.findByTestId('tab-warehouses');
    expect(screen.queryByTestId('tab-dashboard')).toBeNull();

    // Anonymous is 401.
    tokenStore.clear();
    const unauthorized = await expectApiError(api.getDashboard());
    expect(unauthorized.status).toBe(401);
  });

  // LOGI-0012 AC-8
  it('AC-8: rejects an out-of-range pageSize and unknown enums with a keyed errors map', async () => {
    signInAs('Admin');

    const badPage = await expectApiError(api.getDashboard({ pageSize: 500 }));
    expect(badPage.status).toBe(400);
    expect(badPage.fieldErrors.pageSize).toBeDefined();

    const badStatus = await expectApiError(api.getDashboard({ status: 'Teleported' as never }));
    expect(badStatus.status).toBe(400);
    expect(badStatus.fieldErrors.status).toBeDefined();

    const badPriority = await expectApiError(api.getDashboard({ priority: 'Rush' as never }));
    expect(badPriority.status).toBe(400);
    expect(badPriority.fieldErrors.priority).toBeDefined();

    // AC-8: with no pageSize supplied the contract default is 20.
    const ok = await api.getDashboard();
    expect(ok.atRiskShipments.pageSize).toBe(20);
  });

  // LOGI-0012 AC-8
  it('AC-8: two identical reads agree on everything except generatedAt', async () => {
    seedShipment({ status: 'Pending', slaDueAt: slaIn(1) });
    seedShipment({ status: 'InTransit', slaDueAt: slaIn(0.5) });
    signInAs('Admin');

    const first = await api.getDashboard();
    const second = await api.getDashboard();

    // AC-8: the dashboard stores nothing, so a repeated read cannot mutate the answer.
    const { generatedAt: _firstAt, ...firstRest } = first;
    const { generatedAt: _secondAt, ...secondRest } = second;
    expect(secondRest).toEqual(firstRest);
  });

  // LOGI-0012 AC-9
  it('AC-9: the shipments, planning-board, vehicles and drivers surfaces are unaffected', async () => {
    seedShipment({ status: 'Pending', slaDueAt: slaIn(1) });
    seedVehicle({ status: 'Available' });
    signInAs('Admin');

    // Each pre-existing surface still answers with its own shape; the dashboard adds nothing to them.
    const shipments = await api.listShipments();
    expect(shipments.items.length).toBe(1);

    const board = await api.getPlanningBoard();
    expect(board.columns).toHaveLength(6);

    const vehicles = await api.listVehicles();
    expect(vehicles.items).toHaveLength(1);
  });
});