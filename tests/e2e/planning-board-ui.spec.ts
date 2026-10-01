import { expect, test } from '@playwright/test';
import { PlanningBoardPage } from './pages/planning-board.page';
import { seedVehicle, seedWarehouse, signIn } from './support/api';
import { routeName, seedRoute, uniqueRef } from './support/routes';
import { driverScopedWindow } from './support/route-shipments';
import { boardTag, seedBoardShipment } from './support/planning-board';

/**
 * LOGI-0011 planning board through the real UI (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8).
 *
 * The API specs prove the server's projection; these prove the operator can *read* it — that the
 * columns show the untruncated counts, that the two presentations are one response rather than two
 * reads, that a filter actually narrows the board, and that the capacity bar says "no vehicle
 * assigned" instead of "full". All selectors live in `pages/planning-board.page.ts`.
 *
 * Every test narrows the board by its own `q` tag or route id first: the board is org-wide, so an
 * unfiltered UI assertion would be asserting on rows seeded by every other spec.
 */
test.describe('LOGI-0011 planning board (UI)', () => {
  let adminToken: string;
  let warehouseId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('PBUI')}`);
  });

  /** A Planned route on its own window band, with a name unique to this test. */
  async function seedUiRoute(vehicleId: number | null, tag: string): Promise<{ id: number; name: string }> {
    const route = await seedRoute({
      name: routeName(tag),
      status: 'Planned',
      vehicleId,
      plannedStart: driverScopedWindow(3_000_000),
      plannedEnd: driverScopedWindow(3_000_480),
    });
    return { id: route.id, name: route.name };
  }

  // LOGI-0011 AC-1
  test('AC-1 — the columns render with their untruncated counts, and an empty one says so // LOGI-0011 AC-1', async ({
    page,
    request,
  }) => {
    const route = await seedUiRoute(null, 'UI1');
    await seedBoardShipment({ warehouseId, status: 'Pending', routeId: route.id });
    await seedBoardShipment({ warehouseId, status: 'Assigned', routeId: route.id });
    await seedBoardShipment({ warehouseId, status: 'Delayed', routeId: route.id });

    const board = new PlanningBoardPage(page);
    await board.goto('Dispatcher');
    // Scoped by route id, not by the per-run tag: the tag is shared by every test in this file, so
    // it would also surface the rows seeded by the tests that ran before this one.
    await board.filterByRouteId(route.id);

    await board.expectColumnCount('Pending', 1);
    await board.expectColumnCount('Assigned', 1);
    await board.expectColumnCount('Delayed', 1);

    // Delivered/Cancelled start UI-collapsed (spec §7 O2) — a presentation default over the same
    // data, so expanding Cancelled reveals the real column rather than issuing a second read. An
    // empty column is rendered with a 0 count, never omitted (AC-1).
    await expect(board.column('Cancelled')).toHaveCount(0);
    await board.expandCollapsed('Cancelled');
    await board.expectColumnCount('Cancelled', 0);
    await expect(board.columnEmpty('Cancelled')).toBeVisible();
    await expect(board.column('Delivered')).toHaveCount(0);
  });

  // LOGI-0011 AC-2
  test('AC-2 — kanban and list are two renderings of one response // LOGI-0011 AC-2', async ({
    page,
    request,
  }) => {
    const route = await seedUiRoute(null, 'UI2');
    const first = await seedBoardShipment({ warehouseId, status: 'Pending', routeId: route.id });
    const second = await seedBoardShipment({ warehouseId, status: 'Assigned', routeId: route.id });

    const board = new PlanningBoardPage(page);
    await board.goto('Dispatcher');
    // Scoped by route id, not the per-run tag: that tag is shared by every test in this file, so it
    // would also surface the rows seeded by the tests that ran before this one.
    await board.filterByRouteId(route.id);

    // Kanban: each card in its own column, carrying its own reference.
    await expect(board.cardRef(first.id)).toHaveText(first.referenceCode);
    await expect(board.column('Pending').getByTestId(`board-card-${first.id}`)).toBeVisible();

    // List: the same cards, one row each, no extras — and no additional board request at all.
    const boardCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/planning-board')) boardCalls.push(req.url());
    });
    await board.showList();

    await expect(board.listRow(first.id)).toContainText(first.referenceCode);
    await expect(board.listRow(second.id)).toContainText(second.referenceCode);
    await expect(board.list().getByTestId(/^board-list-row-/)).toHaveCount(2);
    expect(boardCalls, 'the view switch must not re-read the board').toHaveLength(0);

    await board.showKanban();
    await expect(board.card(first.id)).toBeVisible();
  });

  // LOGI-0011 AC-3
  test('AC-3 — the filter bar narrows the counts and clearing restores them // LOGI-0011 AC-3', async ({
    page,
    request,
  }) => {
    const route = await seedUiRoute(null, 'UI3');
    await seedBoardShipment({ warehouseId, status: 'Pending', priority: 'Express', routeId: route.id });
    await seedBoardShipment({ warehouseId, status: 'Pending', priority: 'Standard', routeId: route.id });
    await seedBoardShipment({ warehouseId, status: 'Assigned', priority: 'Express', routeId: route.id });

    const board = new PlanningBoardPage(page);
    await board.goto('Dispatcher');
    await board.filterByRouteId(route.id);

    await board.expectColumnCount('Pending', 2);
    await board.expectColumnCount('Assigned', 1);

    // Filters compose onto the ONE request, so both counts move together.
    await board.filterByPriority('Express');
    await board.expectColumnCount('Pending', 1);
    await board.expectColumnCount('Assigned', 1);

    await board.filterByStatus('Pending');
    await board.expectColumnCount('Pending', 1);
    await board.expectColumnCount('Assigned', 0);

    // "Clear filters" resets the WHOLE set in one move, including the route id, so the board returns
    // to its org-wide scope: the Express/Pending row is visible again and the counts are at least
    // what the narrowed view showed (never fewer, since the filters were AND-ed).
    await board.clearFilters();
    await expect(board.searchInput()).toHaveValue('');
    await expect(board.routeInput()).toHaveValue('');
    const restored = Number(await board.columnCount('Pending').textContent());
    expect(restored, 'clearing widens the board back to org-wide, never narrower').toBeGreaterThanOrEqual(2);
  });

  // LOGI-0011 AC-4
  test('AC-4 — the capacity bar reports the BR-5 projection, or "no vehicle assigned" // LOGI-0011 AC-4', async ({
    page,
    request,
  }) => {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('PBUIV'), { capacityKg: 1000 });
    const loaded = await seedUiRoute(vehicleId, 'UI4');
    await seedBoardShipment({ warehouseId, status: 'Assigned', routeId: loaded.id, weightKg: 700 });

    const vehicleLess = await seedUiRoute(null, 'UI4N');
    await seedBoardShipment({ warehouseId, status: 'Assigned', routeId: vehicleLess.id, weightKg: 400 });

    const board = new PlanningBoardPage(page);
    await board.goto('Dispatcher');
    await board.searchFor(boardTag());

    // 1000 kg vehicle with 700 kg assigned -> 300 free, not a rounded or recomputed number.
    await expect(board.routeCapacityNumbers(loaded.id)).toContainText('300 kg free of 1000 kg');

    // A route with no vehicle says so explicitly; it never renders "0 kg free", which would read full.
    await expect(board.routeCapacityUnknown(vehicleLess.id)).toHaveText('No vehicle assigned');
    await expect(board.routeCapacityNumbers(vehicleLess.id)).toHaveCount(0);
  });

  // LOGI-0011 AC-5
  test('AC-5 — the unassigned lane is a count beside the board, and the card is marked // LOGI-0011 AC-5', async ({
    page,
    request,
  }) => {
    const unassigned = await seedBoardShipment({ warehouseId, status: 'Pending', routeId: null });

    const board = new PlanningBoardPage(page);
    await board.goto('Dispatcher');
    await board.searchFor(unassigned.referenceCode);

    // The lane is an explicit count, not a synthetic route row.
    await expect(board.unassignedLane()).toContainText('1 shipment awaiting assignment');
    await expect(board.cardUnassigned(unassigned.id)).toHaveText('Unassigned');

    // Narrowing by route must not smuggle the unassigned row in (AC-5) — the count follows the filter.
    const route = await seedUiRoute(null, 'UI5');
    await seedBoardShipment({ warehouseId, status: 'Assigned', routeId: route.id });
    await board.filterByRouteId(route.id);
    await expect(board.unassignedLane()).toContainText('0 shipments awaiting assignment');
    await expect(board.card(unassigned.id)).toHaveCount(0);
  });

  // LOGI-0011 AC-6
  test('AC-6 — a Driver has no Board tab at all // LOGI-0011 AC-6', async ({ page }) => {
    const board = new PlanningBoardPage(page);
    await board.login.signInAs('Driver');

    // §7 O1: the board is org-wide, so a Driver is refused it — the tab is simply not offered,
    // while the surfaces BR-6 does scope them to are still there.
    await expect(board.tab()).toHaveCount(0);
    await expect(page.getByTestId('tab-routes')).toBeVisible();
  });

  // LOGI-0011 AC-7
  test('AC-7 — the board is read-only: no control writes, and a Viewer reads all of it // LOGI-0011 AC-7', async ({
    page,
    request,
  }) => {
    const route = await seedUiRoute(null, 'UI7');
    const shipment = await seedBoardShipment({ warehouseId, status: 'Pending', routeId: route.id });

    const board = new PlanningBoardPage(page);
    await board.goto('Viewer');
    await board.filterByRouteId(route.id);

    // A Viewer sees the whole read surface...
    await expect(board.card(shipment.id)).toBeVisible();
    await expect(board.unassignedLane()).toBeVisible();
    await expect(board.routeCard(route.id)).toBeVisible();

    // ...and no write affordance anywhere: the only controls are the view switch, "Clear filters" and
    // the collapsed-column chips — never a transition or an assignment, and no note field to type one
    // into. (The chip labels legitimately contain "Delivered"/"Cancelled", the *statuses*, so the
    // check is for the imperative write verbs, not for the words.)
    const buttonLabels = (await page.getByRole('button').allTextContents()).join('|');
    expect(buttonLabels).not.toMatch(/assign|transition|dispatch|mark|cancel shipment/i);
    expect(await page.getByRole('textbox', { name: /note/i }).count()).toBe(0);

    // Filtering and switching view keep working for a Viewer: reads only.
    await board.filterByStatus('Pending');
    await expect(board.card(shipment.id)).toBeVisible();
    await board.showList();
    await expect(board.listRow(shipment.id)).toBeVisible();
  });

  // LOGI-0011 AC-8
  test('AC-8 — a truncated column shows the whole count and "load more" extends it // LOGI-0011 AC-8', async ({
    page,
    request,
  }) => {
    const route = await seedUiRoute(null, 'UI8');
    // 60 cards against the default maxPerColumn of 50 — one column, one filter set, so the assertion
    // is about the cap and the count chip rather than about anything else on screen.
    for (let index = 0; index < 60; index += 1) {
      await seedBoardShipment({
        warehouseId,
        status: 'Pending',
        routeId: route.id,
        slaDueAt: new Date(Date.now() + (index + 1) * 60_000),
      });
    }

    const board = new PlanningBoardPage(page);
    await board.goto('Dispatcher');
    await board.filterByRouteId(route.id);
    await board.filterByStatus('Pending');

    // The header count is the UNTRUNCATED 60, not the 50 cards actually rendered.
    await board.expectColumnCount('Pending', 60);
    await expect(board.cardsIn('Pending')).toHaveCount(50);
    await expect(board.loadMore('Pending')).toContainText('10 more');

    await board.clickLoadMore('Pending');

    // The wider read lands and the control disappears once the column is whole.
    await expect(board.cardsIn('Pending')).toHaveCount(60);
    await expect(board.loadMore('Pending')).toHaveCount(0);
    await board.expectColumnCount('Pending', 60);
  });
});
