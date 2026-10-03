import { expect, test } from '@playwright/test';
import { seedWarehouse, signIn } from './support/api';
import { seedRoute } from './support/routes';
import {
  atRiskRowOf,
  getDashboard,
  seedDashboardShipment,
  slaMinutesFromNow,
  statusCountOf,
} from './support/dashboard';
import { listShipments } from './support/shipments';

/**
 * LOGI-0012 AC-6, route-scoped: the drill-down a route-filtered dashboard produces is lossless.
 *
 * The original qa arm could not write this file. `GET /dashboard` accepted `routeId` but
 * `GET /shipments` did not, so its AC-6 case scoped by `originWarehouseId` and left a FINDING comment
 * saying why (dashboard.spec.ts:382-386). The architect arm then added `routeId` to the contract and
 * the backend arm implemented it; this file is where that becomes verifiable.
 *
 * WHY THESE TESTS WOULD HAVE FAILED BEFORE THE FIX — the shape of each case, and the thing a future
 * refactor must not weaken:
 *
 *  1. An unscoped read would pass trivially: the dashboard is org-wide, so a silently-ignored
 *     `routeId` still returns 200 with rows. Every case below is scoped to this run's own route and
 *     asserts the EXCLUDED rows are absent, which is what fails when the filter does nothing.
 *  2. Asserting only that `routeId` is rejected as invalid would also pass while the filter did
 *     nothing, so each case also asserts a valid id actually narrows.
 */
test.describe('LOGI-0012 route-scoped drill-down (AC-6)', () => {
  let adminToken: string;
  let warehouseId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    // A dedicated warehouse so this file's rows are identifiable independent of the route filter —
    // route-scoped assertions would otherwise be indistinguishable from warehouse scoping.
    warehouseId = await seedWarehouse(request, adminToken, `QA RD ${Date.now().toString(36)}`);
  });

  /**
   * Seeds two routes plus an unassigned row. The last two returned rows are the ones a widened filter
   * (`routeId = N OR routeId IS NULL`, or a filter that binds to nothing) would wrongly include, so
   * their absence is the assertion with teeth.
   */
  async function seedTwoRoutes() {
    const routeId = (await seedRoute({ status: 'Planned' })).id;
    const otherRouteId = (await seedRoute({ status: 'Planned' })).id;

    const onRoute = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'Pending',
      slaDueAt: slaMinutesFromNow(20),
    });
    const alsoOnRoute = await seedDashboardShipment({
      warehouseId,
      routeId,
      status: 'InTransit',
      slaDueAt: slaMinutesFromNow(600),
    });
    // The two EXCLUSION rows are seeded `Delayed`, not `Pending`, on purpose. They exist to prove the
    // filter drops them, and a route-scoped query excludes a row whatever its status. Seeding them
    // `Pending` would add org-wide Pending rows, and planning-board.spec.ts AC-2 (line 174) fetches
    // Pending with pageSize 100 and NO routeId, then filters client-side — so extra Pending rows push
    // that page past 100 and break a suite that has nothing to do with this one. Delayed is still BR-2
    // at risk, so the at-risk totals below stay meaningful.
    const elsewhere = await seedDashboardShipment({
      warehouseId,
      routeId: otherRouteId,
      status: 'Delayed',
      slaDueAt: slaMinutesFromNow(20),
    });
    const unassigned = await seedDashboardShipment({
      warehouseId,
      routeId: null,
      status: 'Delayed',
      slaDueAt: slaMinutesFromNow(20),
    });

    return { routeId, otherRouteId, onRoute, alsoOnRoute, elsewhere, unassigned };
  }
// LOGI-0012 AC-6
  test('AC-6 — a route-scoped dashboard and GET /shipments report the same rows // LOGI-0012 AC-6', async ({
    request,
  }) => {
    const { routeId, onRoute, alsoOnRoute, elsewhere, unassigned } = await seedTwoRoutes();

    const { status, body } = await getDashboard(request, adminToken, { routeId, pageSize: 100 });
    expect(status).toBe(200);

    // The list the tile drills into — same route, same filter.
    const list = await listShipments(request, adminToken, { routeId, pageSize: 100 });
    expect(list.status).toBe(200);
    const listedIds = list.body.items.map((item) => item.id).sort((a, b) => a - b);
    expect(listedIds).toEqual([onRoute.id, alsoOnRoute.id].sort((a, b) => a - b));

    // The tile counts and the drill-down list must be the SAME set (AC-6) — the comparison the
    // original qa arm could not make for routeId.
    expect(statusCountOf(body, 'Pending').count).toBe(1);
    expect(statusCountOf(body, 'InTransit').count).toBe(1);
    expect(body.atRiskTotalCount).toBe(list.body.items.filter((item) => item.atRisk).length);

    // The rows the filter must EXCLUDE. Against the pre-fix API these are exactly what came back.
    expect(listedIds).not.toContain(elsewhere.id);
    expect(listedIds).not.toContain(unassigned.id);
    // Both exclusion rows are at risk under BR-2, so an unscoped dashboard would report 3 at-risk
    // rows where this route has 1. That gap is exactly what AC-6 forbids.
    expect(body.atRiskTotalCount).toBe(1);
    expect(atRiskRowOf(body, onRoute.id).id).toBe(onRoute.id);
    expect(() => atRiskRowOf(body, elsewhere.id)).toThrow();
    expect(() => atRiskRowOf(body, unassigned.id)).toThrow();
  });

  // LOGI-0012 AC-6
  test('AC-6 — routeId narrows, it is not an implicit equality on null // LOGI-0012 AC-6', async ({
    request,
  }) => {
    const { routeId, unassigned } = await seedTwoRoutes();

    // Unscoped, the unassigned row is present; scoped, it is not. The pair is what proves the filter
    // narrows on the route the caller chose instead of silently including the backlog.
    // Scoped by status as well as paging: this spec's exclusion rows are `Delayed`, so the unscoped read
    // asks for exactly them rather than hoping they fit on page 1 of an org-wide Pending list.
    const unscoped = await listShipments(request, adminToken, { status: 'Delayed', pageSize: 100 });
    expect(unscoped.body.items.map((item) => item.id)).toContain(unassigned.id);

    const scoped = await listShipments(request, adminToken, { routeId, pageSize: 100 });
    expect(scoped.body.items.map((item) => item.id)).not.toContain(unassigned.id);
  });

  // LOGI-0012 AC-6
  test('AC-6 — routeId is honoured when valid and rejected when not // LOGI-0012 AC-6', async ({
    request,
  }) => {
    const { routeId } = await seedTwoRoutes();

    const ok = await listShipments(request, adminToken, { routeId, pageSize: 100 });
    expect(ok.status).toBe(200);
    expect(ok.body.items.every((item) => item.routeId === routeId)).toBe(true);

    // The contract's `minimum: 1`, keyed errors map.
    for (const bad of [0, -1]) {
      const rejected = await listShipments(request, adminToken, { routeId: bad });
      expect(rejected.status, `routeId=${bad} is below the contract minimum`).toBe(400);
      expect(rejected.body).toHaveProperty('errors.routeId');
    }
  });
});