import { expect, test } from '@playwright/test';
import { DashboardPage } from './pages/dashboard.page';
import { ShipmentsPage } from './pages/shipments.page';
import { seedWarehouse, signIn } from './support/api';
import { seedRoute, uniqueRef } from './support/routes';
import { seedDashboardShipment, slaMinutesFromNow } from './support/dashboard';

/**
 * LOGI-0012 AC-6 in a REAL BROWSER: the route-scoped drill-down loses nothing between the tile the
 * dispatcher clicks and the list that renders.
 *
 * The arms before this one each proved one link of the chain and none proved all of them at once:
 *
 *  - architect added `routeId` to `GET /shipments`; backend implemented it (238/238);
 *  - `dashboard-route-drilldown.spec.ts` proved the API agrees tile-for-list, route-scoped;
 *  - the frontend arm regenerated `schema.d.ts`, taught `client.listShipments` to send `routeId` and
 *    taught `ShipmentsPage` to hydrate its filters from `window.location`.
 *
 * That last one was verified by unit tests over the extracted parser plus MSW — and MSW already
 * accepted `routeId`, so the frontend suite could have stayed green against a disagreeing API. This
 * file is where the browser, the built bundle, the real API and the real SQLite file meet.
 *
 * WHY THE TILE CLICK IS NOT OPTIONAL — the two ways these cases could pass against broken code:
 *
 *  1. Asserting the `href` alone proves nothing. `shipmentListHref` has ALWAYS emitted `routeId`,
 *     even while the API ignored the parameter completely, so an href-only assertion passed against
 *     the fully broken chain. Hence every case FOLLOWS the link and asserts the rendered rows.
 *  2. Asserting only that the list loaded proves nothing either — an unfiltered org-wide list also
 *     contains the route's own row. So the exclusion rows below are seeded in the SAME status as the
 *     route's row: `status=` cannot be what drops them, only `routeId` can.
 *
 * `InTransit` is the tile under test rather than `Pending` for a non-obvious reason: planning-board
 * AC-2 fetches every org-wide `Pending` row with pageSize 100 and filters client-side, so extra
 * Pending rows here can push another spec's rows off page one. InTransit has no such reader.
 */
test.describe('LOGI-0012 route-scoped drill-down, in the browser (AC-6)', () => {
  let adminToken: string;
  let warehouseId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('DDB')}`);
  });

  /**
   * Seeds one route's InTransit row plus the two EXCLUSION rows: another route's row, and an
   * unassigned row. All three share a status, so the tile's own `status=` parameter cannot be what
   * excludes the latter two — only `routeId` can.
   */
  async function seedRouteWithExclusions() {
    const routeId = (await seedRoute({ status: 'Planned' })).id;
    const otherRouteId = (await seedRoute({ status: 'Planned' })).id;

    const onRoute = await seedDashboardShipment({ warehouseId, routeId, status: 'InTransit' });
    const elsewhere = await seedDashboardShipment({
      warehouseId,
      routeId: otherRouteId,
      status: 'InTransit',
    });
    const unassigned = await seedDashboardShipment({ warehouseId, routeId: null, status: 'InTransit' });

    return { routeId, otherRouteId, onRoute, elsewhere, unassigned };
  }

  // LOGI-0012 AC-6
  test('AC-6 — the route-scoped tile link carries routeId, and following it shows that route only // LOGI-0012 AC-6', async ({
    page,
  }) => {
    const { routeId, onRoute, elsewhere, unassigned } = await seedRouteWithExclusions();

    const board = new DashboardPage(page);
    await board.goto('Dispatcher');
    await board.filterByRouteId(routeId);
    await board.expectTileCount('InTransit', 1);

    // The href states the shape of the drill-down: the tile's own status PLUS the dashboard's route
    // filter. Kept as a separate assertion because it pins the query the next one then follows.
    const href = await board.hrefOf(board.tileLink('InTransit'));
    expect(href).toContain('/shipments?');
    expect(href).toContain('status=InTransit');
    expect(href).toContain(`routeId=${routeId}`);

    // The part that has teeth: actually navigate, then read the DOM.
    await board.tileLink('InTransit').click();
    const list = new ShipmentsPage(page);
    await expect(list.table(), 'the drill-down must land on the shipments list').toBeVisible();

    // The route's own row is on the page...
    await expect(list.row(onRoute.referenceCode)).toBeVisible();
    // ...and the rows the route filter must drop are not. Without `routeId` on the request these two
    // would render too, because `status=InTransit` already matches them.
    await expect(list.row(elsewhere.referenceCode)).toHaveCount(0);
    await expect(list.row(unassigned.referenceCode)).toHaveCount(0);
  });

  // LOGI-0012 AC-6
  test('AC-6 — the at-risk tile honours the route filter through a real link // LOGI-0012 AC-6', async ({
    page,
  }) => {
    // The at-risk tile builds `slaRisk=true`, not `status=` — a different branch of the URL parser
    // (triState rather than the enum lookup), so the browser check must cover it too.
    const routeId = (await seedRoute({ status: 'Planned' })).id;
    const otherRouteId = (await seedRoute({ status: 'Planned' })).id;

    const atRisk = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(20),
    });
    const healthy = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(600),
    });
    const elsewhereAtRisk = await seedDashboardShipment({
      warehouseId,
      routeId: otherRouteId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(20),
    });

    const board = new DashboardPage(page);
    await board.goto('Dispatcher');
    await board.filterByRouteId(routeId);
    await board.expectTileCount('InTransit', 2);

    const href = await board.hrefOf(board.atRiskTileLink());
    expect(href).toContain('slaRisk=true');
    expect(href).toContain(`routeId=${routeId}`);

    await board.atRiskTileLink().click();
    const list = new ShipmentsPage(page);
    await expect(list.table()).toBeVisible();

    await expect(list.row(atRisk.referenceCode)).toBeVisible();
    // Dropped by `slaRisk=true` — the tile's own question.
    await expect(list.row(healthy.referenceCode)).toHaveCount(0);
    // Dropped by `routeId` — at risk AND on another route, so only the filter can exclude it.
    await expect(list.row(elsewhereAtRisk.referenceCode)).toHaveCount(0);
  });
});