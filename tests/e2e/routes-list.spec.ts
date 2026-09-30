import { expect, test } from '@playwright/test';
import { seedDriver, seedVehicle, signIn } from './support/api';
import { listRoutes, routeName, seedRoute, uniqueRef, window } from './support/routes';

/**
 * LOGI-0009 `GET /routes` list contract (AC-9) against the real API and the throwaway SQLite
 * database.
 *
 * The rows are *seeded* rather than created: AC-9 is about the envelope, the AND filters and the
 * default `-createdAt` sort, and only a fixture can pin `status` and `created_at` (the endpoint
 * mints `Planned` rows with the server clock). Everything shares one per-run name stem, so a filter
 * can never pick up another file's or another run's rows.
 */
test.describe('LOGI-0009 route list + filters (API)', () => {
  let adminToken: string;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
  });

  test('AC-9 — paged envelope, AND filters, name-contains and default -createdAt order // LOGI-0009 AC-9', async ({
    request,
  }) => {
    const stem = routeName('AC9');
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('RTL'));
    const driverId = await seedDriver(request, adminToken, `Route QA ${routeName('LIST')}`, uniqueRef('RDL'));

    // Distinct createdAt values make the default order deterministic without touching the clock.
    const oldest = await seedRoute({
      name: `${stem} one`,
      status: 'Planned',
      vehicleId,
      driverId,
      plannedStart: window(0),
      plannedEnd: window(480),
      createdAt: window(-180),
    });
    const middle = await seedRoute({
      name: `${stem} two`,
      status: 'Cancelled',
      vehicleId,
      plannedStart: window(480),
      plannedEnd: window(720),
      createdAt: window(-120),
    });
    const newest = await seedRoute({
      name: `${stem} three`,
      status: 'InProgress',
      driverId,
      plannedStart: window(720),
      plannedEnd: window(960),
      createdAt: window(-60),
    });

    // Envelope: a PagedResponse whose items are RouteResponse rows.
    const firstPage = await listRoutes(request, adminToken, { q: stem, page: 1, pageSize: 2 });
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.page).toBe(1);
    expect(firstPage.body.pageSize).toBe(2);
    expect(firstPage.body.totalCount).toBe(3);
    expect(firstPage.body.totalPages).toBe(2);
    expect(firstPage.body.items).toHaveLength(2);
    const item = firstPage.body.items![0];
    expect(Object.keys(item)).toEqual(
      expect.arrayContaining(['id', 'name', 'plannedStart', 'plannedEnd', 'status', 'createdAt']),
    );
    expect(String(item.name)).toContain(stem);

    const secondPage = await listRoutes(request, adminToken, { q: stem, page: 2, pageSize: 2 });
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);
    const pageOneIds = (firstPage.body.items ?? []).map((route) => route.id);
    const pageTwoIds = (secondPage.body.items ?? []).map((route) => route.id);
    expect(pageTwoIds.filter((id) => pageOneIds.includes(id)), 'pages are disjoint').toEqual([]);

    // Default sort: createdAt descending (the seeded triple is strictly ordered by it).
    const sorted = await listRoutes(request, adminToken, { q: stem, pageSize: 100 });
    expect((sorted.body.items ?? []).map((route) => route.id)).toEqual([newest.id, middle.id, oldest.id]);

    // q is a `name contains` filter.
    const exactName = await listRoutes(request, adminToken, { q: `${stem} two` });
    expect(exactName.body.totalCount).toBe(1);
    expect(exactName.body.items![0].id).toBe(middle.id);

    // Filters AND together (status, vehicleId, driverId) — never OR.
    const byStatus = await listRoutes(request, adminToken, { q: stem, status: 'Planned' });
    expect((byStatus.body.items ?? []).map((route) => route.id)).toEqual([oldest.id]);
    const byVehicleAndStatus = await listRoutes(request, adminToken, {
      q: stem,
      status: 'Cancelled',
      vehicleId,
    });
    expect((byVehicleAndStatus.body.items ?? []).map((route) => route.id)).toEqual([middle.id]);
    const byDriver = await listRoutes(request, adminToken, { q: stem, driverId });
    expect((byDriver.body.items ?? []).map((route) => route.id).sort()).toEqual(
      [oldest.id, newest.id].sort(),
    );
    const allThree = await listRoutes(request, adminToken, { q: stem, status: 'Planned', vehicleId, driverId });
    expect((allThree.body.items ?? []).map((route) => route.id)).toEqual([oldest.id]);

    // A status outside the enum is a 400, keyed on the offending filter.
    const unknownStatus = await listRoutes(request, adminToken, { q: stem, status: 'Sleeping' });
    expect(unknownStatus.status).toBe(400);
    expect(
      Object.keys(unknownStatus.body.errors ?? {}).join(',').toLowerCase(),
      'the 400 is keyed on the offending filter',
    ).toContain('status');
  });

  /**
   * AC-9 — an unparsable query value must answer 400, not 500.
   *
   * This is the *same* tracked defect LOGI-0007 documented (see `shipments-list.spec.ts`): the
   * minimal-API query binder throws `BadHttpRequestException: Failed to bind parameter "int Page"`
   * and `ExceptionHandlingMiddleware` maps it to 500, while the contract declares 400 for
   * `GET /routes` and every sibling list endpoint answers 400 for a bad enum value. The routes
   * endpoint is on that binder path, so the marker is kept here rather than a new id invented.
   *
   * The assertion stays strict: when the middleware/binder mapping lands this test passes and
   * Playwright reports "expected to fail, but passed" — i.e. it turns red on purpose until the
   * marker is removed and the expectation is folded back into the AC-9 test above.
   */
  test('AC-9 — an unparsable page answers 400 ProblemDetails, not 500 // LOGI-0009 AC-9', async ({ request }) => {
    test.fail(true, 'LOGI-0007-F1: query-binder failures surface as 500 through ExceptionHandlingMiddleware');

    const badPage = await listRoutes(request, adminToken, '?page=abc');
    expect(badPage.status, 'an unparsable page must be a 400').toBe(400);
  });
});
